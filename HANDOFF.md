# FleetView — Developer Handoff

**Status:** live and in beta use by a real crew. Treat the data as production.
**Live URL:** https://apginvests.github.io/fleet-view/
**Repo:** `APGInvests/fleet-view` (name is case-sensitive), GitHub Pages from `main`, root.
**This document assumes no prior context.** Written 2026-07-29, last updated 2026-08-11.

---

## 1. What this is

A mobile-first web app for a temporary-power company that rents and deploys **generators** to large festivals and events. Crews track, per show, where every unit is and how it's running.

The problem it solves: a generator's status normally travels only by text, photo, or word of mouth. FleetView turns that into shared, timestamped, location-aware data that any crew member, the crew chief, or the owner (from an office) can see live — and that carries across shifts without a verbal handoff.

Primary users: field technicians, a crew chief, and the owner. Multi-user, one shared dataset per company.

---

## 2. Architecture

**One self-contained file.** `index.html` (~215 KB) contains all markup, CSS and JavaScript. Vanilla JS. **No build step, no bundler, no package.json.** Editing the app means editing that one file. This is deliberate: the whole app is one deployable artifact you can diff, verify and roll back in a single operation.

**Scope of the no-dependency rule (settled 2026-08-02):** it protects `index.html` and the no-build-step deploy — *not* the archive tooling. `tools/` carries its own devDependencies (`pdfkit` + `sharp`, for the archive site map; `cd tools && npm install`, `node_modules` gitignored). A missing install never affects a deploy: preflight and the invariant suite stay zero-dependency, and `fv_archive.js` records a loud shortfall instead of silently skipping the map.

**Libraries, all from CDN** (no local deps). **Since 2026-08-11 (`deps-pin-sri`) every package-CDN tag carries an exact version pin + SRI `integrity` hash + `crossorigin="anonymous"`** — supabase-js was a floating `@2`, which combined with the SW's cache-first CDN policy meant different phones could run different library versions depending on when each first cached it. The pin (2.112.3) froze the exact bytes `@2` was serving. Upgrading a library now means: change the version in the URL, recompute the sha384 (`curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`), bump the SW VERSION. Google Fonts CSS is the one deliberate SRI exemption (per-UA response, unhashable). Enforced by `tools/fv_inv_head.js`.

| Library | Version | Used for |
|---|---|---|
| Leaflet | 1.9.4 | maps |
| Leaflet.markercluster | 1.5.3 | pin clustering / spiderfy |
| html5-qrcode | 2.3.8 | barcode + QR scanning |
| qrcodejs | 1.0.0 | generating a QR for the app link |
| @supabase/supabase-js | 2.112.3 (pinned) | backend client |

(Chart.js 4.4.1 was loaded-but-unused; removed 2026-08-11, build `chartjs-rm` — see §7.)

**State model.** A single in-memory object `S`:

```
S = { settings, shops[], shows[], units[], reports[], issues[], movements[], currentShowId }
```

Render functions read `S` and rebuild DOM via template strings. There is no framework and no virtual DOM — `render()` rewrites the view container.

**Build marker.** An HTML comment near `<title>`:
`<!-- fleetview build 2026-08-11 check-history -->`
Bump it on every deploy. See §9.

---

## 3. Sync layer (read this before touching data code)

Backend is **Supabase** (hosted Postgres + Auth + Realtime).

```
const SUPA_URL = 'https://eujgglfcpdfgskyqfggg.supabase.co'
createClient(SUPA_URL, SUPA_KEY, { auth: {
  persistSession: true, autoRefreshToken: true, detectSessionInUrl: false
}})
```

`SUPA_KEY` is the **anon/publishable** key and is intentionally embedded in the client. That is safe — row-level security is what protects the data. Do not put the Supabase *personal access token* (used for migrations) anywhere in this repo.

**Synced tables:**
```
const TABLES = ['shops','shows','units','reports','issues','movements']
```
A `profiles` table also exists in the database (populated by a new-user trigger) but is **not currently loaded or used by the client**.

**How sync works — diff-based, not per-field:**

1. Code mutates `S` directly (e.g. `S.reports.push(...)`).
2. `save()` writes UI settings to `localStorage` and calls `scheduleFlush()`.
3. `scheduleFlush()` debounces **450 ms** → `flush()`.
4. `flush()` diffs each `S` array against a snapshot (`SNAP`), upserts rows that changed, deletes rows that disappeared, then re-baselines **only the tables whose writes acked** — a failed table keeps its old SNAP (stays dirty), retries every 30s, and lights the ⚠ sync chip with an unsaved count (§8 rule 12).
4a. `flush()` is **ack-correct** (2026-08-01): the diff is captured synchronously at entry and acks write per-row from the captured serialization (mid-flight edits can never be absorbed as synced). Upserts run in `TABLES` order and halt on a retryable failure — children never outrun a failed parent; deletes run in reverse. Non-retryable rejections **quarantine per-row into `DEAD`** — chip shows "N stuck"; the status sheet has per-entry **Retry** (the rejection may be transient config — an RLS change, a column that arrives later, exactly the incident class) and Copy JSON; quarantined deletes store their SNAP entry so Retry restores the owed delete.
4b. `loadAll()` **merges** server state over pending local dirt — it never replaces it. Dirty rows survive reloads and stay queued; pending deletes stay deleted and still emit; `units` conflicts resolve by `updatedAt` LWW with **losers parked in `SYNC_LOST`** (chip shows "N overwritten"; status sheet offers Copy JSON / Dismiss). A failed SELECT keeps both local rows and old SNAP — a failed read must not launder dirt clean, same rule 12.
5. A Realtime `postgres_changes` subscription calls `scheduleReload()`, debounced **800 ms** → `loadAll()` + `render()`, so other devices update without a refresh. It defers if a flush is in flight.
6. `loadAll()` does `select('*')` on every table in `TABLES`.

**Field naming.** The app uses camelCase; the database uses snake_case. `MAPS` holds a per-table mapping plus which keys are datetimes:

```
MAPS = { units: { m: { appKey: 'db_col', ... }, dt: ['createdAt','updatedAt'] }, ... }
```
`toRow()` / `fromRow()` convert both directions, including **JS milliseconds ↔ ISO timestamps** for keys listed in `dt`.

> **If you add a field to a synced object you must add it to `MAPS`, or it will silently never persist.** This is the single easiest way to break this app.

> **Since 2026-08-03 this rule is also enforced mechanically:** preflight runs `tools/fv_schema_gate.js`, which checks every `MAPS` field (including `ro` columns) against the real schema — live PostgREST probe with the public anon key when the network allows, committed `tools/schema.snapshot.json` with a loud offline banner when it doesn't — and refuses to clear the build on any mapped-but-missing column. The migration ritual below remains the procedure; the gate is the backstop that no longer relies on memory.

> **When a build needs more than one schema change, list them together and verify them together — one SQL batch, ending with a single `information_schema.columns` select that names every expected column.** Two separate gates across two conversations is how `movements.photos` got dropped while `movements.kind` got verified (2026-08-01). Cost: once the client mapped `photos`, **every movement upsert failed silently for ~14 hours** — the legacy flush console-warns and re-snapshots, so the rows were marked synced and permanently lost (last good movement 01:47, column created ~16:17). Unit location columns persisted (units upserts succeeded), so the damage is movement-history gaps and stale map pins for moves in that window — fix-forward is re-capturing placement on affected units, not reconstruction. Same audit also found `received_at` mapped as read-only on reports/issues/movements but existing only on `status_events` — harmless today (ro columns are never written; reads yield null and the tiebreak degrades to device time) but the same class of drift.

**IDs.** `uid()` returns `crypto.randomUUID()`. All primary keys are UUIDs.

**Durable cache (2026-08-01):** IndexedDB db `fleetview` (KV store) persists the S data tables + `SNAP` + `DEAD` + `SYNC_LOST` after every flush/merge — queued work and quarantine survive an app kill, and boot renders last-known data before the network round-trip (`loadAll` then merges over it). Cleared on sign-out. **Reconnect triggers:** `online` + `visibilitychange` + a 30s interval while dirty; `netBack()` merges (read) strictly before flushing (write) so LWW resolves client-side. **Persistent storage (shipped 2026-08-11, `storage-persist`):** `requestPersist()` fires once per boot (off the render path) and asks the browser to exempt this origin from storage-pressure eviction — the same eviction risk §8 rule 13 keeps tiles out of the SW cache for, now closed on the IndexedDB side too. Denial is normal in an uninstalled tab, so it surfaces only as an "Offline copy: best-effort" row in the sync-status sheet, never on the chip; grant is silent. Invariants in the `fv_inv_offline.js` storage-persist group (suite 968). Any sandbox copy must rename the IndexedDB database, same origin-sharing reason as the SW cache prefix.

**Offline cold-start (shipped 2026-08-05, `offline-boot` + `fv-sw-4`) — the dead-zone incident fix.** Crew report 2026-08-04: in a dead zone the chrome painted but the jobs list never did, and nothing could be logged. Root causes and their fixes, all guarded by the `fv_inv_offline.js` "dead-zone contracts" group: **(1)** boot gated everything behind `getSession` + seven un-timed sequential selects — boot now renders from the durable cache (or an honest empty state) BEFORE any network, `getSession` races a 5 s timeout and falls back to the stored localStorage session on a previously-signed-in device, and every `loadAll` select carries an 8 s abort. **(2)** Writes queued offline flush with an expired JWT — `RETRYABLE` now treats jwt/401/abort as retryable (a real RLS denial or schema drift still quarantines), and `netBack()` refreshes the session before flushing. **(3)** The offline state is visible: the sync chip shows `offline · saved copy <age>`, a broken durable-cache write/read shows `no offline backup on this phone` (audit A2 — no more silent `catch`), and the empty jobs list offline says "no signal, work is kept" instead of inviting a duplicate fleet. **(4)** `sw.js` (`fv-sw-4`): a reachable-but-broken origin (mid-deploy 404, captive portal, congested-network error page) now falls back to the cached shell instead of showing the error. Standing limit: a phone must open the app online once for the shell + cache to exist at all. The airplane-mode field drill (§10 3.7) remains the real-device proof.

**Status-first check form (shipped 2026-08-10, `status-first-form`) — the fake-zero fix.** The three-show archive analysis found off units logged as `hz=0, volts=0` plus a note ("Off for today") because the Status segment sat at the BOTTOM of the form — the tech reached it after dutifully typing zeros. The segment (unchanged control, still prefilled from current status) now renders at the top, directly under the identity card, and when it reads `staged`/`down` the electrical vitals (volts, amps, Hz, kW, coolant, oil psi, fuel psi + their calc/flag lines) collapse behind "Not running — electrical vitals n/a". Fields observable on an off unit stay: hours, fuel %, batt V, DEF %, notes. Collapse is **display-only** (`vsegElec()`): it never clears a typed value and save semantics are untouched — blank stays "not observed", and the check's status context says why. Zero schema. Guarded by the `fv_inv_checkform.js` "status segment leads" group (suite 822). Step 1 of the check-form chips plan (`docs/plans/2026-08-10-check-form-chips-design.md`); steps 2–3 (condition_ok, broken_gauges — two new columns) gated on the migration.

**Check-form chips (shipped 2026-08-10, `check-chips`) — steps 2–3 of the chips plan.** Two new nullable `reports` columns (migrated + verified by Andy 2026-08-10, snapshot refreshed): **`condition_ok`** — the "✓ All good" chip above notes, the one-tap version of the typed "Running clean" ack (81 of 189 archive notes); `true` when tapped, NULL when not — untapped is "not asserted", never "not OK", and the chip resets per form open. **`broken_gauges`** — the "⚠ Gauge broken…" chip opens an INLINE panel (never a second sheet — `sheet()` would replace the form and eat typed values) listing the vitals; flagged gauges save as an array of field keys (`voltage`/`amps` cover their leg groups) and their labels strike through so the blank reads as deliberate. Contracts, all in the `fv_inv_checkform.js` gauge groups (suite 856): flagging **never auto-creates an issue row** — "Also file as issue" inside the panel is the tech's own tap (severity `maintenance`, moves nothing, no status event); the amber unit-card badge (`oil psi gauge u/s` / `N gauges u/s`, `brokenGaugesFor()`) is **derived and clears by construction** when a later check records a real value on that gauge — no resolve flow, nothing mutates. `fv_archive.js` exports both columns in checks.csv + dictionary. Remaining from the plan's parked list: promote-note-to-issue, derived small-iron load, hiding fuel_psi/DEF where inapplicable, void window.

**DEF opt-in per unit (shipped 2026-08-10, `def-optin`).** Most skids have no DEF tank (archive fill: def_pct 2.5–32%, mostly structural). New nullable `units.has_def` (migrated + verified by Andy 2026-08-10; **null = off**, so all existing small iron starts off by construction). The toggle lives on the **unit edit form** ("Has DEF tank", small iron only) — a machine property like kVA, deliberately NOT on the check form; `editHasDef` re-inits from the unit on every open so re-saving an untouched form never clears it, and off saves null, never false. On small iron the check form renders DEF % only when flagged — **hidden, not grayed** (fuel/batt row drops grid3→grid2), the gauge picker stops offering DEF, and `saveVitals` stores `defPct: null` regardless of stale DOM state. Big iron unchanged until Andy's which-big-iron-has-DEF list arrives (then same gate); longer term this is a model-to-spec property — `has_def` is the backfill source. fuel_psi deliberately did NOT get a column: it's already class-gated (big-iron-only) with the same hidden-not-grayed semantics. `fv_archive.js` roster.csv exports `has_def`. Invariants in `fv_inv_checkform.js` (suite 874).

**Derived load for small iron (shipped 2026-08-10, `load-est-void`).** Small iron has no kW meter — 52 archive checks carried amps+volts and no load_kw. `derivedLoadPct(r)` (mirrored in `fv_archive.js`) computes **apparent-power %**: `sqrt(3)·V_LL·(ΣA)/3 / (kVA·1000)` — **no PF assumption** (it cancels against the rating's 0.8; a metered % equals this × PF/0.8, ≤~20% low worst case, direction known). Derived at READ time, never stored — every input is already stamped on the row, and a formula fix recomputes all history. Guards: metered always wins; **all three legs required** (one leg ≈ single-phase, where √3 is wrong). Shown "~N% est" in recent-checks table, latest card, check log; NEVER on the form (observation rule). checks.csv gets `load_pct_derived`, never silently merged with `load_pct`.

**Void window + empty-check confirm (shipped 2026-08-10, `load-est-void`).** Techs resubmitted instead of correcting ("Running Great last check had typos"). A check is voidable by **its own tech, within 10 min, while still the newest record in its lane** (per-engine on twins; a newer issue closes it too) — timer bounds regret, still-latest bounds entanglement, so the record heals by construction: `reportsFor()` is the single choke point excluding voided rows from every derived reader (freshness, alerts, hours guard, trends, gauge badge), and the next check compares against the prior live reading. Void = `voided_at`/`voided_by` on the SAME reports row (append-only; offline it can never race the check it voids). Affordance in paneVitals, confirm-gated. Known edge: voiding a unit's only-ever check leaves `u.currentHours` on its old value (roster seed vs voided reading indistinguishable) — accepted. Intended flow is **void-then-redo**; once anything newer lands the old check is frozen. Also: an ALL-blank save now arms a two-tap confirm ("counts as a visit") — blank checks stay possible (a tech standing there is a real record), never accidental; the `fv_inv_bigiron.js` blank-check invariant was amended accordingly (Andy-approved 2026-08-10). Archive: checks.csv carries `voided_at`/`voided_by`; cadence counts and roster first/last-seen exclude voided rows. Suite 903.

**Note-to-issue promotion (shipped 2026-08-10, `note-promote`) — closes the archive-analysis list.** The archives held 10 defect notes vs 6 issue rows: the issue flow was losing to the notes box 2:1. The "⚑ Also flag as issue" chip renders under the notes field **only once note text exists** (`noteIssueVis()` on input + form open) — a normal check never sees the decision, happy-path taps flat. One tap promotes at save: note text → issue text, first line (≤60 chars) → title, tech/engine/unit-stamped show carry over, `issues.from_report_id` (migrated + verified by Andy 2026-08-10) records lineage. The check keeps its note untouched — records are never edited; the issue card shows "⚑ from a check" and the check log marks "⚑ filed as issue" (both derived). Severity defaults `maintenance` with an optional Cosmetic tap; **hard-down is deliberately absent** — status has ONE writer, the Status segment on the same form (Andy-endorsed). Never automatic: chip untapped → no row; note deleted after tapping → no row; state resets per form open — all pinned in `fv_inv_checkform.js` (suite 927). Offline ordering is free: same `save()` cycle, and flush's TABLES order (reports before issues) means a promoted issue can never land before its check. issues.csv exports `from_report_id` — next season's archive can measure whether promotion beat the notes box.

**Unit history (shipped 2026-08-11, `check-history`) — general backward-looking access.** The Vitals tab showed only the latest check plus a flat 25-row log; answering "what has this unit been doing" required out-of-app analysis by the owner. Now: **(1)** a "Last 30 days" summary card, always visible (deliberately NOT under the collapse — it IS the answer): run time via a corruption-resistant **last-accepted walk** over `engine_hours` (accept a pair iff `0 ≤ Δ ≤ elapsed×1.1+2h`, reject without advancing the anchor — a 9,999 typo or meter swap can never poison or negate runtime; a mid-window meter replacement undercounts, failing safe), duty % (run over span of *accepted* readings, null under 24 h span), load median · peak (metered + derived pooled, `~est`-marked when derived contributes), max coolant, and issues (opened in window · still open). General framing per owner: NOT scenario-specific — the under-20% wet-stack count was deliberately replaced by median·peak. **(2)** "▸ History" collapsed by default (`histOpen`/`histAll` reset in `openUnit`, persists across engine-chip flips): day-grouped rows (`.evday` headers naming the show **when it changes** — reads like the unit's season), 30-day window, "Show all" with the 200-row `openGlobalLog` cap. The old flat Check log is replaced; its row template extracted verbatim to `checkLogRow()`. **Everything reads through the `reportsFor()` choke point — a voided check can never reach the runtime walk or load pool (asserted in `tools/fv_inv_checkhistory.js`, suite 963).** Zero schema, zero deps, read-only surface. Chart.js/`drawTrend` untouched — the §7 multi-axis rejection stands; a single-metric sparkline is a separate open question.

**localStorage keys** (device-local, never synced): `fleetview_settings_v1` (UI settings), `fleetview_favs` (per-person starred jobs).

**RLS posture.** Policies are `for all to authenticated using(true) with check(true)` — *any* authenticated user shares one fleet. There is no per-user or per-role restriction. Auth is email + password with auto-confirm enabled (no confirmation email step).

---

## 4. The two-layer data model (most important design decision)

Every unit has **two kinds of information**, and conflating them is the bug this model exists to prevent.

### Layer 1 — Fleet identity (travels with the asset forever)

Lives as top-level columns on `units`. Follows the machine from show to show for its whole life.

| Field | Notes |
|---|---|
| `serial` | **The primary identity.** What people say out loud. Stored UPPERCASE. |
| `tagId` | Optional *scan code* — only used when a barcode sticker's number differs from the serial. Not a second identity. |
| `klass` | `'big'` \| `'small'` (equipment class) |
| `make`, `model` | |
| `kw` | Rating in **kVA** (field name is legacy) |
| `breakerSize`, `fuelType`, `tankGallons`, `weightLbs` | |
| `currentHours`, `serviceDueHours` | service tracking. **On a TwinPak these are demoted** — see below. |
| `engines` | **jsonb. Present ⇔ true TwinPak.** Two engines in one housing = one NES line item = one record, one serial. |
| `opStatus` | `'staged'` \| `'running'` \| `'down'`. **New units default to `staged`.** |
| `photos` | array of base64 data URIs (see §7) |
| `notes` | |
| `locationType` | `'show'` \| `'shop'` \| `'transit'` \| `'fleet'` |
| `locationId` | show id / shop id / null |
| `inTransitToShowId` | destination while `locationType==='transit'` |

`locationType: 'fleet'` means **unassigned** — in the registry but not on any job. Displayed as "Unassigned".

### Layer 2 — Per-job label (`jobMeta`, must NOT travel)

`units.job_meta` is a **jsonb map keyed by show id**:

```json
{ "<showId>": { "name": "Coca-Cola stage", "area": "VIP South", "note": "..." } }
```

- `name` — free text, what it powers on *this* job
- `area` — the placement on *this* job
- `note` — job-specific note

**These must never follow the asset to its next show.** A unit called "Coca-Cola stage" at one festival is something else entirely at the next one. Helpers: `jm(u, showId)`, `placeOf(u, showId)`, `assetLabel(u, showId)`.

### Append-only history

`reports` (vital-sign checks), `issues`, and `movements` are **append-only** — new rows, never edits. Each is stamped with `techName` and a timestamp. This is what makes shift handoff work and what will make offline sync tractable.

### Layer 1b — two engines in one record (true TwinPak)

The company's **National Equipment Schedule** decides what counts as one piece of equipment, and this app matches it. Two machines permanently paired in one housing are ONE line item: one record, one shared serial, two engines. Generators that can be unbolted and swapped off a shared chassis each keep their own record — that already worked and was not touched.

`units.engines` shape:

```json
{ "style": "AB",
  "A": { "kvaEach": 625, "serviceDueHours": 3493, "lastServiceHours": 3243, "opStatus": "running" },
  "B": { "kvaEach": 625 } }
```

- **`engines` present AND not flagged `off` is the only authority.** `config` is free-text metadata and is *not* evidence (see §7).
- **Turning the toggle off preserves the jsonb** — it sets `engines.off = true` rather than clearing it, so switching back on restores both nameplates and both service targets. An accidental toggle costs nothing. The jsonb is only ever nulled when it was malformed to begin with.
- `style` is `"AB"` or `"12"`, whichever the housing is physically labelled. **Stored tags on `reports.engine` / `issues.engine` are always canonical `'A'`/`'B'`**, so relabelling the housing never breaks history.
- **Hours are derived, never stored.** `engHours(u,'A')` takes the newest `engineHours` from checks tagged `'A'` *or* untagged — untagged history is pre-split and inherits to A, labelled "pre-split" in the UI. `engHours(u,'B')` takes tagged-`'B'` checks **only, with no fallback**, so a fresh Engine B reads "No checks yet" instead of inheriting the old merged meter. A merged "246h to service" is unanswerable — on which engine? — and removing it is the point of this model.
- **Corrections are new checks**, never field edits. There is deliberately no editable hours field on a TwinPak.
- **Status is per-engine too**, stored in `engines[e].opStatus`, with the chassis derived. It aggregates on the **failure axis only**: any engine down ⇒ the trailer is red, any engine running ⇒ the trailer is running (one engine on standby is normal, not idle), staged only when nothing runs. **An unobserved engine never downgrades the chassis** — without that clause every conversion would flip a working machine grey the moment it was converted. When the engines disagree the label names the engine (`GEN B DOWN`), because a red chip must not read as "the whole trailer is dead".
- **Service and staleness follow the worst engine.** `serviceState()` returns the worst engine's state, so status colours, the alert section, card chips and the service filter chip all inherited the rule through their existing call sites. A down engine is exempt from stale; a running engine still owes a check.
- **Targets and nameplates ARE stored**, because neither is an observation: `serviceDueHours`, `lastServiceHours` and `kvaEach` live per engine.
- **`kvaEach` is read off each engine's nameplate and is the one required field in the app** — a deliberate, owner-approved exception to "every field optional", because conversion is a low-frequency setup flow done while standing at the machine. Per-engine load % divides by `kvaEach`, never by `kw/2`: paralleling gear and a shared bus derate the package, so half the package rating appears on no nameplate. A number nobody observed is the same failure as the merged hours.
- Flat `currentHours` on a TwinPak is **only Engine A's pre-split seed**; flat `serviceDueHours` is ignored once `engines` exists. Single-engine units are untouched — zero churn on the ~34 records that already worked.
- **Movements and map pins stay chassis-level.** You move a trailer, not an engine. There is no engine dimension on movements.

**Toggling a split off is gated only when it would strand something.** With nothing tagged to an engine it applies silently. Once any check or issue carries an `engine` tag, saving with the toggle off does *not* apply — it opens a typed **TWINPAK** gate (same pattern as delete-from-fleet) naming exactly what would be stranded ("3 checks tagged Gen B"). The reason it earns a gate despite deleting nothing: while the split is off, engine-tagged hours stop feeding any countdown and the unit falls back to flat `currentHours`, which twin-era checks never updated — **so the service clock can read low until the split is turned back on**. Chassis `opStatus` reverts the same way; an engine-tagged *down issue* still forces red, which is the safety net.

Invariants live in `tools/fv_inv_bigiron.js` and run on every preflight.

### Location has exactly one authoritative writer

`unitGps(u)` derives a unit's map pin **only from `movements`**. Reports and issues store `gps: null` by design.

> This was a real production bug: the pin used to take the newest GPS from *any* attached record, so filing a status report from another state teleported the generator onto the reporter. See §8, rule 1.

**Movements are a placement-EVENT log, not a transfer log** — `capturePlacement`, `mapSetLoc` and `savePin` all write rows where nothing moved. Events are **typed** via `movements.kind`: null = moves/placements/pin-sets; `'photo'` = a placement photo (how the unit sat on *this* job — gps null, born with its photo, job-scoped via `toId`, its own attributed act separate from the instant GPS capture). **A `kind:'photo'` row must never satisfy anything that means "the unit was observed here"** — not `unitGps`, not `recentDests`, not freshness/staleness. Same family as rule 1, and the exclusion is by **explicit `kind` guard, not the gps-null field shape** (coincidence standing in for a rule is the `config==='TwinPak'` trap, §7). Adversarial invariants in `tools/fv_inv_placementphotos.js` hand a photo event a GPS and a destination and require both ignored.

---

## 5. Information architecture as shipped

**Bottom nav:** Jobs · Fleet · Map · Alerts, plus a floating **+ Add** button.

On a **TwinPak** the single "Log check / Flag issue" pair on unit detail becomes **one row per engine** — each showing that engine's status dot, status word, hours and freshness, with its own Check and Flag buttons. Same tap count as a single unit, and the half-down split is visible without opening anything. The **True TwinPak toggle** lives in the big-iron section of the add/edit form: label style, both nameplate kVAs, and per-engine intake meter readings (which are logged as engine-tagged intake *checks*, not column writes). Turning it back off keeps everything (§4) and is typed-gated only when engine-tagged observations exist.

**Gesture contract — identical on every list:**
| Gesture | Meaning |
|---|---|
| tap | open the thing |
| swipe **right** | show it on the map |
| swipe **left** | remove it *from this context* |

### Jobs
List with search (name/location), per-person favorites (star pins to top), and health chips (unit count, down, overdue, last activity). Swipe left = **Delete job** — *refused while the job still has units on it*. Swipe right = that job's map.

**Job metadata (shipped 2026-08-02, `show-days`).** The New/Edit job sheet carries, all optional: start date (defined as *first planned CES on-site day* going forward — the two 2026 archived shows keep their contract-date values, see the archive notes), **show days** (a hand-rolled month-grid multi-select calendar — the actual days the show runs, dark days simply unselected; a two-weekend run is eight dates), project manager, CES job #, and time zone (4-zone picker; blank = derived from the venue pin's longitude via `tzGuess`, null when there's no pin — never a fabricated default). Schema: `shows.show_days` (jsonb, sorted deduped ISO-date array, **null when empty, never `[]`**), `pm_name`, `ces_job_number`, `tz` (text), `archived_at` (timestamptz, reserved for the archive button) — one migration, run and verified in `information_schema` 2026-08-02 *before* the client mapped the columns (§8 rule 11a / the movements.photos lesson). Phases are **arithmetic, not a feature**: before the first show day = load-in, in the list = show, gaps inside the list = dark, after the last = load-out; no button, no completion state, nothing required in any tech flow. `fv_inv_showmeta.js` guards the round-trip, sort/dedup, and null-not-empty-string contracts.

### Job detail
Header buttons: Map · Log · Report. Search + filter chips (All / Big iron / Small iron / Down / Low fuel / Service). Unit cards sorted by **kVA ascending, with hard-down units forced to the bottom**, tiebreaking on the **job label when set, else serial** (same-kVA units are indistinguishable by serial alone) (crews doing rounds need runnable units on top; a known-broken unit is noise). Card swipe left = **Off job**; swipe right = its map pin.

### Unit detail — five tabs
- **Vitals** — Latest check card (hero) → **Recent checks** comparison table → **Check log**. On a TwinPak, engine filter chips (Both / Gen A / Gen B) scope all three; untagged rows are chipped **pre-split**. The comparison table is rows = V L-L, Amps L1/L2/L3, Coolant °, Oil psi, Load %; columns = last 4 checks, newest first; neutral **▲/▼** vs the previous check. Neutral on purpose: for these measures "up" is not universally good or bad.
- **Issues** — severity `cosmetic` / `maintenance` / `down`, with photos, resolvable. Engine-tagged issues carry an engine chip.
- **Service** — hours remaining vs `serviceDueHours`, mark-serviced. On a TwinPak, **one countdown card per engine** with its own target and mark-serviced action.
- **Info** — specs, Serial then Scan code, photos, Edit.
- **Placement** — per-job name/placement/note, capture placement (GPS), adjust pin on map, move / mark en route.

### Log check form
Volt L-L / L-N, Amps L1/L2/L3, Hz, Load kW, Coolant temp, Oil psi, **Fuel psi (big iron only — the clogging-filter diagnostic per the CAT XQ-500 plate)**, Fuel %, Batt V, DEF %, Engine hrs, Condition notes, Status. Every check also stamps **`ratingKva`** — the kVA `engKva` returned at save (kvaEach for a TwinPak engine, `kw` for singles, null when unset) — so stored load % is self-describing and a future prime/standby convention change is a visible discontinuity, not silent incomparability.
- **A pinned identity header** tops the form on every unit: serial, engine label on a TwinPak, chassis config, and the **last recorded hours** (or "No checks yet") with who read it and when. Identity used to appear on the selection screen and vanish — on a TwinPak that made it a coin flip which engine's hours you were recording.
- **Engine hrs is blank on every unit.** It used to render the stored reading, which meant anyone skipping the field silently re-saved the old value: the service clock froze while the engine ran, which is how a unit reaches hundreds of hours past service with nobody noticing. The header supplies the previous reading as *reference* instead — reference visible, value observed. The two ship together; blanking without the reference just loses information.
- **Range flags (per-model plate data).** Typed Oil/Fuel psi get an inline comment when outside the model's data-plate range — `SPEC_RANGES` in `index.html`, keyed on normalized make+model (`CAT XQ-500` only so far; a model with no entry gets **no comment**, which can never flag the wrong machine with the wrong range). **Oil's floor is 40; 15 is the idle exception, not the rule.** Below 40 while Running always flags — load evidence only changes the wording (hard with the load named at ≥30%, softened may-be-idling below, idle floor cited when load is unknown). Inverted 2026-08-01 after a field check: the original design stayed silent in the 15–40 band without load data, which made the app quietest exactly when it was told the least — backwards for a safety flag. A false flag at idle costs two seconds; a missed flag under load costs an engine. Nothing renders unless the status selector reads Running — 0 psi on a stopped engine is a true reading. Comments never prefill, propose, block or recolor an input (rule 2). **Adding a model = reading its plate, adding one `SPEC_RANGES` entry, and bulk-setting that family's `model` column — the two must land together** or the feature silently covers less than assumed.
- **Load % is derived, not entered:** `round(loadKw / (kVA × 0.8) × 100)`, shown live under Load kW with the formula visible. 0.8 is assumed power factor, so the divisor is *rated kW*.
- The status selector **pre-selects the unit's current status** — it does not default to "Running" (see §8, rule 3).
- Every field is optional.

### Fleet
The global registry — every asset the company owns, wherever it is. Search + filters, plus **make chips derived from the data with counts** ('CAT · 82') — one tap narrows 153 units to a manufacturer; '' and null makes share one 'No make' chip (coalesce, never null-check). Sorted like the job list. **Card anatomy (2026-08-01):** headline is make **always** + model when known ('CAT XQ-500 · #X5M00212' — never model-or-make, which made identical manufacturers read differently), **kVA right-aligned under the status pill** so sizes line up in a scannable column even on unassigned units, and the **TWINPAK chip + per-engine meter-reading gap chips render here too** (this is the binding-pass progress surface, per §10 1b — it previously rendered only on job-detail cards). Deliberately NOT collapsible sections: drawers add a tap, hide units nobody knew to look for, and would trap down units inside groups instead of letting them sink to the visible bottom. Swipe left = **Delete from fleet** (confirm-gated). This is the *only* place delete lives.

### Map
"This job / All locations" toggle, plus a **Street / Satellite basemap toggle** (built-in `L.control.layers`, top-right) on every map surface — the map tab/job sheet, the placement pin editor, and the venue picker, all built by the shared `makeMap()` constructor. Satellite is **USGS Imagery Only** (public domain, keyless — settled; do not substitute a keyed provider). Empirical cache ceiling is **z16** (probed 2026-08-01 over Grant Park and the Hinterland site — hard 404 above); `maxNativeZoom:16` upscales the last real tile instead of blanking, and street keeps z19. Attribution is per-layer and switches with the active layer (this also finally surfaced the OSM credit). Preference is per-device in `S.settings.basemap` — same localStorage pattern as theme, applied to every instance, Street on missing/corrupt. All map furniture is styled for **both** backgrounds (dual dark/light halos on every pin including the draggable placement pin, opaque charcoal cluster bubbles with white counts, white spiderfy legs with dark SVG halos) — one style that reads everywhere, no satellite-only stylesheet. Clustered status-coloured pins + a venue marker. Marker popup is deliberately minimal: **area** (bold), model · #serial, status dot + label, then three actions — **Open**, **Move** (drag the pin), **📍 Set to my location**.

**NAIP Plus high-zoom overlay (shipped 2026-08-01, `naip-overlay`).** At **z17+**, a second imagery layer — USGS NAIP Plus, rendered live via `exportImage` on `imagery.nationalmap.gov` — draws **on top of** the z16 satellite base. **Overlay, not handoff**: NAIP is a dynamic render on shared government compute (no CDN, no SLA), so when it is slow or down the map degrades to the upscaled z16 imagery we already ship — blurry at placement zoom, never blank. Vanilla Leaflet: `naipTileUrl()` does the tile→mercator-bbox math and overrides `getTileUrl` on a stock `L.tileLayer` (no esri-leaflet, no WMS plugin, no key, no build step). The basemap toggle **stays two entries** — NAIP is an implementation detail of Satellite, added/removed with it on `baselayerchange`. A per-tile **8 s timeout** (`naipTileTimeout`) swaps a hung render for a transparent pixel, so the base shows through and the request is aborted; tile errors stay transparent for the same reason. Rule 13 applies unchanged: `imagery.nationalmap.gov` is excluded in `sw.js` (VERSION bumped to `fv-sw-3`) — exportImage responses are large and uncacheable-by-design (every pan is a fresh bbox) — and `tools/fv_inv_sw.js` guards the exclusion. Measured 2026-08-01, cold full-viewport paint on a good connection (desk 1280×600, the pin-correction use case): **z17 1.1 s / z18 0.8 s over Grant Park; z17 0.9 s / z18 0.6 s over Hinterland**; repeat views ~50 ms (server-side render cache). No prefetch, no spinner, no tile cache — deliberate. **This was the last change to the map.**

### Alerts
Sections: Hard down · Service due/over · Low fuel · Overdue for a check. The nav badge counts **distinct units**, so it is lower than the sum of section counts (a unit can appear in several sections).

### Add flow (`+ Add`)
Scan a barcode/QR **or** type a serial → **searches the whole fleet first**:
- already in the fleet → offer to move it onto this job (no duplicate)
- already on this job → just open it
- no exact match → **Damerau distance-1 candidates** ("Did you mean…", max 4, alphanumerics-only compare) on both the typed and scan paths — offered, never enforced; then **+ Add new asset**, serial prefilled, never blocked

**In-app add always creates small iron.** Big iron exists on the NES roster and arrives by import; `klass` is locked on edit in both directions. The type control on the form is a static label, not a toggle.

The destination chooser leads with the **last 3 destinations** as one-tap buttons, then all jobs/shops, then **+ New job** / **+ New shop** (create a destination without leaving the flow), then **↩ Back to fleet (unassign)**. After a scan-assign it **loops straight back to the scanner** so a crew can load a truck in a scan-tap rhythm — including interleaving two trucks bound for two different shows.

Scanner reads **1D barcodes and QR** (Code-128/39/93, ITF, Codabar, EAN/UPC, QR, DataMatrix), uses the native detector where available, has a wide scan window sized for linear codes, a torch toggle, and a manual type-in fallback.

### App icon (shipped 2026-08-11, `pwa-icons`)
Black `#141414`, yellow bolt `#F2C230`, no lettering (owner spec — must read at 44 px). The app previously had NO icons: iOS home-screen installs got a screenshot tile. Set lives in `icons/` — 192/512 `any`, 192/512 `maskable` (bolt at 62% so Android's circle crop never clips a point), 180 apple-touch-icon, SVG+32px favicons — declared in `manifest.json` (`icons` + `id`) and the head links. Regenerate with `cd tools && node fv_icons.js` (sharp, same devDep as the site map). Existing installs pick the icon up on re-install only — that's how launchers work, not a bug. Guarded by the pwa-icons group in `tools/fv_inv_head.js`.

### Mobile shell (shipped 2026-08-11, `viewport-polish`)
Pull-to-refresh is disabled (`overscroll-behavior-y:none` on html+body, `overscroll-behavior:contain` on `.sheet`) — an accidental reload mid-check-form eats every typed vital, and the check form lives in a sheet whose top edge would otherwise chain the gesture to the page. Guarded in `tools/fv_inv_head.js`. Sheet/map heights carry `dvh` overrides after their `vh` fallbacks so the iOS URL-bar collapse doesn't shift them mid-use (no effect in installed-PWA mode, where there is no URL bar). The theme-color meta already tracked the in-app theme toggle via `applyTheme()` — noted here because an audit flagged it as missing; it isn't.

### Status colours
green = running · yellow = cosmetic issue · orange = service due/over or low fuel · red = hard down · grey = staged · blue = in transit. Every card also shows **freshness** (time since last check) — stale data is its own status.

### Auth
Login-first screen (email + password). A toggle reveals First/Last name for account creation. Display name is "First L." — logs are stamped by name, never email.

### Settings
Theme (dark/daylight), home tab, stale-check hours, service-due warn hours, service email, load/remove sample data, **Reset ALL data**, export backup, sign out.

---

## 6. Deliberately cut — do not "restore" these

The owner repeatedly declined features to keep the app usable. Every item below was considered and cut **on purpose**:

- Truck **loadout** screen
- **Service planner** module
- **Global** activity log (per-job log kept)
- Shops "what's on hand" inventory module
- **Air conditioners** / second asset type (deferred, not forgotten)
- A **"quick check"** short version of the vitals form — *people would only ever use the quick one, losing the data the full one exists to collect*
- Refuel **prediction**
- Paralleling-link tracking
- **Autofill/prefill of vital readings** — see §8, rule 2
- Push / SMS / email alerting infrastructure (in-app Alerts is enough)
- Roles & permissions
- **CSV import/export** (settled 2026-08-11 — this previously also appeared in §10 as Phase 2; cut wins). Rationale: bulk pre-loads are one-time events, done by an operator with tooling (the NES import in `docs/nes-import.sql` is the precedent), not a recurring in-app workflow a tech would ever touch. The §10 manifest report keeps its own copy/CSV *output*; that is a share format, not an import surface.

> Before adding a feature, check this list and §10. The bar is: does a tired tech on a phone need this in the core loop?

---

## 7. Known issues & technical debt

**Chart.js — removed 2026-08-11 (build `chartjs-rm`).** The vitals view originally used stacked multi-axis charts; they were unreadable (metrics with wildly different ranges cannot share a chart honestly) and were replaced by the Recent-checks table. `drawTrend()`, `trendChartObj`, and the CDN tag are deleted (~70 KB less parse on cold load). The multi-axis rejection stands; if a chart ever returns it is a **single-metric** sparkline, and it re-adds its own library then.

**Photos — resolved 2026-07-30 (build `photos-sw`).** Capture still stores data URIs (works offline); `flush()` uploads them to the `unit-photos` Storage bucket and swaps in public URLs before rows serialize — bounded (6/flush, 8s abort via AbortController) so a stalled LTE upload can't hold the flush lock. Storage outage: URI stays, save proceeds, retried next flush. Accepted debt: removed photos orphan their Storage objects, and a timed-out-but-landed upload orphans + duplicates on retry. **One-time migration of legacy base64 rows (~8 units): `tools/fv_migrate_photos.js` — pending owner run** (`--dry-run` first; ordering matters: only run *after* the `photos-sw` build is live, since the old app could re-flush base64 over migrated rows).

**ID column types are inconsistent: `units.id` is `uuid`, `status_events.id` is `text`.** Two consequences. (1) SQL that inserts into `units` must use `gen_random_uuid()` bare — a `::text` cast aborts the whole transaction (this bit the NES import; `docs/nes-import.sql` now matches what actually executed). (2) `uid()` falls back to a non-UUID string (`'p_' + base36`) when `crypto.randomUUID` is unavailable — dormant in practice because Pages is always HTTPS so `crypto.randomUUID` always exists, but if that fallback ever fired, `units.id` would reject the row while `status_events.id` would accept it.

**`units.photos` is empty fleet-wide BY DESIGN (2026-08-01)** — owner confirmed no condition photos existed; every historical shot documented placement, so all 28 were reclassified into `kind:'photo'` movement events (`docs/photo-reclass.sql`: `tech_name '(migrated)'`, one shared transaction timestamp — obviously a batch migration, never a claimed shutter moment or a fabricated observer). Condition history starts from zero. **An empty condition-photo path is not a broken one** — `fv_inv_placementphotos.js` proves the capture path works on every preflight.

**Photo filename timestamps are upload time, not shutter time.** Every photo path since build `placement-photos` carries an `<ms>-` prefix (units, issues, movements), and Storage keeps `created_at` per object — both record the *upload* moment. Online that's seconds after capture, so matching photos to movements for a reclassification pass works; but use a **generous window**, and know the gap widens once the offline write queue (`docs/plans/2026-07-29-offline-write-path.md`) ships and photos can upload hours after they were taken.

**The `Config` dropdown is not evidence of a true TwinPak.** The big-iron edit form has a free-text-ish `Config` select whose options include the literal string `TwinPak`. That value predates the two-engine model and "musical generators" on a shared chassis can carry it too, so `config === 'TwinPak'` says nothing about whether a record has two engines. **Only the presence of `units.engines` is authoritative.** The trap: any future report, filter or roster keyed on `config` will silently mis-classify records. The toggle deliberately does not derive from it.

**`closeSheet()` unconditionally calls `render()`.** Closing even a read-only sheet rebuilds the whole view and re-initialises Leaflet on the map tab. Will flash/scroll-jump as data grows. Fix: a `dirty` flag on `sheet()`.

**Service worker — shipped 2026-07-30 (`sw.js`, `fv-sw-1`).** Navigations are network-first (3.5s timeout, cache fallback) so online users still get fresh HTML instantly; five CDN hosts are cache-first; backend traffic is never intercepted. SW updates are tap-to-update (`SKIP_WAITING` prompt bar). **Kill switch:** deploy `sw.js` with `KILL = true` — it unregisters and clears `fv-sw-*` caches fleet-wide within one update-check cycle (~10 min). Cache deletion is prefix-scoped because Cache Storage is origin-scoped and every Pages project site shares `apginvests.github.io`; any sandbox copy must rewrite the prefix (see `docs/plans/2026-07-29-offline-write-path.md`, Task 2.4).

**"Reset ALL data" — resolved 2026-07-30 (build `delete-gate`).** Removed entirely, along with the sample-data loader; unit deletion now requires typing DELETE and shows the history count it will destroy.

**Tap targets below guideline.** `.closex` is 34 px; `.backbtn` has `padding:0` around a 16 px SVG (~20 px effective). Should be ≥44 px — users wear gloves.

**No way to edit a job from the job screen.** `editShow()` exists but is unreachable from job detail; the jobs-list swipe only offers Delete.

**Fleet search ignores placement/area/location.** Job-detail search includes them; the fleet-wide search only matches tag/serial/make/model. Techs look for "VIP South".

**`addShop()` uses `window.prompt()`** — the only unstyled dialog left. `quickAddShop()` is the styled equivalent that already exists.

**`moveMenu()` lists every job and shop with no filter.** Recents cover the common case, but this grows unusable mid-season.

**Alerts group by severity only.** With several shows live, the owner cannot tell at a glance which show is in trouble. Sub-grouping by job would fix it.

---

## 8. Standing rules — do not violate these

These were each learned the hard way, several from production bugs.

1. **Status is not placement.** Reporting on a unit must never move it. Only explicit placement actions write location, and `unitGps()` reads only `movements`. This protects a workflow that matters: the office marking a unit down on behalf of someone who doesn't have the app, without corrupting the map.
2. **Never autofill a measured value.** Prefilled readings let someone save without observing — that manufactures plausible-looking data and incentivises faking, which is worse than missing data because missing data is visibly missing. Blank fields force eyes on the gauge. *Pre-selecting a non-measurement is fine* (a destination picker seeded with recents; a status control starting on the unit's current status) because that prevents an unintended change rather than inventing an observation.
3. **Defaults must be honest.** Units start `staged` and become `running` only when a human records it. The log-check status selector starts on the unit's *current* status — it must not default to "Running", or every skipped selector becomes a false claim of health.
4. **Serials are free text, and their format is NEVER validated.** They are not alphanumeric-only — the real fleet contains `1LS01712/14`, `C5E02984-85` and plain `A246B12359`. The Serial and Scan-code fields must stay `type="text"` with a full keyboard. **Never add `inputmode`/numeric keypad to them** to fix the iOS keyboard flip — it would break real entry. Numeric keypads belong only on genuinely numeric fields (24 of them have `inputmode="decimal"`).

   **No length checks, no pattern matching, no character whitelists, no format warnings, no auto-correction, no "did you mean".** Normalisation is **case and whitespace only**. The fleet spans multiple manufacturers with different schemes — different lengths, some with dashes, some with slashes — so there is no fleet-wide format to validate against, and there never will be. A future filter, roster, manifest or CSV import must not reintroduce this. A serial that looks odd is a question for the office with the plate in hand, never a validation error in a tech's face: inferring the "correct" shape from other records is exactly the guess this app exists to remove, and telling someone what to expect primes them to distrust what they actually read. Locked by assertions in `tools/fv_inv_bigiron.js`.
5. **Destructive actions are placed by blast radius, not verb.** Delete-from-fleet lives *only* on the Fleet surface. The job surface offers Off-job only. Job delete refuses while units remain. A native confirm is the last line of defence, never the plan.
6. **Every field optional; never force a photo** on a routine capture.
7. **One gesture, one meaning, everywhere** (§5). Never let a gesture mean different things on two lists.
8. **Neutral trend indicators.** ▲/▼ in grey, never red/green, when "up" isn't universally good — fuel dropping is normal, oil pressure dropping is not. Colour implies a judgement the data can't support.
9. **Sort for the next action.** Actionable items on top, parked items sink — even problems.
10. **Friction is the main risk.** An extra tap in a high-frequency path is a defect, not a polish item; an unused tool produces no data at all.
11. **Any feature that groups/routes by a text label needs a controlled vocabulary first.** Free text never clusters ("medical" / "Medical Tent" / a cross street all mean one place). This is why zone-scoped alerts are unbuilt — see §10.
12. **A write that fails must never be marked as synced.** The rule underneath the 2026-08-01 movements incident, and it outranks the schema-gate lesson that surfaced it: the legacy flush console-warned and re-snapshotted, which converts ANY failed write — schema drift, RLS change, transient error — into permanent invisible loss. Failure must stay dirty (retried) and be visible to the user (the ⚠ sync chip). Interim guard: per-table ack before re-baseline, 30s retry, chip with unsaved count. Full implementation (per-row acks, mid-flight-race closure, poison quarantine): the durable-diff plan.
13. **Tile servers never enter the service worker cache.** Not USGS imagery, not OSM streets, not any future basemap. An unbounded tile cache on a phone invites storage-pressure eviction, and eviction does not respect our priorities — it can evict the IndexedDB write queue along with the tiles. A grey map offline is acceptable; losing queued writes is not. This is a deliberate durability trade, not an oversight to be optimized away: the explicit exclusion lives in `sw.js`'s fetch handler with this reasoning attached, and `tools/fv_inv_sw.js` fails the build if the guard is removed or a tile host is added to `CDN_HOSTS`.


---

## 9. Ship-verify loop (follow this for every change)

Two guards stand behind every deploy, and they are complementary, not interchangeable. The **standing invariant suite** — 963 assertions as of 2026-08-11, `tools/fv_smoke.js` plus every `tools/fv_inv_*.js`, run automatically by preflight, which refuses to clear a broken build — protects the contracts someone has already encoded. The **loop below** catches what no assertion watches yet: the surface you just built, deploy and caching problems, real-device behavior. A green suite is not "shipped", and this discipline without the suite is what let contract regressions slip before the suite existed. Do both.

1. **Read the real current code** for the lines you're changing. Never edit from memory — the file drifts.
2. Make **one logical change**.
3. **Syntax check.** Extract the inline `<script>` and parse it:
   ```bash
   node -e "const fs=require('fs'),vm=require('vm');
   const s=/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i
     .exec(fs.readFileSync('index.html','utf8'))[1];
   new vm.Script(s); console.log('syntax OK')"
   ```
4. **Behaviour-test the changed path with real assertions** — the expected value, the full expected sort order, the stored value read back. *Not* "it didn't throw." A sort bug that put missing values first passed every crash check and failed one order assertion. (Root cause worth remembering: `Number(null) === 0`, not `NaN`.) If what you tested is a contract that must hold forever, its home is a standing `tools/fv_inv_*.js` file (shape in `tools/README.md`) — preflight then re-proves it on every future deploy.
5. **Run the full suite:**

   Preflight also enforces the **publish block** (2026-08-11): if anything under `archive/` (crew data — client site GPS, placement photos, candid notes) or `CLAUDE.md` (personal working context) is tracked or staged, preflight refuses to clear the build. `.gitignore` states the intent; this enforces it — one `git add -A` plus a lost ignore line is all a leak to public Pages would take. Test it with a staged canary file; untrack with `git rm -r --cached`.
   ```bash
   python3 tools/fv_deploy.py preflight -m "what changed"
   ```
   Auto-loads every `fv_inv_*.js` group, prints `RESULT: PASS (963/963)` (count as of 2026-08-11) and refuses to clear the build on any failure. (Suite only, no preflight wrapper: `node tools/fv_smoke.js index.html tools/fv_inv_*.js`.)
6. **Manual regression sweep — narrowed 2026-08-01 to what the suite does not render.** The suite already exercises `renderFleet`, `renderAlerts`, `unitCard`, `paneVitals`, `paneIssues`, `paneService` and `paneMoves` against populated and edge-field fixtures (`fv_inv_fleetcard.js`, `fv_inv_alerts.js`, `fv_inv_bigiron.js`, `fv_inv_status.js`, `fv_inv_placementphotos.js`). Still swept **by hand, in the harness or browser**, because no assertion renders them:
   - `renderJobsList`, `renderJobDetail`, `renderMapScreen`, `paneInfo` — all three states (**empty**, **populated**, **edge**);
   - the **empty** states of `renderFleet` (zero units), `renderAlerts` (nothing alerting), `paneIssues` (no issues) and `paneMoves` (no history);
   - **hostile strings** (quotes/emoji in names and notes) through any render path you touched — `esc()` is unit-tested, but no render entry point is ever fed them;
   - any **new surface** your change adds — the suite doesn't know it exists yet.
7. **Bump the marker(s).** The build marker at `index.html:13` on every deploy. If `sw.js` changed, *also* bump its `VERSION` (`fv-sw-N`, `sw.js:15`) — installed PWAs only refresh their cached shell when that string changes.
8. **Deploy:**
   ```bash
   git add -A && git commit -m "what changed" && git push
   ```
   Pushing `main` ships **everything on it** — `index.html` and `sw.js` both deploy this way; there is no per-file deploy. Work not cleared for production lives on a branch (see the plan-doc convention in `docs/plans/2026-07-29-offline-write-path.md`).
9. **Verify live.** Only now is it shipped. Either poll until the live bytes match the file on disk:
   ```bash
   python3 tools/fv_deploy.py verify
   ```
   or grep the marker:
   ```bash
   curl -s -L "https://apginvests.github.io/fleet-view/?v=$(date +%s)" | grep -o "fleetview build [0-9-]* [a-z+-]*"
   ```
   If `sw.js` changed, also confirm the new version is live:
   ```bash
   curl -s "https://apginvests.github.io/fleet-view/sw.js?v=$(date +%s)" | grep -o "fv-sw-[0-9]\+"
   ```
10. **Record** what changed.

### Headless harness notes
Run the extracted script in a Node `vm` context with fake globals (`document`, `localStorage`, `navigator`, `crypto`, `matchMedia`, `location`, `scrollTo`) and stubs for `supabase.createClient`, `L`, `Chart`, `QRCode`, `Html5Qrcode`. Pitfalls that produce **fake** failures — rule these out before believing a bug:
- module-scope `let`/`const` do **not** attach to the global object (only function declarations do). Append an epilogue *inside* the script exposing internals, e.g. `globalThis.__t = { getS:()=>S, setS:v=>{S=v} }`.
- callback-style stubs (geolocation, FileReader) must actually invoke their callbacks, or continuations never run.
- incomplete DOM fakes crash startup and read as app bugs. Use permissive Proxy-based element fakes.

### Testing against production — don't
The database holds real crew records. To click through the live app safely, build an isolated copy: replace the Supabase client with an in-memory stub (so writes are impossible), fake the session, namespace localStorage, add a visible "SANDBOX — NOT CONNECTED TO REAL DATA" banner, deploy it to a **separate filename**, drive it, then delete it and verify the deletion returns 404. Never point a click-through at production.

### Deploy gotchas
- Writes can succeed against a renamed repo while **Pages paths 404** — git forgives renames, static hosting doesn't. The repo slug is `fleet-view`. (§11 states this too — kept in both places for now.)

---

## 10. Roadmap / open follow-ups

Ordered roughly by value. All are unbuilt and all were deliberately deferred — the owner froze scope to drive crew adoption first.

**Tail of phase 1**
1. **Offline-tolerant field mode.** Show sites have dead zones, which is exactly when the app matters. Step (a) — the service worker app shell — **shipped 2026-07-30**. Remaining: (b) cache last-loaded data, (c) durable write queue replayed on reconnect. Full design, invariants, and sequencing live in `docs/plans/2026-07-29-offline-write-path.md` (durable-diff architecture — the S-vs-SNAP diff *is* the queue; no separate outbox). ~~Moved to the top of the list 2026-08-01~~ — **SHIPPED 2026-08-01**, five verified builds in one day driven by the movements incident: `sync-guard` (interim per-table acks) → `merge-on-load` (reloads merge over dirt; LWW losers parked in SYNC_LOST) → `ack-flush` (per-row acks from captured diff, ordered replay, recoverable quarantine) → `durable-cache` (queue survives app kill; boot renders cached data) → `reconnect` (online/visibility triggers, merge-before-flush). §3 steps 4/4a/4b and the durable-cache paragraph are the operational authority; the plan doc remains the design record. Field verification on a dead-zone show still owed (plan Task 3.7).

1b. ~~**Big iron / TwinPak model**~~ — **shipped 2026-07-30** in three verified pushes (`twinpak-core` → `twinpak-ui` → `twinpak-convert`). One NES line item = one record; a true TwinPak is one record with two engines, event-sourced hours, per-engine status/service targets/nameplates. **§4 (Layer 1b) and §5 are now the operational authority**; `docs/big-iron-hyperagent-spec.md` remains the design record and rationale, not the current spec. Remaining: the tech **binding pass** — seven existing records get the toggle while someone stands at each machine (`1LS01712/14`, `C5E02984-85`, `TGD62501`, `TGD62504`, `X5M00306`, `X5M0038`, `X5M00446`). `TGD62501` and `TGD62504` are two *separate* TwinPaks — do not merge. Verify `X5M0038`'s serial against the unit plate and record exactly what the plate reads — the field sheet states no expected format, per §8 rule 4, and the tech never corrects it in the app. Field sheet: **`docs/twinpak-binding-pass.md`** — one page per unit. Engine 1 is decided by the **control-panel label** (nearly all carry A/B); the only fallback, for a genuinely unlabelled machine, is the **hitch end** — intrinsic to the trailer, unlike road-side which flips with how it was parked. **Serial order is explicitly not evidence**, so the two dual-serial records follow the same label rule as everything else. Both engines get a fresh meter reading at conversion, including Engine A: inherited pre-split hours are history, not a reading. **Progress is visible from the Fleet list:** a `TWINPAK` chip means the split is done, and a `Gen X needs a meter reading` chip means that engine still has no hours read off its own meter — inherited pre-split hours deliberately do not count, because a deterministic assignment of merged history is consistent, not correct.
1c. ~~**Near-match candidates in the add flow**~~ — **shipped 2026-07-31** (build `near-match`; Damerau/OSA distance ≤1 on alphanumerics, 4 candidates, both typed and scan paths, add-anyway never blocked; assertions in `tools/fv_inv_addflow.js`). Original reasoning kept for the record: The add flow searches the fleet before offering "+ Add new asset", but only on an **exact** match. Type `X5M0038` when the machine is `X5M00382` and it finds nothing, offers to create a new asset with the typo prefilled, and the fleet now holds two records for one generator — with a permanent serial nobody can scan.

   **This is not hypothetical. It has already happened three times:** `D19701` alongside `D19701.` (trailing period defeated dedup; the second record also carries an impossible 407,366 hours), `UCV700618` where every other unit in the family is `UVC`, and possibly `X5M0038` itself, which is ambiguous against four real `X5M0038x` serials.

   **The collision surface is structural, not a long tail.** After the NES import the fleet holds 213 serials, and **126 of them — 59% — are within one edit (Damerau, so transpositions count) of another serial**, because the fleet is built from dense sequential families (`U122xxxxx`, `TGD625xx`, `X5M00xxx`). Typing a serial from memory in one of those families is close to a coin flip.

   **Wanted:** when there is no exact match, show close ones before offering to create — *"No exact match. Did you mean X5M00382, X5M00384, X5M00387, X5M00388?"* Tapping one opens that unit. **"Add new anyway" stays available and is never blocked.** This validates, rejects and corrects nothing, so it stays inside §8 rule 4; it only makes creating a duplicate harder than picking the right machine. Open questions for whoever builds it: how many candidates to show, and whether the scan path needs it too — a misread barcode fails the same way. **One thing is already settled by the evidence: plain Levenshtein is not enough.** `UCV700618` vs `UVC700618` is a *transposition*, which is edit distance **2** under Levenshtein and would be missed by a distance-1 rule — the real duplicate would not have been caught. Damerau-Levenshtein, which treats an adjacent swap as a single edit, scores it **1**. Use Damerau, compare on alphanumerics only so case and separators are already ignored.

2. **"What's on my show" report / manifest.** One tap on a job → shareable roster (serial, kVA, placement, status, hours, open issues) + totals, with copy/email/CSV. This is the owner's stated payoff: proof of what was sent to a show without driving around collecting serials. Doubles as the end-of-show punch list for the service department.
3. **Job overview strip** — live tiles (on-site / running / down / overdue / total kVA / avg load) + a needs-attention shortlist, for monitoring from an office.

**Phase 2**
4. **Sizing insight from load %** — flag units consistently under ~30% (oversized → downsize) or over ~85% (→ upsize/parallel). Uses data already captured.
5. **Runtime per show** — hours-run delta from logged engine hours.
6. **Fast-load actions** — optional "lock to this destination" for single-truck scanning, receive-a-truckload, multi-select move.
7. ~~Photos → Supabase Storage~~ — **shipped 2026-07-30** (see §7).
8. ~~**CSV import/export**~~ — **cut 2026-08-11**, resolving this doc's own contradiction with §6 (owner call: bulk loads are one-time operator jobs, done with tooling like the NES import — never an app feature). Manifest export lives inside item 2, unaffected.

**Phase 3**
9. **Zone-scoped alerts.** A project manager defines a job's zone list (~12 max); crew claim zones and receive only their zone's units and alerts. Value: shift handoff (morning/swing/night read the same zone log with no verbal handoff) and accountability (nobody checks 96 units; a tech assigned 12 does). **Blocked until zones are a defined pick-list, not free text** — see §8 rule 11. Requires a small migration (zone list + zone→owner map on the show), wiring the unused `profiles` table for names, and scoping the Alerts screen + badge.
10. **Air conditioners / other asset types** — the company supplies these too. Lightweight: photos, condition, placement, simpler vitals.
11. **Roles** (tech vs office/manager) and a real per-unit service history.

**Small, already-scoped**
- ~~Show-days field on a job~~ **superseded 2026-08-02**: `shows.show_days` shipped as a date *array* (a `days` count can't represent multi-weekend shows). Still open from that idea: "Day 2 of 4" / phase label on the job card, now derivable.
- Archive jobs — as a **button in job detail plus an Archived filter**, deliberately *not* a third swipe direction.
- The §7 debt list.

---

## 11. Constraints & operational notes

- **Repo name is case-sensitive:** `fleet-view`. Pages URLs will 404 on the wrong casing even when pushes succeed.
- The connected GitHub integration used to build this **can push files but cannot create/rename repos or change repo/Pages settings** — those are manual.
- **Supabase migrations** are run in the **dashboard SQL editor** (paste the statements; no token involved). Keep every statement idempotent. The Management API is the *fallback for unattended runs only* — `POST /v1/projects/{ref}/database/query` with `{"query": "alter table ... add column if not exists ..."}` — it was the primary path only while builds ran through an agent with no dashboard access. Its two gotchas, if you do use it: it sits behind Cloudflare and returns **403 `error code: 1010`** for a default `Python-urllib` User-Agent (send a browser `User-Agent` + `Accept: application/json`), and instant signup requires `PATCH /v1/projects/{ref}/config/auth` with `{"mailer_autoconfirm": true}` (already set).
- The **Supabase personal access token** is only ever entered into a secure credential field. It must never appear in this repo, in chat, or in the client. The **anon key in `index.html` is public-safe** by design.
- Supabase free tier allows ~2 active projects per org.
- **Camera, geolocation and persistent storage are denied — silently, with no permission prompt — on sandboxed/CSP-iframe origins.** Always test hardware features on the real Pages origin. The tell for this class of bug is *the absence of a prompt*: a denied permission throws, a blocked origin says nothing.
- Project ref `eujgglfcpdfgskyqfggg`; Supabase project name `fleetview`.

---

## 12. Quick orientation for a new developer

1. Clone the repo. There is nothing to install — open `index.html`.
2. Read §3 (sync), §4 (two-layer model) and §8 (standing rules) before changing anything. Those three sections encode every expensive lesson.
3. To see the app with data, sign in — what loads is the **live production fleet**, shared with the crew. (The sample-data loader was removed so it can't pollute the real fleet.) Look, don't click-test: for safe click-throughs use the §9 headless harness or sandbox procedure. If you must exercise a real write, use a job named with a `DEMO —` prefix and remove it after — Settings shows a **Remove demo data** button while any exists.
4. Make your first change following §9 end to end, including the live verification step.
5. Do not restore anything in §6 without asking.
