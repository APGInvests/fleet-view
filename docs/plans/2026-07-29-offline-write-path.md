# Offline Write Path (Durable Diff) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** FleetView keeps working in show-site dead zones: the app opens offline, shows last-known data, queues writes durably, and replays them safely on reconnect — with **no silent data loss, ever** (writes that lose a conflict or get refused by the server are parked visibly, never dropped).

**Architecture:** No separate outbox. The existing diff-based sync (`S` vs `SNAP`) becomes the queue: persist both to IndexedDB, only advance `SNAP` per-row on server acknowledgment, and merge (never replace) on reload. Pending work = rows where `S ≠ SNAP`, including deletes. Three phases, each independently shippable: (1) photos move to Supabase Storage so cached rows are small, (2) a service worker with an update prompt and a kill switch so the shell opens offline, (3) the durable diff itself with dead-lettering, ordered replay, LWW-loser parking, and clock-drift handling.

**Tech Stack:** Vanilla JS in the single `index.html` (no build step), Supabase (Postgres + Auth + Realtime + Storage), IndexedDB via a ~20-line KV wrapper, the existing zero-dependency test rig in `tools/` (`fv_harness.js`, `fv_assert.js`, `fv_smoke.js`, `fv_deploy.py`).

---

## Settled decisions (do not re-litigate during execution)

| Decision | Rationale |
|---|---|
| Durable diff, **not** a separate outbox | One source of truth for pending state; the diff already expresses upserts *and* deletes |
| Photos → Storage **before** any caching work | IndexedDB must not inherit megabyte base64 rows |
| SW document strategy: network-first with timeout, cache fallback | Preserves today's instant-update behavior online; serves shell offline |
| SW has skip-waiting message, an update prompt, and a `KILL` switch; drilled on a sandbox copy before production | A bad SW can brick every installed phone with no user-side fix |
| `TABLES` dependency order is an **explicit tested invariant**; upserts run in `TABLES` order, deletes in reverse | A state diff has no causal order; today's ordering is correct by accident |
| Poison rows are **quarantined to a visible dead-letter list**, never dropped | Losing field data silently is worse than a blocked queue |
| **LWW losers are parked in the same visible list**, never silently discarded | "No silent data loss" applies to conflict resolution too — the tech must see what didn't make it |
| Units conflict rule: last-write-wins by `updatedAt`, resolved client-side at merge (read-merge-then-write on reconnect) | Per HANDOFF §10 item 1; whole-row LWW without merge lets a stale replay move a unit (violates §8 rule 1) |
| **LWW compares device `updatedAt`; no `received_at` on units.** Accepted because: (a) the local side of every merge comparison is an *unacked* row that has never touched the server, so a server timestamp cannot arbitrate it regardless of schema; (b) phone clocks are NTP-synced — drift is seconds, far below typical edit spacing; (c) the only wrong-winner window is two edits within drift of each other, i.e. genuinely concurrent edits where either outcome is defensible; (d) the loser is parked visibly (row above), so the worst case is a reviewable event, not silent corruption | This is the documented answer to "device clocks drift" for the destructive path; event *ordering* drift is solved separately with `received_at` |
| Every event row stores device time (`ts`) **and** server-received time (`received_at`); display device time, tiebreak on server time | Device clocks drift |
| Every code path that mutates a `S.units` row must bump `updatedAt` — **tested invariant** | The entire LWW mechanism assumes it (audit found `rmUnitPhoto()` already violates this; fixed in Task 3.5) |
| `syncPendingPhotos` is bounded: per-flush upload cap + per-upload timeout | It runs inside `flush()` with `flushing=true`; a stalled upload on bad LTE would reopen the mid-flight window |

**Not doing (YAGNI / out of scope):** per-field merge, Background Sync API, map-tile caching, roles, retry backoff tuning beyond a fixed interval, photo deletion from Storage when removed from a row (orphans are accepted debt), `received_at` on `units`/`shows`/`shops` (see LWW decision above), Chart.js removal.

**HANDOFF.md:** each phase updates §3/§7/§10 to record what shipped. **§9 is explicitly excluded** — its rewrite is deferred, its own commit, after Andy reviews (see project memory `handoff-s9-rewrite-deferred`).

## Standing constraints for every task

- One logical change per commit. Read the real current code before editing — line numbers below were true on 2026-07-29 and will drift.
- The gate for every task is the invariant suite: `node tools/fv_smoke.js index.html tools/fv_inv_*.js` → `RESULT: PASS`. All 96 existing assertions must stay green; the new files below add to them.
- Deploy = `git add` + `git commit` + `git push` to `main` (local clone; **not** the old GitHub-API paramsFile flow), after bumping the build marker at `index.html:13`. Verify live:
  ```bash
  curl -s -L "https://apginvests.github.io/fleet-view/?v=$(date +%s)" | grep -o "fleetview build [0-9-]* [a-z+-]*"
  ```
- Production DB migrations go through the Management API (`POST /v1/projects/eujgglfcpdfgskyqfggg/database/query`), idempotent statements only, browser `User-Agent` + `Accept: application/json` headers (HANDOFF §11). The personal access token is entered only into a secure credential prompt — never into the repo, chat, or shell history.
- Never point a click-through test at production data (HANDOFF §9 "Testing against production — don't").

---

# Phase 0 — Test rig extensions (no app changes)

The harness can't currently simulate failure, which is the entire subject of this feature. Fix the rig first.

### Task 0.1: Standing invariant files auto-load in preflight

New invariants must run on *every* future deploy, not only when someone remembers `--extras`. Convention: `tools/fv_inv_*.js` files are standing.

**Files:**
- Modify: `tools/fv_deploy.py` (the `cmd_preflight` cmd construction, ~line 207)
- Modify: `tools/fv_smoke.js` (extras runner — make it await async extras)
- Modify: `tools/README.md` (document the convention)

**Step 1: Read the extras runner at the bottom of `tools/fv_smoke.js`.** If it calls extras synchronously (`mod(app, t)` without awaiting), wrap the run in an async IIFE and `await` each extra. This is runner mechanics, not an invariant change — it's the one permitted edit to `fv_smoke.js`. All Phase 3 tests are `async (app, t) => {...}`.

**Step 2: Auto-glob standing invariants in `fv_deploy.py`:**

```python
import glob  # top of file with the other imports

# in cmd_preflight, replace:
#   cmd = ["node", smoke, LOCAL] + (args.extras or [])
# with:
standing = sorted(glob.glob(os.path.join(HERE, "fv_inv_*.js")))
cmd = ["node", smoke, LOCAL] + standing + (args.extras or [])
```

**Step 3: Prove the wiring with a canary.** Create `tools/fv_inv_canary.js`:

```js
module.exports = (app, t) => { t.group('canary').ok(false, 'canary must fail'); };
```

Run: `python3 tools/fv_deploy.py preflight -m "wiring test"`
Expected: `RESULT: FAIL` and `refusing to stage a deploy`. Then **delete the canary** and re-run: `RESULT: PASS (96/96)`.

**Step 4: Document in `tools/README.md`:** standing invariants live in `fv_inv_*.js` (always run); `--extras` remains for one-off per-deploy assertions.

**Step 5: Commit** — `git commit -m "Preflight auto-loads standing fv_inv_*.js invariant files"`

### Task 0.2: Harness failure injection + event capture

**Files:**
- Modify: `tools/fv_harness.js`

**Step 1: Make the Supabase mock consult `opts` at call time** so tests can flip failures mid-run. In `makeSupabase`, every write/read resolver gains an injection hook (the mock already closes over `opts`; just read it lazily):

```js
// inside query(table):
const err = (op, payload) => (opts.writeError ? opts.writeError(table, op, payload) : null);
// select:
select(cols) {
  rec('select', cols);
  const e = opts.readError ? opts.readError(table) : null;
  const td = opts.tableData || {};
  return Promise.resolve(e ? { data: null, error: e } : { data: td[table] || [], error: null });
},
// upsert:
upsert(rows) {
  rec('upsert', rows);
  const e = err('upsert', rows);
  return Promise.resolve(e ? { data: null, error: e } : { data: rows, error: null });
},
// in(col, vals) — this is where .delete().in('id', ids) resolves:
in(col, vals) {
  rec('in', { col, vals });
  const e = err('delete', vals);
  return Promise.resolve(e ? { data: null, error: e } : { data: null, error: null });
},
```

Note `tableData` must be read lazily (inside `select`, not captured at construction) so tests can set server state per-call.

**Step 2: Storage mock — record calls and allow failure:**

```js
storage: {
  from: (bucket) => ({
    upload: (path, blob, o) => {
      calls.push({ table: '_storage', op: 'upload', payload: { bucket, path } });
      const e = opts.storageError ? opts.storageError(path) : null;
      return Promise.resolve(e ? { data: null, error: e } : { data: { path }, error: null });
    },
    getPublicUrl: (path) => ({ data: { publicUrl: 'https://stub.supabase.co/storage/v1/object/public/' + bucket + '/' + path } }),
  }),
},
```

**Step 3: Capture window/document event listeners** so tests can fire `online` / `visibilitychange`. Replace the no-op `sandbox.addEventListener` and `document.addEventListener`:

```js
const windowListeners = {};
sandbox.addEventListener = (t, fn) => { (windowListeners[t] = windowListeners[t] || []).push(fn); };
// document stub:
addEventListener(t, fn) { (windowListeners['doc:' + t] = windowListeners['doc:' + t] || []).push(fn); },
```

Expose on the api object: `windowListeners`, plus `fireWindow(type) { (windowListeners[type] || []).forEach(fn => fn({ type })); }` and the same for `fireDocument`.

**Step 4: Canvas stub** (Phase 1's photo tests exercise `compressImage`, which calls `getContext`/`toDataURL`). In `makeEl`, add:

```js
getContext() { return { drawImage() {}, fillRect() {} }; },
toDataURL() { return 'data:image/jpeg;base64,U1RVQg=='; },
```

**Step 5: Expose new app globals and `opts`.** Add `'DEAD', 'KV', 'OFFLINE'` to `LIVE_BINDINGS`, and `api.opts = opts;` so tests mutate injection hooks at runtime.

**Step 6: Verify nothing regressed:** `node tools/fv_smoke.js index.html` → `RESULT: PASS (96/96)`.

**Step 7: Commit** — `git commit -m "Harness: failure injection, storage recording, event capture, canvas stub"`

---

# Phase 1 — Photos to Supabase Storage (before any caching)

### Task 1.1: Storage bucket + policies (production migration)

**Step 1: Apply idempotent SQL via the Management API** (the `unit-photos` bucket already exists per HANDOFF §7 — this makes it public-read/auth-write and is safe to re-run):

```sql
insert into storage.buckets (id, name, public) values ('unit-photos','unit-photos', true)
on conflict (id) do update set public = true;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                 and policyname='unit-photos auth write') then
    create policy "unit-photos auth write" on storage.objects
      for insert to authenticated with check (bucket_id = 'unit-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                 and policyname='unit-photos public read') then
    create policy "unit-photos public read" on storage.objects
      for select to public using (bucket_id = 'unit-photos');
  end if;
end $$;
```

**Step 2: Verify** — upload a 1-byte test object with the anon key + a signed-in session via curl, fetch its public URL (expect 200), delete it. No commit (nothing in repo changed).

### Task 1.2: Lazy photo upload at flush time (bounded)

Capture UX is unchanged (photos land in the row as data URIs — works offline). At flush time, data URIs are uploaded and swapped for public URLs, so **persisted rows only ever grow URLs when Storage is reachable, and nothing blocks when it isn't**. The pass is bounded — a cap per flush and a timeout per upload — because it runs inside `flush()` with `flushing=true`; an unbounded stall on bad LTE would hold the flush lock open and reopen the mid-flight-mutation window.

**Files:**
- Modify: `index.html` (new helpers near `compressImage`, ~line 614; hook at top of `flush()`, line 313)
- Create: `tools/fv_inv_photos.js`

**Step 1: Write the failing invariants** — `tools/fv_inv_photos.js`:

```js
'use strict';
module.exports = async (app, t) => {
  const D = 'data:image/jpeg;base64,U1RVQg==';
  t.group('photos: lazy upload at flush');

  app.setState({ units: [{ id: 'u1', serial: 'A1', photos: [D], jobMeta: {} }] });
  app.SYNC_READY = true;
  app.supabaseCalls.length = 0;
  await app.fn.flush();

  const ups = app.supabaseCalls.filter(c => c.table === 'units' && c.op === 'upsert');
  t.ok(ups.length === 1, 'unit row upserted');
  const sent = JSON.stringify(ups[0].payload);
  t.excludes(sent, 'data:image', 'no base64 in upsert payload when Storage reachable');
  t.includes(sent, 'storage/v1/object/public/unit-photos', 'photo persisted as public URL');
  t.ok(app.supabaseCalls.some(c => c.op === 'upload'), 'blob actually uploaded');

  t.group('photos: Storage failure does not block the save');
  app.opts.storageError = () => ({ message: 'Failed to fetch' });
  app.setState({ units: [{ id: 'u2', serial: 'A2', photos: [D], jobMeta: {} }] });
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  app.opts.storageError = null;
  const ups2 = app.supabaseCalls.filter(c => c.table === 'units' && c.op === 'upsert');
  t.ok(ups2.length === 1, 'row still saves when Storage is down');
  t.eq(app.S.units[0].photos[0], D, 'data URI retained for a later retry, not dropped');

  t.group('photos: upload pass is bounded per flush');
  const many = Array.from({ length: 10 }, () => D);
  app.setState({ units: [{ id: 'u3', serial: 'A3', photos: many, jobMeta: {} }] });
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  const uploads = app.supabaseCalls.filter(c => c.op === 'upload').length;
  t.ok(uploads <= 6, 'at most PHOTO_FLUSH_CAP uploads per flush (got ' + uploads + ')');
  t.ok(app.S.units[0].photos.some(p => p.slice(0, 5) === 'data:'), 'overflow photos remain queued for the next flush');
};
```

**Step 2: Run to verify it fails:** `node tools/fv_smoke.js index.html tools/fv_inv_photos.js`
Expected: FAIL — `no base64 in upsert payload` (payload still contains `data:image`).

**Step 3: Implement in `index.html`** (next to the photo helpers):

```js
function isDataURI(p){return typeof p==='string'&&p.slice(0,5)==='data:';}
function dataURItoBlob(d){const i=d.indexOf(',');const mime=(d.slice(0,i).match(/data:(.*?)(;|$)/)||[])[1]||'image/jpeg';const bin=atob(d.slice(i+1));const arr=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)arr[k]=bin.charCodeAt(k);return new Blob([arr],{type:mime});}
const PHOTO_FLUSH_CAP=6,PHOTO_UPLOAD_MS=8000;
const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);
async function syncPendingPhotos(){const jobs=[];S.units.forEach(o=>{(o.photos||[]).forEach((p,i)=>{if(isDataURI(p))jobs.push({o,i,path:'units/'+o.id+'/'+uid()+'.jpg'});});});S.issues.forEach(o=>{(o.photos||[]).forEach((p,i)=>{if(isDataURI(p))jobs.push({o,i,path:'issues/'+o.id+'/'+uid()+'.jpg'});});});
  for(const j of jobs.slice(0,PHOTO_FLUSH_CAP)){try{const {error}=await withTimeout(sb.storage.from('unit-photos').upload(j.path,dataURItoBlob(j.o.photos[j.i]),{contentType:'image/jpeg'}),PHOTO_UPLOAD_MS);if(error)continue;const {data}=sb.storage.from('unit-photos').getPublicUrl(j.path);if(data&&data.publicUrl)j.o.photos[j.i]=data.publicUrl;}catch(e){}}}
```

Hook: first line inside `flush()`'s `try` block: `await syncPendingPhotos();` (before the diff loop — the swap must happen before rows are serialized). Overflow beyond the cap stays as data URIs → the row stays dirty → the tail-drain `scheduleFlush()` (Task 3.3) picks them up next pass. (Harness note: the timeout race's reject timer is captured, never fires — safe.)

**Step 4: Run to verify it passes:** same command → `RESULT: PASS`, all 96 existing assertions still green.

**Step 5: Commit** — `git commit -m "Photos upload to Storage at flush (bounded); rows persist URLs, offline capture keeps data URIs"`

### Task 1.3: Migrate existing production photos

**Files:**
- Create: `tools/fv_migrate_photos.js`

**Step 1: Write the script** (Node ≥18, global fetch; idempotent — skips anything that isn't a data URI):

```js
#!/usr/bin/env node
'use strict';
const URLB = 'https://eujgglfcpdfgskyqfggg.supabase.co';
const KEY = process.env.FV_ANON_KEY, EMAIL = process.env.FV_EMAIL, PASS = process.env.FV_PASSWORD;
if (!KEY || !EMAIL || !PASS) { console.error('need FV_ANON_KEY FV_EMAIL FV_PASSWORD'); process.exit(1); }
const DRY = process.argv.includes('--dry-run');

(async () => {
  const auth = await fetch(`${URLB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  }).then(r => r.json());
  if (!auth.access_token) { console.error('auth failed', auth); process.exit(1); }
  const H = { apikey: KEY, Authorization: `Bearer ${auth.access_token}` };

  for (const table of ['units', 'issues']) {
    const rows = await fetch(`${URLB}/rest/v1/${table}?select=id,photos`, { headers: H }).then(r => r.json());
    for (const row of rows) {
      if (!Array.isArray(row.photos) || !row.photos.some(p => String(p).startsWith('data:'))) continue;
      const out = [];
      for (const p of row.photos) {
        if (!String(p).startsWith('data:')) { out.push(p); continue; }
        const path = `${table}/${row.id}/${Date.now()}-${out.length}.jpg`;
        if (DRY) { console.log(`[dry] would upload ${table}/${row.id} -> ${path}`); out.push(p); continue; }
        const buf = Buffer.from(p.slice(p.indexOf(',') + 1), 'base64');
        const up = await fetch(`${URLB}/storage/v1/object/unit-photos/${path}`, {
          method: 'POST', headers: { ...H, 'Content-Type': 'image/jpeg' }, body: buf,
        });
        if (!up.ok) { console.error(`upload FAILED ${table}/${row.id}: ${up.status} — row left untouched`); out.length = 0; break; }
        out.push(`${URLB}/storage/v1/object/public/unit-photos/${path}`);
      }
      if (!out.length || DRY) continue;
      const patch = await fetch(`${URLB}/rest/v1/${table}?id=eq.${row.id}`, {
        method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ photos: out }),
      });
      console.log(`${table}/${row.id}: ${out.length} photo(s) ${patch.ok ? 'migrated' : 'PATCH FAILED ' + patch.status}`);
    }
  }
})();
```

**Step 2: Dry-run against production:** `FV_ANON_KEY=... FV_EMAIL=... FV_PASSWORD=... node tools/fv_migrate_photos.js --dry-run` — review the list, confirm the count matches expectation (~50 units × up to 3 photos).

**Step 3: Run for real, then verify:** re-run with `--dry-run` again — expected output: *no rows listed* (all URLs now). Spot-check one photo URL in a browser (200, renders).

**Step 4: Commit** — `git commit -m "Add one-time base64->Storage photo migration script (idempotent)"`

### Task 1.4: Deploy Phase 1

**Step 1:** Bump the build marker (`index.html:13`) to `<!-- fleetview build YYYY-MM-DD photos-storage -->`.
**Step 2:** `python3 tools/fv_deploy.py preflight -m "photos to storage"` → PASS.
**Step 3:** `git add -A && git commit -m "Ship photos-to-Storage" && git push`.
**Step 4:** Verify live marker (curl command above). Open the live app on a phone: unit photos render (now from Storage URLs); add a photo; confirm it appears on a second device via realtime.
**Step 5:** Update `HANDOFF.md` §7: photos debt paragraph → resolved, describe the lazy-upload design. Commit separately: `git commit -m "HANDOFF: record photos-to-Storage"`.

---

# Phase 2 — Service worker (shell opens offline; safe to un-ship)

### Task 2.1: `sw.js`

**Files:**
- Create: `sw.js`

**Step 1: Write the full worker:**

```js
/* fleetview service worker — VERSION must be bumped when this file's logic changes.
   KILL=true is the kill switch: deploying that variant unregisters the SW and clears
   caches on every installed phone within one SW update-check cycle. */
const VERSION = 'fv-sw-1';
const KILL = false;
const SHELL = VERSION + '-shell', CDN = VERSION + '-cdn';
const CDN_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  if (KILL) { self.skipWaiting(); return; }
  e.waitUntil(caches.open(SHELL).then((c) => c.add('./index.html')).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    if (KILL) {
      const ks = await caches.keys();
      await Promise.all(ks.map((k) => caches.delete(k)));
      await self.registration.unregister();
      return;
    }
    const ks = await caches.keys();
    await Promise.all(ks.filter((k) => k !== SHELL && k !== CDN).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  if (KILL) return;
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') { e.respondWith(netFirst(req)); return; }
  if (CDN_HOSTS.includes(url.hostname)) { e.respondWith(cacheFirst(req)); return; }
  // everything else (Supabase, nominatim, OSM tiles): straight to network, untouched
});

async function netFirst(req) {
  const c = await caches.open(SHELL);
  try {
    const res = await fetchWithTimeout(req, 3500);
    if (res && res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await c.match(req)) || (await c.match('./index.html'));
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req) {
  const c = await caches.open(CDN);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
  return res;
}
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sw-timeout')), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}
```

Design notes the implementer must not "improve" away:
- **Navigations are network-first with a 3.5 s timeout** — online users always get the freshly deployed HTML (the instant-update property survives); the cache is only a fallback. `c.put(req, ...)` keys by full request URL so a sandbox copy under this scope never gets served production HTML.
- **Only the five CDN hosts are cache-first.** Supabase must never be intercepted (auth/realtime/PostgREST all break on cached responses).
- **Kill switch:** deploying `sw.js` with `KILL = true` makes install skip-wait immediately, activate wipe all caches and unregister, and fetch pass through. Browsers re-check `sw.js` bytes on navigation (GitHub Pages serves ~10-min cache headers), so recovery propagates on next open.

**Step 2: Syntax check:** `node -e "new (require('vm').Script)(require('fs').readFileSync('sw.js','utf8')); console.log('syntax OK')"` → `syntax OK`. No commit yet — registration and invariants land with it.

### Task 2.2: Registration + update prompt in `index.html`

**Files:**
- Modify: `index.html` (init block ~line 742; a fixed update bar element + css)

**Step 1: Add the update bar** (markup next to `#toast`, css with the other fixed elements):

```html
<button id="updateBar" style="display:none" onclick="applySwUpdate()">Update ready — tap to refresh</button>
```
```css
#updateBar{position:fixed;top:calc(env(safe-area-inset-top) + 8px);left:50%;transform:translateX(-50%);z-index:2300;background:var(--accent);color:#fff;border:none;border-radius:999px;padding:10px 18px;font-family:var(--mono);font-size:12px;font-weight:700;box-shadow:var(--shadow);cursor:pointer}
```

**Step 2: Add registration** (called once from the init block):

```js
let swReg=null,swReloaded=false;
function initSW(){if(!('serviceWorker' in navigator)||location.protocol!=='https:')return;
  navigator.serviceWorker.register('sw.js').then(reg=>{swReg=reg;
    if(reg.waiting)swUpdateReady();
    reg.addEventListener('updatefound',()=>{const nw=reg.installing;if(!nw)return;
      nw.addEventListener('statechange',()=>{if(nw.state==='installed'&&navigator.serviceWorker.controller)swUpdateReady();});});
  }).catch(()=>{});
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(swReloaded)return;swReloaded=true;location.reload();});}
function swUpdateReady(){const b=$('#updateBar');if(b)b.style.display='';}
function applySwUpdate(){if(swReg&&swReg.waiting)swReg.waiting.postMessage('SKIP_WAITING');const b=$('#updateBar');if(b)b.style.display='none';}
```

Flow: new SW installs → waits (no auto-skip) → bar appears → tap posts `SKIP_WAITING` → `controllerchange` → one guarded reload. `location.reload` is a no-op in the harness stub, so eval stays safe.

**Step 3:** relative `'sw.js'` registration is what keeps the sandbox copy (Task 2.4) self-scoped — do not absolutize it.

### Task 2.3: SW invariants

**Files:**
- Create: `tools/fv_inv_sw.js`

**Step 1: Write the invariants** (static: the harness has no SW runtime — these pin the safety-critical structure so a refactor can't silently drop the kill switch):

```js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = (app, t) => {
  t.group('service worker: structure');
  const swPath = path.join(path.dirname(app.file), 'sw.js');
  t.ok(fs.existsSync(swPath), 'sw.js exists next to index.html');
  const src = fs.readFileSync(swPath, 'utf8');
  t.noThrow(() => new vm.Script(src), 'sw.js parses');
  t.includes(src, "const KILL", 'kill switch constant present');
  t.includes(src, 'registration.unregister', 'kill path unregisters');
  t.includes(src, 'caches.delete', 'kill path clears caches');
  t.includes(src, "SKIP_WAITING", 'skip-waiting message handler present');
  t.includes(src, "req.mode === 'navigate'", 'navigations handled');
  t.excludes(src, 'supabase', 'SW never touches Supabase requests');
  t.group('service worker: app registration');
  t.includes(app.code, "serviceWorker.register('sw.js')", 'relative registration (sandbox-scopable)');
  t.includes(app.code, 'controllerchange', 'reload-on-takeover wired');
  t.includes(app.code, 'updateBar', 'update prompt UI present');
  t.ok(typeof app.fn.applySwUpdate === 'function', 'applySwUpdate exists');
};
```

**Step 2: Run** `node tools/fv_smoke.js index.html tools/fv_inv_sw.js` → PASS (run before implementing 2.1/2.2 to see it fail).

**Step 3: Commit** — `git commit -m "Service worker: offline shell, CDN cache, update prompt, kill switch + invariants"` (includes sw.js, index.html changes, fv_inv_sw.js; marker bump waits for Task 2.5).

### Task 2.4: Sandbox drill (device verification before production)

Per HANDOFF §9's production rule and the stubbed-sandbox-qa pattern. The SW **must not** ship until this whole drill passes.

**Files:**
- Create (temporarily): `sandbox/index.html`, `sandbox/sw.js` — deleted at the end.

**Step 1: Build the sandbox copy.** Copy `index.html` → `sandbox/index.html`, then in the copy: (a) replace the `sb` client creation with an in-memory stub (same shape the harness uses — writes impossible by construction), (b) fake the session so the auth gate never shows, (c) namespace the localStorage keys, (d) insert a loud fixed banner `SANDBOX — NOT CONNECTED TO REAL DATA`. Copy `sw.js` → `sandbox/sw.js` unchanged. The relative registration confines its scope to `/fleet-view/sandbox/`.

**Step 2: Deploy the sandbox:** `git add sandbox && git commit -m "Temporary SW sandbox" && git push`. Wait for Pages.

**Step 3: Device drill on a real phone** (each is a checkpoint; any failure = fix and redeploy sandbox before proceeding):
1. Open `https://apginvests.github.io/fleet-view/sandbox/` — banner visible, app renders.
2. DevTools/inspect: SW registered with scope `/fleet-view/sandbox/`.
3. Airplane mode → force-close → reopen the URL: **app shell opens offline**.
4. Airplane mode off. Edit `sandbox/sw.js` `VERSION` to `fv-sw-2`, push, reload twice (first load fetches the new SW): **"Update ready" bar appears; tapping it reloads under the new SW** (verify version in DevTools).
5. **Kill drill:** push `sandbox/sw.js` with `KILL = true`. Reload twice. Verify: SW unregistered, caches gone (DevTools → Application), app still loads from network. This is the rehearsal of the production recovery procedure.
6. Confirm production is untouched: main app has **no** SW registered (scope check), no `sandbox` caches.

**Step 4: Tear down:** `git rm -r sandbox && git commit -m "Remove SW sandbox" && git push`. Verify `curl -s -o /dev/null -w "%{http_code}" https://apginvests.github.io/fleet-view/sandbox/index.html` → `404`.

**Step 5: Record the drill result** (date, phone model, pass/fail per checkpoint) in the commit message body of the teardown commit.

### Task 2.5: Deploy Phase 2 to production

**Step 1:** Bump build marker to `sw-shell`. Run `python3 tools/fv_deploy.py preflight -m "service worker"` → PASS.
**Step 2:** `git add -A && git commit -m "Ship service worker" && git push`. Verify marker live; verify `curl -s https://apginvests.github.io/fleet-view/sw.js | grep -o "fv-sw-[0-9]*"` returns the version.
**Step 3:** On a phone: open live app, confirm SW registers, then airplane-mode test the real origin (open offline → shell renders; data is still blank offline until Phase 3 — expected).
**Step 4:** Update `HANDOFF.md` §7 (remove "No service worker" debt; document tap-to-update + kill-switch procedure: *deploy `sw.js` with `KILL=true`, wait one update cycle*) and §10 (item 1a done). Separate commit.

---

# Phase 3 — The durable diff

All tests in this phase live in `tools/fv_inv_offline.js` (standing). Each task appends a `t.group(...)` block; the file accretes into the offline contract. Local fixture helpers at the top of the file:

```js
'use strict';
module.exports = async (app, t) => {
  let seq = 0; const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    opStatus: 'staged', locationType: 'show', locationId: 'show-A', photos: [], jobMeta: {}, updatedAt: 1000 }, o);
  const mkReport = (unitId, o = {}) => Object.assign({ id: id('r'), unitId, showId: 'show-A',
    techName: 'Mike R.', timestamp: 5000, gps: null }, o);
  // ... groups appended by Tasks 3.1–3.6 below ...
};
```

### Task 3.1: KV wrapper + durable cache

**Files:**
- Modify: `index.html` (new code near the sync layer, ~line 291; `boot()` line 326; `doSignOut()` line 325)
- Modify: `tools/fv_inv_offline.js`

**Step 1: Failing tests** (append group):

```js
t.group('durable cache: persists and hydrates');
app.setState({ units: [mkUnit({ id: 'u-cache', serial: 'CACHE1' })] });
app.SYNC_READY = true;
app.fn.persistCache(); app.flushTimers();          // debounce runs via captured timers
await Promise.resolve();                            // let KV promise settle
const cached = await app.live.KV.get('cache');
t.ok(cached && cached.v === 1, 'cache written');
t.eq(cached.tables.units[0].serial, 'CACHE1', 'unit round-trips through cache');
t.ok(cached.snap && cached.dead !== undefined, 'SNAP and dead-letter persisted');

app.setState({});                                   // wipe in-memory state
const hydrated = await app.fn.hydrateFromCache();
t.ok(hydrated, 'hydrate reports success');
t.eq(app.S.units[0].serial, 'CACHE1', 'offline cold boot is not an empty fleet');
```

**Step 2: Run to verify failure:** `node tools/fv_smoke.js index.html tools/fv_inv_offline.js` → FAIL (`persistCache` not found).

**Step 3: Implement.**

```js
/* KV — IndexedDB key-value store; in-memory fallback keeps the harness dependency-free */
const KV=(()=>{const mem=new Map();const useMem=(typeof indexedDB==='undefined');let dbp=null;
  const open=()=>dbp||(dbp=new Promise((res,rej)=>{const q=indexedDB.open('fleetview',1);
    q.onupgradeneeded=()=>q.result.createObjectStore('kv');
    q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);}));
  const tx=(mode,fn)=>open().then(d=>new Promise((res,rej)=>{const t=d.transaction('kv',mode);
    const r=fn(t.objectStore('kv'));t.oncomplete=()=>res(r&&r.result);t.onerror=()=>rej(t.error);}));
  return{
    get:k=>useMem?Promise.resolve(mem.get(k)):tx('readonly',s=>s.get(k)),
    set:(k,v)=>useMem?(mem.set(k,v),Promise.resolve()):tx('readwrite',s=>s.put(v,k)),
    del:k=>useMem?(mem.delete(k),Promise.resolve()):tx('readwrite',s=>s.delete(k)),
    _mem:mem};})();
let DEAD={},OFFLINE=false;
let cacheTimer=null;
function persistCache(){clearTimeout(cacheTimer);cacheTimer=setTimeout(()=>{const tables={};TABLES.forEach(t=>{tables[t]=S[t];});
  KV.set('cache',{v:1,tables,snap:SNAP,dead:DEAD,currentShowId:S.currentShowId,savedAt:now()}).catch(()=>{});},800);}
async function hydrateFromCache(){try{const c=await KV.get('cache');if(!c||c.v!==1)return false;
  TABLES.forEach(t=>{if(Array.isArray(c.tables[t]))S[t]=c.tables[t];});
  SNAP=c.snap||{};DEAD=c.dead||{};if(c.currentShowId)S.currentShowId=c.currentShowId;return true;}catch(e){return false;}}
```

Wire-up: `save()` additionally calls `persistCache()`. `doSignOut()` calls `KV.del('cache')` before `signOut()` (shared devices must not leak the fleet to the next account). `boot()` integration lands in Task 3.5.

**Step 4: Run to verify pass**, full sweep green. **Step 5: Commit** — `git commit -m "Durable cache: KV wrapper, S+SNAP+dead-letter persisted, hydrate"`

### Task 3.2: Server-received time (clock drift on event ordering)

**Files:**
- Production migration (Management API)
- Modify: `index.html` — `MAPS` (~line 297), `toRow` (line 305), `reportsFor`/`issuesFor` (346–347), `unitGps` (353), `eventsForShow` (560), `recentDests` (632), `paneMoves` movement sort
- Modify: `tools/fv_inv_offline.js`

**Step 1: Migration** (idempotent; `default now()` stamps arrival server-side, and only on insert):

```sql
alter table reports   add column if not exists received_at timestamptz not null default now();
alter table issues    add column if not exists received_at timestamptz not null default now();
alter table movements add column if not exists received_at timestamptz not null default now();
```

**Step 2: Failing tests:**

```js
t.group('clock drift: received_at is server-owned, device time displays, server time tiebreaks');
const M = app.live.MAPS;
['reports','issues','movements'].forEach(tb => {
  t.ok(M[tb].m.receivedAt === 'received_at', tb + ' maps receivedAt');
  t.ok((M[tb].ro || []).includes('receivedAt'), tb + ' receivedAt is read-only');
  t.ok(!('received_at' in app.fn.toRow(tb, { id: 'x' })), tb + ' toRow never writes received_at');
  t.eq(app.fn.fromRow(tb, { id: 'x', received_at: '2026-07-29T00:00:00.000Z' }).receivedAt,
       Date.parse('2026-07-29T00:00:00.000Z'), tb + ' fromRow parses received_at to ms');
});
app.setState({ units: [mkUnit({ id: 'u-clk' })], reports: [
  mkReport('u-clk', { id: 'r-early', timestamp: 5000, receivedAt: 100 }),
  mkReport('u-clk', { id: 'r-late',  timestamp: 5000, receivedAt: 200 }),
]});
t.eq(app.fn.reportsFor('u-clk')[0].id, 'r-late', 'device-time tie broken by server-received time');
app.S.movements = [
  { id: 'm1', unitId: 'u-clk', timestamp: 5000, receivedAt: 100, gps: { lat: 1, lng: 1 } },
  { id: 'm2', unitId: 'u-clk', timestamp: 5000, receivedAt: 200, gps: { lat: 2, lng: 2 } },
];
t.eq(app.fn.unitGps(app.S.units[0]).lat, 2, 'unitGps tiebreaks on server time');
```

**Step 3: Implement.**
- `MAPS`: add `receivedAt:'received_at'` to `m` and `'receivedAt'` to `dt` for reports/issues/movements; add `ro:['receivedAt']` to each.
- `toRow`: `const {m,dt,ro}=MAPS[t];` and first line of the loop: `if(ro&&ro.includes(a))continue;` (read-only columns are never written — this is what lets Postgres own the value and survive replay upserts).
- Shared comparator: `const byEventDesc=(a,b)=>(b.timestamp-a.timestamp)||((b.receivedAt||0)-(a.receivedAt||0))||String(a.id).localeCompare(String(b.id));` — use it in `reportsFor`, `issuesFor`, `eventsForShow` (map `receivedAt` onto the event objects), `recentDests`, `paneMoves`.
- `unitGps`: carry `receivedAt` into `best` and prefer newer `(timestamp, receivedAt)`.
- Display continues to use `timestamp` (device time) everywhere — no display change.

**Step 4:** Note: if the existing round-trip invariant in `fv_smoke.js` asserts `toRow(fromRow(x))` key-symmetry over `MAPS`, it will now rightly flag `receivedAt` — extend that one test to exempt `ro` keys, citing this task. **Step 5: Run** → PASS, full sweep green. **Step 6: Commit** — `git commit -m "Server-received time: received_at columns, read-only MAPS keys, (device, server) tiebreak ordering"`

### Task 3.3: Ack-correct flush with ordered replay and poison isolation

The heart of the feature. Replaces `flush()` (`index.html:313`) entirely.

**Files:**
- Modify: `index.html`
- Modify: `tools/fv_inv_offline.js`

**Step 1: Failing tests:**

```js
t.group('replay ordering: explicit dependency invariant');
const T = app.live.TABLES;
const DEPS = { units: ['shops','shows'], reports: ['units','shows'], issues: ['units','shows'], movements: ['units'] };
Object.entries(DEPS).forEach(([child, parents]) => parents.forEach(p =>
  t.ok(T.indexOf(p) !== -1 && T.indexOf(p) < T.indexOf(child), p + ' precedes ' + child + ' in TABLES')));

t.group('replay ordering: flush emits parents-first upserts, children-first deletes');
app.setState({ shows: [{ id: 's1', name: 'A' }], units: [mkUnit({ id: 'u-ord' })],
               reports: [mkReport('u-ord')] });
app.SYNC_READY = true;
app.live.SNAP = {};                                 // everything dirty
app.supabaseCalls.length = 0;
await app.fn.flush();
const upOrder = app.supabaseCalls.filter(c => c.op === 'upsert').map(c => c.table);
t.deep(upOrder, ['shows','units','reports'], 'upserts in TABLES order');
// now delete everything; deletes must run child-before-parent
app.S.reports = []; app.S.units = []; app.S.shows = [];
app.supabaseCalls.length = 0;
await app.fn.flush();
const delOrder = app.supabaseCalls.filter(c => c.op === 'delete').map(c => c.table);
t.deep(delOrder, ['reports','units','shows'], 'deletes in reverse TABLES order');

t.group('ack: a failed write stays queued (SNAP does not advance)');
app.setState({ units: [mkUnit({ id: 'u-ack', serial: 'ACK1' })] });
app.SYNC_READY = true; app.live.SNAP = {};
app.opts.writeError = () => ({ message: 'TypeError: Failed to fetch' });   // network down
await app.fn.flush();
t.ok(app.fn.dirtyCount() >= 1, 'row still dirty after network failure');
t.ok(app.live.OFFLINE === true, 'offline flag set');
app.opts.writeError = null;                                                // network back
app.supabaseCalls.length = 0;
await app.fn.flush();
t.ok(app.supabaseCalls.some(c => c.table === 'units' && c.op === 'upsert'), 'queued row re-sent');
t.eq(app.fn.dirtyCount(), 0, 'acked row is clean');
t.ok(app.live.OFFLINE === false, 'offline flag cleared');

t.group('ack: mutation during in-flight flush is not silently absorbed');
app.setState({ units: [mkUnit({ id: 'u-race' })] });
app.SYNC_READY = true; app.live.SNAP = {};
const p = app.fn.flush();                       // captures diff synchronously at entry
app.S.reports.push(mkReport('u-race', { id: 'r-race' }));   // lands mid-flight
await p;
t.ok(app.fn.dirtyCount() >= 1, 'mid-flight report still queued, not marked sent');

t.group('dead-letter: poison rows quarantined visibly, never dropped');
app.setState({ units: [mkUnit({ id: 'u-ok1' }), mkUnit({ id: 'u-poison', serial: 'BAD' }), mkUnit({ id: 'u-ok2' })] });
app.SYNC_READY = true; app.live.SNAP = {}; app.live.DEAD = {};
app.opts.writeError = (tb, op, rows) =>
  (tb === 'units' && JSON.stringify(rows).includes('BAD')) ? { message: 'new row violates row-level security policy', code: '42501' } : null;
await app.fn.flush();
app.opts.writeError = null;
t.eq(Object.keys(app.live.DEAD).length, 1, 'exactly the poison row is dead-lettered');
t.ok(app.live.DEAD['units:u-poison'], 'dead-letter keyed by table:id');
t.eq(app.live.DEAD['units:u-poison'].kind, 'poison', 'entry tagged as poison');
t.includes(app.live.DEAD['units:u-poison'].error, 'row-level security', 'server error preserved for the human');
t.ok(app.S.units.some(u => u.id === 'u-poison'), 'poison row data still present locally');
t.eq(app.fn.dirtyCount(), 0, 'healthy rows in the same batch were isolated and acked');
app.supabaseCalls.length = 0;
await app.fn.flush();
t.ok(!app.supabaseCalls.some(c => c.op === 'upsert'), 'quarantined row does not block or spam the queue');
app.fn.retryDead('units:u-poison');
await app.fn.flush();
t.eq(Object.keys(app.live.DEAD).length, 0, 'retry clears quarantine');
t.eq(app.fn.dirtyCount(), 0, 'retried row flushed clean');
```

**Step 2: Run to verify failure** (the DEPS precedence test may pass already — the rest must fail).

**Step 3: Implement** — replace `flush()` and add helpers:

```js
/* TABLES is dependency-ordered: parents before children. Guarded by fv_inv_offline.js —
   change the order there first or preflight blocks the deploy. */
const RETRYABLE=e=>{const m=String((e&&e.message)||e||'').toLowerCase();
  return m.includes('fetch')||m.includes('network')||m.includes('timeout')||m.includes('load failed')||m.includes('econn')||String(e&&e.code)==='429'||/^5\d\d$/.test(String(e&&e.code||''));};
const deadKey=(t,id)=>t+':'+id;
const isDead=(t,id)=>!!DEAD[deadKey(t,id)];
function captureDiff(){const d={ups:{},dels:{}};for(const t of TABLES){d.ups[t]=[];d.dels[t]=[];const cur={};
  S[t].forEach(o=>{cur[o.id]=1;if(isDead(t,o.id))return;const rs=JSON.stringify(toRow(t,o));
    if(!SNAP[t]||SNAP[t][o.id]!==rs)d.ups[t].push({id:o.id,rs,row:toRow(t,o)});});
  if(SNAP[t])for(const id in SNAP[t]){if(!cur[id]&&!isDead(t,id))d.dels[t].push(id);}}return d;}
function dirtyCount(){let n=0;const d=captureDiff();TABLES.forEach(t=>{n+=d.ups[t].length+d.dels[t].length;});return n;}
async function isolatePoison(t,ups){for(const u of ups){const {error}=await sb.from(t).upsert([u.row]);
  if(!error){SNAP[t]=SNAP[t]||{};SNAP[t][u.id]=u.rs;}
  else if(RETRYABLE(error))return true;                       // net died mid-isolation: stay dirty
  else DEAD[deadKey(t,u.id)]={kind:'poison',table:t,op:'upsert',row:u.row,error:String(error.message||error),ts:now()};}
  return false;}
async function flush(){if(!SYNC_READY||flushing)return;flushing=true;let netFail=false;
  try{
    await syncPendingPhotos();
    const d=captureDiff();
    for(const t of TABLES){const ups=d.ups[t];if(!ups.length)continue;
      const {error}=await sb.from(t).upsert(ups.map(u=>u.row));
      if(!error){SNAP[t]=SNAP[t]||{};ups.forEach(u=>{SNAP[t][u.id]=u.rs;});}
      else if(RETRYABLE(error)){netFail=true;break;}          // stop: children must not outrun a failed parent
      else if(await isolatePoison(t,ups)){netFail=true;break;}}
    if(!netFail)for(const t of TABLES.slice().reverse()){const dels=d.dels[t];if(!dels.length)continue;
      const {error}=await sb.from(t).delete().in('id',dels);
      if(!error)dels.forEach(id=>{if(SNAP[t])delete SNAP[t][id];});
      else if(RETRYABLE(error)){netFail=true;break;}
      else dels.forEach(id=>{DEAD[deadKey(t,id)]={kind:'poison',table:t,op:'delete',rowId:id,error:String(error.message||error),ts:now()};
        if(SNAP[t])delete SNAP[t][id];});}                    // stop re-sending; intent preserved in dead-letter
  }catch(e){netFail=true;console.warn('flush',e);}
  flushing=false;OFFLINE=netFail;persistCache();updatePendingUI();
  if(!netFail&&dirtyCount())scheduleFlush();}                 // drain what landed mid-flight (and capped photos)
function retryDead(k){delete DEAD[k];persistCache();scheduleFlush();}
function dismissDead(k){delete DEAD[k];persistCache();updatePendingUI();}
```

Contract notes: `captureDiff()` runs **synchronously at entry** — that plus per-row acks from the *captured* serialization (`u.rs`, never re-serialized) is what closes the mid-flight race. The old trailing `snapshot()` call in `flush()` is deleted. `snapshot()` itself stays (harness `setState` uses it; boot-from-empty still can).

`dirtyCount()` re-serializes every row; at fleet scale (≲1k small rows post-Phase-1) this is <5 ms and only runs after flush/save — do not "optimize" it with bookkeeping that can drift.

**Step 4: Run** → PASS; full sweep green (existing invariants exercise `flush` via the old path — fix any that asserted the old snapshot behavior only if their *contract* was "writes reach supabaseCalls", which still holds). **Step 5: Commit** — `git commit -m "Ack-correct flush: captured diff, per-row acks, ordered replay, poison quarantine"`

### Task 3.4: Dead-letter + pending UI

**Files:**
- Modify: `index.html` (topbar markup ~line 224; new sheet functions near `openSettings`)
- Modify: `tools/fv_inv_offline.js`

**Step 1: Failing tests:**

```js
t.group('dead-letter: visible, recoverable');
app.setState({ units: [mkUnit({ id: 'u-dl' })] }); app.SYNC_READY = true;
app.live.DEAD = {
  'units:u-dl': { kind: 'poison', table: 'units', op: 'upsert', row: { id: 'u-dl', serial: 'DL1' }, error: 'RLS says no', ts: 1753000000000 },
  'lww:units:u-lost:1': { kind: 'superseded', table: 'units', row: { id: 'u-lost', serial: 'LOST1', notes: 'my note' }, error: 'Overwritten by a newer edit from another device', ts: 1753000000000 },
};
app.fn.updatePendingUI();
const chip = app.document.querySelector('#syncChip');
t.ok(chip.style.display !== 'none', 'sync chip visible when something is stuck');
app.fn.openSyncStatus();
const sheetHtml = app.document.querySelector('#sheet').innerHTML;
t.includes(sheetHtml, 'RLS says no', 'server error shown to the human');
t.includes(sheetHtml, 'retryDead', 'retry action offered for poison rows');
t.includes(sheetHtml, 'LOST1', 'LWW-superseded row is listed, not hidden');
t.includes(sheetHtml, 'dismissDead', 'superseded rows offer dismiss, not retry');
t.includes(sheetHtml, 'copyDead', 'copy-JSON escape hatch offered');
t.excludes(sheetHtml.split('lww:')[1] || '', 'retryDead', 'no retry on superseded (would replay a stale row)');
t.group('pending UI: clean and online = invisible');
app.live.DEAD = {}; app.live.OFFLINE = false;
app.setState({ units: [mkUnit()] });               // setState snapshots => clean
app.fn.updatePendingUI();
t.eq(app.document.querySelector('#syncChip').style.display, 'none', 'chip hidden when clean');
```

**Step 2: Implement.** Topbar (before the theme button): `<button class="iconbtn" id="syncChip" style="display:none;width:auto;padding:0 10px;font-family:var(--mono);font-size:11px" onclick="openSyncStatus()"></button>`

```js
function updatePendingUI(){const el=$('#syncChip');if(!el)return;const n=dirtyCount(),dead=Object.keys(DEAD).length;
  if(!n&&!dead&&!OFFLINE){el.style.display='none';return;}
  el.style.display='';el.style.color=dead?'var(--red)':(OFFLINE?'var(--orange)':'var(--ink2)');
  el.textContent=(OFFLINE?'⇅ offline':'⇅')+(n?(' '+n):'')+(dead?(' ⚠'+dead):'');}
function openSyncStatus(){const n=dirtyCount();const ks=Object.keys(DEAD);
  const stuck=ks.filter(k=>DEAD[k].kind==='poison'),lost=ks.filter(k=>DEAD[k].kind==='superseded');
  const card=(k,actions)=>{const d=DEAD[k];const label=d.op==='delete'?(d.table+' · delete'):(d.table+' · '+esc((d.row&&(d.row.serial||d.row.title||d.row.id))||''));
    return `<div class="card" style="padding:12px;margin-bottom:8px;border-left:5px solid ${d.kind==='poison'?'var(--red)':'var(--orange)'}"><b style="font-size:13px">${label}</b><div class="muted" style="font-size:11px;margin-top:3px">${esc(d.error)}</div><div class="muted" style="font-size:11px">${fmtDate(d.ts)}</div><div class="row" style="margin-top:8px">${actions(k)}</div></div>`;};
  const stuckRows=stuck.map(k=>card(k,k2=>`<button class="btn dark sm wide" onclick="retryDead('${esc(k2)}');closeSheet();toast('Retrying…')">Retry</button><button class="btn ghost sm wide" onclick="copyDead('${esc(k2)}')">Copy JSON</button>`)).join('');
  const lostRows=lost.map(k=>card(k,k2=>`<button class="btn ghost sm wide" onclick="copyDead('${esc(k2)}')">Copy JSON</button><button class="btn ghost sm wide" onclick="dismissDead('${esc(k2)}');openSyncStatus()">Dismiss</button>`)).join('');
  sheet('Sync status',`<div class="card" style="padding:13px;margin-bottom:12px"><div class="kv"><div class="k">Connection</div><div>${OFFLINE?'Offline — retrying automatically':'Online'}</div><div class="k">Waiting</div><div>${n} change(s)</div><div class="k">Stuck</div><div>${stuck.length}</div><div class="k">Overwritten</div><div>${lost.length}</div></div></div>${stuck.length?`<h2 class="section sm">Stuck changes</h2><p class="muted" style="font-size:12px">The server refused these. They're parked here so nothing else is blocked — nothing has been deleted.</p>${stuckRows}`:''}${lost.length?`<h2 class="section sm">Overwritten while offline</h2><p class="muted" style="font-size:12px">Someone else edited these units more recently, so their version won. Your entry is kept here — copy it out if it still matters, then re-enter what's current.</p>${lostRows}`:''}<button class="btn primary block" onclick="netBack();closeSheet();toast('Syncing…')">Sync now</button>`);}
function copyDead(k){try{navigator.clipboard.writeText(JSON.stringify(DEAD[k],null,2));}catch(e){}toast('Copied');}
```

Superseded entries deliberately get **Dismiss + Copy, not Retry** — retrying would replay the stale row over the fresher one, which is the exact bug the merge exists to prevent. Field-UI rules honored: no new required anything, one chip that's invisible when all is well.

**Step 3: Run** → PASS. **Step 4: Commit** — `git commit -m "Sync status chip + dead-letter sheet (poison: retry; superseded: dismiss/copy)"`

### Task 3.5: Merge-on-load (replaces wholesale replace) + LWW precondition

**Files:**
- Modify: `index.html` — `loadAll` (line 308), `scheduleReload` (316), `boot` (326), `rmUnitPhoto` (624 — bug: doesn't bump `updatedAt`)
- Modify: `tools/fv_inv_offline.js`

**Step 1: Failing tests:**

```js
t.group('merge: reload never destroys queued work');
app.setState({}); app.SYNC_READY = true;
app.S.reports.push(mkReport('u-x', { id: 'r-pending' }));            // dirty local report
app.opts.tableData = { reports: [] };                                 // server doesn't have it
await app.fn.loadAllMerge();
t.ok(app.S.reports.some(r => r.id === 'r-pending'), 'dirty report survives reload');
t.ok(app.fn.dirtyCount() >= 1, 'still queued for flush after reload');

t.group('merge: pending local delete survives reload and still deletes');
app.setState({ units: [mkUnit({ id: 'u-del', updatedAt: 1000 })] }); // snapshotted = clean
app.S.units = [];                                                     // local delete, unflushed
app.opts.tableData = { units: [app.fn.toRow('units', mkUnit({ id: 'u-del', updatedAt: 1000 }))] };
await app.fn.loadAllMerge();
t.eq(app.S.units.length, 0, 'deleted unit does not resurrect on reload');
app.supabaseCalls.length = 0;
await app.fn.flush();
t.ok(app.supabaseCalls.some(c => c.table === 'units' && c.op === 'delete'), 'delete still reaches the server');

t.group('merge: units LWW — stale replay cannot move a unit, and the loser is parked, not vaporized');
app.live.DEAD = {};
const localStale = mkUnit({ id: 'u-lww', updatedAt: 1000, opStatus: 'down', locationType: 'show', locationId: 'show-OLD', notes: 'offline note' });
app.setState({ units: [mkUnit({ id: 'u-lww', updatedAt: 500 })] });   // baseline
app.S.units[0] = localStale;                                          // local offline edit @ t=1000
const serverFresh = mkUnit({ id: 'u-lww', updatedAt: 2000, opStatus: 'running', locationType: 'show', locationId: 'show-NEW' });
app.opts.tableData = { units: [app.fn.toRow('units', serverFresh)] };
await app.fn.loadAllMerge();
t.eq(app.S.units[0].locationId, 'show-NEW', 'fresher server location wins');
t.eq(app.S.units[0].opStatus, 'running', 'fresher server status wins');
t.eq(app.fn.dirtyCount(), 0, 'losing local diff is not re-flushed');
const lwwKeys = Object.keys(app.live.DEAD).filter(k => k.indexOf('lww:') === 0);
t.eq(lwwKeys.length, 1, 'losing local edit parked in the visible list — NOT silently discarded');
t.eq(app.live.DEAD[lwwKeys[0]].kind, 'superseded', 'parked entry tagged superseded');
t.includes(JSON.stringify(app.live.DEAD[lwwKeys[0]].row), 'offline note', 'full losing row preserved for the tech');

t.group('merge: newer local edit survives a reload');
app.live.DEAD = {};
app.setState({ units: [mkUnit({ id: 'u-lww2', updatedAt: 500 })] });
app.S.units[0].notes = 'local edit'; app.S.units[0].updatedAt = 3000;
app.opts.tableData = { units: [app.fn.toRow('units', mkUnit({ id: 'u-lww2', updatedAt: 2000 }))] };
await app.fn.loadAllMerge();
t.eq(app.S.units[0].notes, 'local edit', 'newer local unit edit kept');
t.ok(app.fn.dirtyCount() >= 1, 'and still queued');
t.eq(Object.keys(app.live.DEAD).length, 0, 'winner is not parked');
app.opts.tableData = null;

t.group('LWW precondition: every S.units mutator bumps updatedAt');
// Each case: seed a unit with updatedAt=1, drive the mutator through the DOM stub, assert bump.
// document.querySelector caches per selector, so form values can be preset.
const drive = (name, setup, invoke) => {
  app.setState({ units: [mkUnit({ id: 'u-mut', updatedAt: 1 })],
                 shows: [{ id: 'show-A', name: 'A' }], shops: [] });
  app.S.settings.techName = 'Mike R.';
  setup && setup();
  try { invoke(); } catch (e) { t.ok(false, name + ' threw: ' + e.message); return; }
  app.flushTimers();
  const u = app.S.units.find(x => x.id === 'u-mut');
  t.ok(u && u.updatedAt > 1, name + ' bumps updatedAt (got ' + (u && u.updatedAt) + ')');
};
drive('saveVitals',   () => { app.document.querySelector('#v_notes').value = 'ok'; }, () => app.fn.saveVitals('u-mut'));
drive('saveIssue',    () => { app.document.querySelector('#i_title').value = 'leak'; }, () => app.fn.saveIssue('u-mut'));
drive('saveService',  () => { app.document.querySelector('#s_cur').value = '10'; app.document.querySelector('#s_due').value = '250'; }, () => app.fn.saveService('u-mut'));
drive('doServiced',   () => { app.document.querySelector('#ms_at').value = '10'; app.document.querySelector('#ms_int').value = '250'; }, () => app.fn.doServiced('u-mut'));
drive('saveJobMeta',  () => { app.document.querySelector('#jm_name').value = 'Stage'; app.document.querySelector('#jm_area').value = ''; app.document.querySelector('#jm_note').value = ''; }, () => app.fn.saveJobMeta('u-mut', 'show-A'));
drive('doMove',       null, () => app.fn.doMove('u-mut', 'shop', null));
drive('doShip',       () => { app.document.querySelector('#shipTo').value = 'show-A'; }, () => app.fn.doShip('u-mut'));
drive('mapSetLoc',    null, () => app.fn.mapSetLoc('u-mut'));
drive('capturePlacement', null, () => app.fn.capturePlacement('u-mut'));
drive('rmUnitPhoto',  () => { app.S.units[0].photos = ['https://x/p.jpg']; }, () => app.fn.rmUnitPhoto('u-mut', 0));
```

**Step 2: Run to verify failure** — expect at minimum `loadAllMerge not found` and `rmUnitPhoto bumps updatedAt` failing.

**Step 3: Implement:**

```js
function mergeServerState(t,serverRows){const server={};serverRows.forEach(r=>{server[r.id]=r;});
  const localById={};S[t].forEach(o=>{localById[o.id]=o;});
  const merged={},outSnap={};
  for(const id in server){merged[id]=server[id];outSnap[id]=JSON.stringify(toRow(t,server[id]));}
  if(SNAP[t])for(const id in SNAP[t]){if(!localById[id]&&!isDead(t,id)&&server[id])delete merged[id];} // pending delete: row stays gone; outSnap keeps server row so the diff still emits the delete
  S[t].forEach(o=>{if(isDead(t,o.id))return;                                   // quarantined: server version stands; payload lives in DEAD
    const rs=JSON.stringify(toRow(t,o));const snapRs=SNAP[t]?SNAP[t][o.id]:undefined;
    if(snapRs===rs)return;                                                     // clean: server version stands
    const sv=server[o.id];
    if(t==='units'&&sv&&sv.updatedAt!=null&&o.updatedAt!=null&&sv.updatedAt>=o.updatedAt){
      DEAD['lww:'+t+':'+o.id+':'+now()]={kind:'superseded',table:t,row:o,
        error:'Overwritten by a newer edit from another device',ts:now()};     // loser parked, never silent
      return;}
    merged[o.id]=o;if(snapRs!==undefined)outSnap[o.id]=snapRs;else delete outSnap[o.id];});      // keep dirty
  S[t]=Object.values(merged);SNAP[t]=outSnap;}
async function loadAllMerge(){let allOk=true;
  for(const t of TABLES){const {data,error}=await sb.from(t).select('*');
    if(error){allOk=false;continue;}                                           // failed table: keep local state AND its pending diff
    mergeServerState(t,(data||[]).map(r=>fromRow(t,r)));}
  OFFLINE=!allOk;persistCache();updatePendingUI();return allOk;}
```

**Why device-time LWW is acceptable here** (the settled decision, restated where the code lives — put this comment on `mergeServerState`): the local side is an unacked row that has never reached the server, so no server-side timestamp can arbitrate; phone clocks are NTP-synced (drift ≪ edit spacing); a wrong winner requires genuinely concurrent edits where either outcome is defensible; and the loser lands in the Overwritten list — a reviewable event, not silent corruption.

Rewire: `scheduleReload`'s timer body calls `await loadAllMerge();render();`. `loadAll` is deleted (grep for remaining callers — `boot` is the only one). Fix `rmUnitPhoto`: add `u.updatedAt=now();` before `save()`.

`boot()` becomes:

```js
async function boot(){authMsg('Loading…');const {data:{session}}=await sb.auth.getSession();if(!session){showAuth();return;}
  USER=session.user;const nm=(USER.user_metadata&&USER.user_metadata.name)||'';
  S.settings.techName=nm||(USER.email?USER.email.split('@')[0]:'Tech');hideAuth();
  const cached=await hydrateFromCache();
  TAB=(S.settings.homeTab==='fleet')?'fleet':'jobs';setActiveNav(TAB);
  if(cached){SYNC_READY=true;render();}                        // show last-known data immediately
  const ok=await loadAllMerge();SYNC_READY=true;
  subscribeRealtime();initNetTriggers();render();
  if(!ok&&!cached)toast('Offline — will sync when you have signal');
  if(!nm)setTimeout(promptName,500);}
```

**Step 4: Run** → PASS; full sweep green (per-job isolation and status-color invariants re-verify against merged state for free). **Step 5: Commit** — `git commit -m "Reload merges over pending diff; units LWW parks losers visibly; all unit mutators bump updatedAt"`

### Task 3.6: Retry triggers + reconnect sequence

**Files:**
- Modify: `index.html` (new `initNetTriggers`/`netBack` near the sync layer)
- Modify: `tools/fv_inv_offline.js`

**Step 1: Failing tests:**

```js
t.group('reconnect: read-merge-then-write, triggered by the online event');
app.setState({ units: [mkUnit({ id: 'u-net', updatedAt: 9000 })] }); app.SYNC_READY = true;
app.S.units[0].notes = 'queued offline'; app.S.units[0].updatedAt = 9500;
app.opts.tableData = { units: [] };
app.fn.initNetTriggers();
app.fn.initNetTriggers();                                     // deliberate double call
t.eq((app.windowListeners['online'] || []).length, 1, 'online listener registered exactly once');
t.eq((app.windowListeners['doc:visibilitychange'] || []).length, 1, 'visibility listener registered exactly once');
app.supabaseCalls.length = 0;
app.fireWindow('online');
await new Promise(r => setTimeout(r, 0)); app.flushTimers(); await new Promise(r => setTimeout(r, 0));
const calls = app.supabaseCalls;
const firstSelect = calls.findIndex(c => c.op === 'select');
const firstUpsert = calls.findIndex(c => c.op === 'upsert');
t.ok(firstSelect !== -1 && firstUpsert !== -1, 'reconnect both reloads and flushes');
t.ok(firstSelect < firstUpsert, 'merge (read) strictly precedes flush (write) on reconnect');
app.opts.tableData = null;
```

(The harness captures the app's `setTimeout` into `timers`; the `setTimeout(r, 0)` calls above are Node's own inside the test file — they drain microtasks between the app's captured timer hops.)

**Step 2: Implement:**

```js
let netTriggersOn=false;
function initNetTriggers(){if(netTriggersOn)return;netTriggersOn=true;try{
  window.addEventListener('online',()=>{netBack();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&(OFFLINE||dirtyCount()))netBack();});
  setInterval(()=>{if(SYNC_READY&&!flushing&&navigator.onLine!==false&&dirtyCount())scheduleFlush();},30000);
}catch(e){}}
async function netBack(){if(!SYNC_READY||flushing)return;await loadAllMerge();render();scheduleFlush();}
```

The idempotence guard matters because `boot()` can run more than once (sign-out → sign-in without a page reload goes through `location.reload()`, but `doSignIn`/`doSignUp` both call `boot()` directly) — without it, each sign-in would stack another listener set and another uncleaned 30 s interval.

The order inside `netBack` is a load-bearing contract: **merge before flush** so units LWW resolves client-side and a phone that slept through a whole shift can't replay a stale row over the team's afternoon (Task 3.5's test proves the merge half; this test proves the sequencing).

**Step 3: Run** → PASS. **Step 4: Commit** — `git commit -m "Reconnect triggers (idempotent): online/visibility/interval; merge strictly before flush"`

### Task 3.7: Regression sweep, deploy, field verification

**Step 1: Full suite:** `python3 tools/fv_deploy.py preflight -m "offline write path"` — 96 existing + all `fv_inv_*` groups PASS.

**Step 2: Manual regression sweep** (per HANDOFF §9 step 5 — still its own step): every render entry point (`renderJobsList`, `renderJobDetail`, `renderFleet`, `renderAlerts`, `renderMapScreen`, `unitCard`, `pane*`) against empty / populated / edge state via the harness, **plus the new surfaces**: `openSyncStatus` with 0 dead letters, 3 poison, 2 superseded, and mixed; `updatePendingUI` in all four states (clean, pending, offline, stuck).

**Step 3:** Bump build marker to `offline-durable-diff`. `git add -A && git commit -m "Ship offline write path (durable diff)" && git push`. Verify marker live.

**Step 4: Field verification on a real phone against production** (writes here are real — use a `DEMO —` prefixed job and remove it after, per the sample-data convention):
1. Open app, let it sync, airplane mode ON.
2. Log a check, flag an issue, move a unit between two demo locations. Chip shows `⇅ offline 3+`.
3. **Force-close the app.** Reopen (shell from SW, data from cache) — queued changes still shown, chip still counting.
4. Airplane mode OFF, reopen/foreground → chip drains to hidden. Verify on a second device that all three writes arrived, the unit is where it was moved, and **nothing else moved** (rule 1).
5. Two-device conflict drill: device A offline, edit a demo unit's notes; device B online, edit the same unit's notes; device A back online → B's edit stands, A's edit appears under "Overwritten while offline" with Copy JSON working.
6. Remove the demo job; verify clean.

**Step 5:** Record results in the commit body of the final `HANDOFF` update (Task 3.8).

### Task 3.8: Documentation

**Files:**
- Modify: `HANDOFF.md` §3 (sync description: durable diff, merge-on-load, dead-letter + superseded lists, `received_at`, LWW rationale), §7 (drop resolved debt entries), §10 (item 1 → shipped)
- Modify: `tools/README.md` (new invariant files, what each group protects)

**Explicitly out of bounds here: §9.** Its rewrite is a separate, later commit after Andy reviews — requirements are recorded in project memory (`handoff-s9-rewrite-deferred`): git-push deploy text (drop the paramsFile step and the rate-limit gotcha), regression sweep stays a numbered step unless the 96 invariants provably cover it (cite which), and every command in the new text must be run and match reality before committing.

**Commit** — `git commit -m "HANDOFF: record offline write path (sections 3, 7, 10)"`

---

## Invariant coverage map (what protects each requirement)

| Requirement | Invariant group (file) |
|---|---|
| SW can't brick the fleet | `service worker: structure` (fv_inv_sw.js) + Task 2.4 device kill drill |
| Replay ordering explicit | `replay ordering: *` (fv_inv_offline.js) — DEPS precedence + call-order on the wire |
| No silent write loss | `ack: *` — failed write stays queued; mid-flight race; re-send on recovery |
| Poison visible, not dropped | `dead-letter: *` — quarantine, local data retained, UI shows server error, retry path |
| LWW loser visible, not dropped | `merge: units LWW` — superseded entry parked with full row; UI lists it with dismiss/copy (no retry) |
| Reload can't eat the queue | `merge: *` — dirty rows, pending deletes, LWW both directions |
| Stale replay can't move a unit | `merge: units LWW` + `reconnect: read-merge-then-write` |
| LWW's own precondition | `LWW precondition: *` — every units mutator bumps `updatedAt` (caught real bug: `rmUnitPhoto`) |
| Clock drift (events) | `clock drift: *` — `ro` keys, toRow exclusion, (device, server) tiebreak |
| Clock drift (LWW) | Documented-acceptance decision (see Settled decisions) + loser parking |
| Offline cold boot ≠ empty fleet | `durable cache: *` |
| Photos never re-fatten rows; upload pass bounded | `photos: *` (fv_inv_photos.js) |
| No stacked listeners/intervals | `reconnect: *` — double `initNetTriggers()` registers once |
