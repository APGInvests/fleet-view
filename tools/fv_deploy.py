#!/usr/bin/env python3
"""
fv_deploy.py — FleetView deploy driver.

Deploys are plain git: edit the local clone, run preflight, then
`git add` / `git commit` / `git push` to main. This tool covers the two
ends of that loop:

    1)  python3 fv_deploy.py preflight -m "msg" [--extras feat.js]
        (runs the standing invariant suite; refuses to clear a broken build)
    2)  git add -A && git commit -m "msg" && git push
    3)  python3 fv_deploy.py verify
        (polls the live site until its bytes match the file on disk)

`pull` predates the git-clone workflow (it fetches the LIVE app over the
local file) — only use it to resync a machine that has no clone state.

ONE COST TRICK THAT MATTERS
---------------------------
* index.html is ~130 KB (~32k tokens). It must NEVER be read into an agent's
  context whole. Use grep/sed/Edit on target regions only.

VERIFY IS BY CONTENT HASH, NOT MARKER GREP
------------------------------------------
Old deploys grepped the live page for an ad-hoc "build marker" string, which
means inventing and threading a marker through every deploy. We instead compare
the sha256 of the live bytes against the sha256 of what we pushed. It is exact,
needs no change to the app, and proves byte-for-byte that the crew's phones can
now fetch what we intended.
"""

import argparse
import glob
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

# ---- FleetView constants. The casing of `fleet-view` matters. ----
OWNER = "APGInvests"
REPO = "fleet-view"
BRANCH = "main"
APP_PATH = "index.html"
LIVE_URL = "https://apginvests.github.io/fleet-view/index.html"
TREE_API = f"https://api.github.com/repos/{OWNER}/{REPO}/git/trees/{BRANCH}"
RAW_BASE = f"https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}"

HERE = os.path.dirname(os.path.abspath(__file__))
# The app lives at the repo root (local git clone workflow). LOCAL used to be
# tools/index.html back when `pull` curled the live file down for API pushes.
LOCAL = os.path.join(os.path.dirname(HERE), APP_PATH)
STATE = os.path.join(HERE, ".fv_state.json")


def _c(txt, code):
    return f"\033[{code}m{txt}\033[0m" if sys.stdout.isatty() else txt


def ok(m):
    print(f"  {_c('ok', '32')}   {m}")


def bad(m):
    print(f"  {_c('FAIL', '31')} {m}")


def info(m):
    print(f"       {m}")


def blob_sha(data: bytes) -> str:
    """git's blob object hash — same value the GitHub API calls `sha`."""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url, timeout=30, cache_bust=True):
    u = url
    if cache_bust:
        u += ("&" if "?" in url else "?") + "v=" + str(int(time.time() * 1000))
    req = urllib.request.Request(
        u,
        headers={
            "Cache-Control": "no-cache, no-store, max-age=0",
            "Pragma": "no-cache",
            "User-Agent": "fleetview-deploy/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def load_state():
    if os.path.exists(STATE):
        try:
            with open(STATE) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_state(d):
    cur = load_state()
    cur.update(d)
    with open(STATE, "w") as f:
        json.dump(cur, f, indent=2)
    return cur


# ------------------------------------------------------------------ pull
def cmd_pull(args):
    print("PULL — fetching the canonical app to disk (never into context)")
    try:
        status, data = fetch(LIVE_URL)
    except Exception as e:
        bad(f"could not fetch {LIVE_URL}: {e}")
        return 1
    if status != 200:
        bad(f"live app returned HTTP {status}")
        return 1

    with open(LOCAL, "wb") as f:
        f.write(data)
    ok(f"wrote {APP_PATH}  ({len(data):,} bytes, ~{len(data)//4:,} tokens if read — so don't)")

    local_blob = blob_sha(data)
    remote_blob = None
    try:
        st, tree_raw = fetch(TREE_API, cache_bust=False)
        tree = json.loads(tree_raw)
        for e in tree.get("tree", []):
            if e.get("path") == APP_PATH:
                remote_blob = e.get("sha")
                break
    except Exception as e:
        info(f"tree API unavailable ({e}); falling back to locally computed blob sha")

    if remote_blob and remote_blob != local_blob:
        bad("blob sha mismatch — the live site is NOT the current commit")
        info(f"repo   {remote_blob}")
        info(f"served {local_blob}")
        info("A deploy may still be propagating. Re-run pull in a minute.")
        save_state({"blob_sha": remote_blob, "sha256": sha256(data), "verified": False})
        return 1

    sha = remote_blob or local_blob
    ok(f"blob sha for the next update: {sha}" + ("  (confirmed against repo)" if remote_blob else "  (computed locally)"))
    save_state({"blob_sha": sha, "sha256": sha256(data), "bytes": len(data), "verified": bool(remote_blob)})

    # Bring down the test tooling too, so a fresh thread is ready to deploy
    # without re-authoring anything.
    if not args.no_tools:
        for name in ("fv_harness.js", "fv_assert.js", "fv_smoke.js"):
            dest = os.path.join(HERE, name)
            # raw.githubusercontent.com can 404 for a minute after a fresh push
            # (its CDN lags the API). Retry before giving up.
            last_err = None
            for attempt in range(4):
                try:
                    st, blob = fetch(f"{RAW_BASE}/tools/{name}")
                    if st == 200 and blob:
                        with open(dest, "wb") as f:
                            f.write(blob)
                        ok(f"tooling: {name} ({len(blob):,} bytes)")
                        last_err = None
                        break
                    last_err = f"HTTP {st}"
                except Exception as e:
                    last_err = str(e)
                if attempt < 3:
                    time.sleep(8)
            if last_err:
                if os.path.exists(dest):
                    info(f"tooling: {name} not refreshed ({last_err}); using local copy")
                else:
                    bad(f"tooling: {name} unavailable and no local copy ({last_err})")

    print()
    print("Next: edit with Edit/sed on target regions, then:")
    print('  python3 fv_deploy.py preflight -m "what changed"')
    return 0


# -------------------------------------------------------------- preflight
def cmd_preflight(args):
    print("PREFLIGHT — nothing ships unless the invariants pass")
    if not os.path.exists(LOCAL):
        bad(f"{APP_PATH} not on disk. Run: python3 fv_deploy.py pull")
        return 1

    smoke = os.path.join(HERE, "fv_smoke.js")
    if not os.path.exists(smoke):
        bad("fv_smoke.js missing — the standing invariant suite must be present")
        return 1

    # Schema gate: every MAPS field must have a real Postgres column. Live probe
    # via the public anon key when the network allows; committed snapshot with a
    # loud banner when it doesn't; refuses to vouch blind. This is the mechanical
    # form of the §3 rule that failed twice as human memory (movements.photos,
    # status_events.show_id).
    gate = os.path.join(HERE, "fv_schema_gate.js")
    if not os.path.exists(gate):
        bad("fv_schema_gate.js missing — the schema gate must be present")
        return 1
    res = subprocess.run(["node", gate], capture_output=True, text=True)
    sys.stdout.write("       " + (res.stdout or "").strip() + "\n")
    if res.stderr.strip():
        sys.stdout.write(res.stderr)
    if res.returncode != 0:
        bad("schema gate FAILED — a mapped field has no column; run the migration first")
        return 1

    # Standing invariants: every tools/fv_inv_*.js file always runs, no opt-in.
    # --extras remains for one-off per-deploy assertion files.
    standing = sorted(glob.glob(os.path.join(HERE, "fv_inv_*.js")))
    cmd = ["node", smoke, LOCAL] + standing + (args.extras or [])
    print(f"       running: {' '.join(os.path.basename(c) for c in cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(res.stdout)
    if res.stderr.strip():
        sys.stdout.write(res.stderr)
    if res.returncode != 0:
        bad("smoke suite FAILED — refusing to stage a deploy")
        info("A broken push means broken phones on a show day. Fix, then re-run.")
        return 1
    ok("all invariants pass")

    with open(LOCAL, "rb") as f:
        data = f.read()
    new256 = sha256(data)
    save_state({"pending_sha256": new256, "pending_message": args.message})

    ok(f"cleared to ship  ({len(data):,} bytes, sha256 {new256[:16]}…)")
    print()
    print("Next:")
    print(f'  git add -A && git commit -m "{args.message}" && git push')
    print("Then:")
    print("  python3 fv_deploy.py verify")
    return 0


# ----------------------------------------------------------------- verify
def cmd_verify(args):
    """Single tool call. The polling loop lives HERE, not in twelve Bash calls."""
    print("VERIFY — polling the live app until the crew's bytes match ours")
    if not os.path.exists(LOCAL):
        bad(f"{APP_PATH} not on disk; cannot compare.")
        return 1
    with open(LOCAL, "rb") as f:
        want = sha256(f.read())

    st = load_state()
    if st.get("pending_sha256") and st["pending_sha256"] != want:
        info("note: local file changed since preflight; comparing against the file on disk now")

    deadline = time.time() + args.timeout
    attempt = 0
    last = None
    while time.time() < deadline:
        attempt += 1
        try:
            status, data = fetch(LIVE_URL, timeout=20)
            got = sha256(data)
            last = f"HTTP {status}, sha256 {got[:12]}…, {len(data):,} bytes"
            if status == 200 and got == want:
                ok(f"live app matches byte-for-byte after {attempt} attempt(s)")
                info(f"sha256 {got}")
                # Refresh the blob sha so the NEXT deploy needs no API read at all.
                new_blob = blob_sha(data)
                save_state({"blob_sha": new_blob, "sha256": got, "pending_sha256": None, "verified": True})
                info(f"next base blob sha cached: {new_blob}")
                print()
                print(f"  LIVE: https://apginvests.github.io/fleet-view/?v={int(time.time())}")
                print("  If sw.js changed, its VERSION must have been bumped — installed PWAs "
                      "only refresh their shell when fv-sw-N changes.")
                return 0
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
        except Exception as e:
            last = f"error: {e}"
        remaining = int(deadline - time.time())
        if remaining <= 0:
            break
        info(f"attempt {attempt}: {last} — CDN still catching up, {remaining}s left")
        time.sleep(min(args.interval, max(1, remaining)))

    bad(f"live app did not match within {args.timeout}s (last: {last})")
    info("The push may have landed but Pages is still building. Re-run verify.")
    return 1


# ----------------------------------------------------------------- status
def cmd_status(args):
    st = load_state()
    print("FleetView deploy state")
    print(f"  repo        {OWNER}/{REPO} @ {BRANCH}")
    print(f"  live        {LIVE_URL}")
    print(f"  local file  {'present' if os.path.exists(LOCAL) else 'MISSING — run pull'}")
    for k in ("blob_sha", "sha256", "bytes", "verified", "pending_message"):
        if k in st and st[k] is not None:
            print(f"  {k:<11} {st[k]}")
    return 0


def main():
    p = argparse.ArgumentParser(description="FleetView deploy driver")
    sub = p.add_subparsers(dest="cmd", required=True)

    pl = sub.add_parser("pull", help="fetch the live app + test tooling to disk, cache blob sha")
    pl.add_argument("--no-tools", action="store_true", help="skip refreshing tools/*.js")

    pf = sub.add_parser("preflight", help="run invariants; refuse to clear a broken build")
    pf.add_argument("-m", "--message", required=True, help="commit message")
    pf.add_argument("--extras", nargs="*", default=[], help="per-feature assertion files")

    vf = sub.add_parser("verify", help="poll live app until it matches (single call)")
    vf.add_argument("--timeout", type=int, default=240)
    vf.add_argument("--interval", type=int, default=10)

    sub.add_parser("status", help="show cached deploy state")

    a = p.parse_args()
    return {"pull": cmd_pull, "preflight": cmd_preflight, "verify": cmd_verify, "status": cmd_status}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
