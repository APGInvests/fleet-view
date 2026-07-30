# FleetView — Big Iron / TwinPak Build Spec

Work order for the FleetView agent. Self-contained: everything needed is in this file
plus the repo. Read `HANDOFF.md` (repo root) before touching code — especially §3
(sync layer), §4 (two-layer data model), §8 (standing rules), §9 (ship-verify loop).

**Repo:** `APGInvests/fleet-view` (case-sensitive), GitHub Pages from `main`, root.
**Live:** https://apginvests.github.io/fleet-view/
**App:** one self-contained `index.html` (~135 KB), vanilla JS, no build step.
**Owner runs all SQL** in the Supabase dashboard SQL editor — deliver statements, do
not attempt them via API.

---

## 1. The problem

The company's **National Equipment Schedule (NES)** is the system of record for what
counts as one piece of equipment, and FleetView must match it:

- A **true TwinPak** — two machines permanently paired in one shared housing — is ONE
  NES line item, therefore ONE FleetView record with ONE shared serial and TWO engines
  inside. Each engine has its own hours, service interval, nameplate rating, and issues.
- Generators on a shared chassis that **can be removed and swapped** ("musical
  generators") each get their own record. This already works today — do not change it.
- Non-TwinPak big iron already works. Small iron untouched.

Today the app has nowhere to put the second engine, so crews improvised: serials like
`1LS01712/14` (two engine serials in one field) with two engines' hours merged into one
meter value. A merged countdown like "246h to service" is unanswerable — on *which*
engine? That's the operational risk this build removes.

Also in scope, same surface: the **log-check form never shows which unit is being
checked** — identity appears on the selection screen and disappears. On a TwinPak
that's a coin flip on which engine's hours get recorded. Fixed by the identity header
(§5) and the engine picker (§6).

## 2. Schema (deliver to owner for the dashboard SQL editor)

```sql
alter table reports add column if not exists engine text;
alter table issues  add column if not exists engine text;
alter table units   add column if not exists engines jsonb;
```

Then add to `MAPS` in index.html: `engine:'engine'` on reports and issues,
`engines:'engines'` on units. **HANDOFF §3 warning applies: a field missing from
`MAPS` silently never persists.** This is the single easiest way to fail this build.

## 3. Data model

**`units.engines` (jsonb).** Present ⇔ true TwinPak. Shape:

```json
{ "style": "AB",
  "A": { "serviceDueHours": 3493, "lastServiceHours": 3243, "kvaEach": 625 },
  "B": { "serviceDueHours": null, "lastServiceHours": null, "kvaEach": 625 } }
```

- `style` is `"AB"` or `"12"` — whichever the housing is physically labeled. Display
  maps through it ("Gen A" / "Gen 1"). **Stored engine tags are always canonical
  `'A'`/`'B'`** on reports/issues regardless of style, so relabeling never breaks history.
- `reports.engine` / `issues.engine`: `'A'`, `'B'`, or `null`. Null means single-engine
  unit — or pre-split TwinPak history, which **belongs to Engine A** (see §4).
- Flat `currentHours`/`serviceDueHours` columns: untouched for single-engine units
  (zero churn on the ~34 records that work today). On a TwinPak, flat `currentHours`
  is only Engine A's pre-split seed; flat `serviceDueHours` is ignored once `engines`
  exists.
- Movements and map pins stay **chassis-level** — you move a trailer, not an engine.
  No engine dimension on movements.
- `opStatus` stays chassis-level. A single down engine is expressed as an
  engine-tagged issue with severity `down`, which already turns the unit red via
  `computeStatus`.

## 4. Event-sourced hours (the core rule)

`currentHours` for a TwinPak engine is **derived, never stored**:

- `engHours(u,'A')` = latest `engineHours` from reports where `engine` is `'A'` **or
  null** (pre-split history inherits to A, labeled "pre-split" in the UI); falls back
  to flat `currentHours` (the pre-split seed) if no report qualifies.
- `engHours(u,'B')` = latest `engineHours` from reports where `engine === 'B'` **only**.
  No fallback. **A fresh Engine B shows "No checks yet" — it must never display the
  merged record's value.** This is a required invariant test, not a nice-to-have.
- Corrections are new checks: a bad reading is fixed by logging another check (30
  seconds, timestamped, attributed) — never by editing a field.
- On a TwinPak, `saveVitals` must **stop writing** `u.currentHours` (single-engine
  units keep current behavior).

Service targets are NOT observations and stay stored: `serviceDueHours` and
`lastServiceHours` live per engine in `engines[e]`. `editService` / `markServiced` /
`doServiced` gain an engine parameter and write there. Service state per engine uses
the same over/soon/ok thresholds as `serviceState()`; **unit-level status, alert
sections, and the service filter chip use the worst engine**.

## 5. `kvaEach` — required, and `kw/2` is forbidden

Per-engine load % divides by `engines[e].kvaEach` (× 0.8 PF, same formula as today).
`kvaEach` is read off **each engine's nameplate** during conversion. Do not derive it:
paralleling gear, shared bus and housing derate the package — two 250kW engines do not
make a 500kW package, and half the package rating appears on no nameplate (off 5–15%).
A number nobody observed is the same failure as the merged hours.

`kvaEach` is required at TwinPak conversion. This is a deliberate owner-approved
exception to rubric A2's "no new required field": conversion is a low-frequency setup
flow performed while standing at the machine, not a routine capture path. If somehow
blank, per-engine load % shows the existing "set this unit's kVA rating" hint
(`calcLoad` pattern) — it never guesses.

## 6. UI

**Identity header (ALL units, not just TwinPaks).** Pinned card at the top of the
log-check form: serial, engine label (TwinPak only), chassis config, and last recorded
hours for the thing being checked — or **"No checks yet"**. No new tap, no new
required field.

**Two-row engine picker.** On a TwinPak's unit detail, the single "Log check" /
"Flag issue" quick actions become per-engine rows: "Check Gen A · 2h ago" /
"Check Gen B · no checks yet". Same tap count as a single unit; identity is visible
*before* typing. The chosen engine flows through `logVitals`/`flagIssue` →
`saveVitals`/`saveIssue` onto the report/issue row.

**Panes.** Vitals pane gets A/B filter chips (A includes pre-split rows, labeled);
latest-check card, recent-checks table, and check log filter by engine. Service pane:
one countdown card per engine with per-engine actions. Issues pane: engine chip on
engine-tagged issues.

**Add/edit flow.** In the big-iron section of `editUnit`: a "True TwinPak" toggle →
reveals label-style segment (A/B vs 1/2), per-engine nameplate kVA, per-engine intake
hours. Intake hours create **engine-tagged intake reports** (observed, tech-stamped) —
not column writes. Keep the word "TwinPak" in the UI; that's the crew's word.

**Sort.** `byKva`'s final tiebreak (currently serial) becomes: job label when set
(`assetLabel`), else serial. Sort is kVA-ascending with down-units last, per HANDOFF §5
— only the tiebreak changes.

## 7. Cleanup — seven in-place conversions, zero merges, zero deletes

After the feature ships, these existing records get the toggle during a tech **binding
pass** (someone standing at each machine): label style from the housing, both nameplate
kVAs, and Engine B's meter reading logged as its intake check. Engine A keeps the
record's existing history, labeled pre-split.

`1LS01712/14` · `C5E02984-85` · `TGD62501` · `TGD62504` · `X5M00306` · `X5M0038` · `X5M00446`

- `TGD62501` and `TGD62504` are **two separate TwinPaks** (four machines total) — do
  not merge them. Each is one record with Gen 1 / Gen 2 aboard the same serial.
- Flag `X5M0038` for nameplate verification during the pass — likely a missing digit
  (fleet pattern is `X5M00xxx`).
- Policy for future cases only: if two records are ever found describing one machine
  with cleanly attributable histories, the second record's reports may be re-tagged
  onto the survivor as Engine B rather than discarded. Ambiguous merged history always
  stays on Engine A, labeled; Engine B always starts from an observed meter reading.

## 8. Standing rules — breaking any of these fails the build

From HANDOFF §8, all learned from production bugs:

1. Status is not placement — reporting on a unit must never move it; `unitGps()` reads
   only movements.
2. Never prefill a measured value. Blank fields force eyes on the gauge.
3. Honest defaults — the check form's status selector starts on the unit's *current*
   status, never "Running".
4. Serial and scan-code inputs stay `type="text"` with a full keyboard. No `inputmode`.
5. Destructive actions placed by blast radius: delete lives on the Fleet surface only,
   behind the typed-DELETE gate.
6. Every field optional (sole flagged exception: §5 above). Never force a photo.
7. One gesture, one meaning, everywhere.
8. Neutral ▲/▼ trend indicators — grey, never red/green.
9. Sort for the next action; down units sink.
10. Friction is the main risk — an extra tap in a high-frequency path is a defect.

## 9. Test + ship discipline

There is a standing invariant suite in `tools/` (zero npm dependencies). Before ANY
push:

```bash
node tools/fv_smoke.js index.html tools/fv_inv_*.js
```

Everything currently green (96 base + standing invariant files) must stay green.
Add `tools/fv_inv_bigiron.js` (same `module.exports = async (app, t) => {...}` shape
as the existing `fv_inv_*.js` files; `tools/README.md` documents the harness) covering
at minimum:

- `engine` / `engines` survive the `toRow`/`fromRow` round-trip
- **blank-state B**: fresh Engine B renders "No checks yet"; `engHours(u,'B')` is null
  even when flat `currentHours` holds the old merged value
- pre-split inheritance: null-engine reports count for A, never B
- worst-engine service state drives unit chips/alerts; per-engine countdowns correct
  at over/soon/ok boundaries
- per-engine load % uses `kvaEach`, never `kw/2`; hint shown when unset
- TwinPak shows two check buttons, single-engine shows one
- a save with every new field blank still succeeds (no new required field on routine paths)
- sort tiebreak: same-kVA units order by job label, then serial

Ship per HANDOFF §9: one logical change at a time, bump the build-marker comment near
`<title>`, push, then verify the marker is live:

```bash
curl -s -L "https://apginvests.github.io/fleet-view/?v=$(date +%s)" | grep -o "fleetview build [0-9-]* [a-z-]*"
```

Notes: a local clone also pushes to this repo — keep commits small and sequential, and
pull before starting. A service worker (`sw.js`) now serves the app shell; deployed
HTML still reaches online users immediately (network-first), so verify-by-marker works
unchanged. Supabase free-tier egress is at ~8% — do not add anything that grows the
`select('*')` payloads (the `engines` jsonb is bytes; photos are now Storage URLs).

## 10. Out of scope

- Offline/durable-sync work (`docs/plans/2026-07-29-offline-write-path.md`) — separate
  track, not yours.
- Movements/map changes, roles, anything in HANDOFF §6's deliberately-cut list.
