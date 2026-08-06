# QR identity + service logging — design proposal (no build)

2026-08-06. Proposal only. Schema changes list every column (gate-compliant). Nothing here adds
a required step, blocks logging, or surfaces per-tech metrics. Forensic details below use unit
serials and relative descriptions only; the tech-attributed evidence stays in the local archive
data, not in this doc.

---

## 0. Verdict in one paragraph

Wrong-unit logging is real, measurable, and not one person's habit: 5 confirmed wrong-unit
checks across 4 incidents at the two archived shows (~1.5% of hour-bearing checks — a floor,
since only large meter divergence is detectable). One incident corrupted a unit's stored hours
badly enough to manufacture a phantom 6,366-hour service overrun that is still in the live
record. QR-as-presence-proof is the right fix, the app is closer to ready than expected (a
scanner, near-match, and duplicate refusal already exist), and the total build is four small,
independently shippable phases. The labels remain the long pole — ride the shop service cycle
rather than doing a labeling blitz.

---

## 1. What the QR encodes and where a scan lands

**Encode a URL carrying the record id:** `https://<app-origin>/#u=<unit-uuid>`. Print the CES
serial as human-readable text on the same label.

Why this beats the alternatives:

| Option | Fails because |
|---|---|
| Raw UUID string | Only the in-app scanner understands it; a phone camera scan dead-ends |
| Serial in the QR | Survives nothing: serial corrections orphan the label; nameplate-padding ambiguity re-enters through the side door |
| **URL + uuid (chosen)** | Native camera opens the app at the unit; in-app scanner parses the same payload; serial edits never break labels; reprint is idempotent |

The serial printed under the code is the fallback when the camera path fails and the human
verification ("does the label match the nameplate?").

- **App not installed:** there is no install — it's a web app. Any phone camera opens the URL.
- **Not signed in:** auth gate appears (verified: anon reads return zero rows under RLS, so an
  outsider scanning a label sees a login screen and nothing else). The deep link is stashed
  before the gate and applied after `loadAll` — needs a small boot-sequence change since the app
  currently reads no URL state at all (no `location.hash` handling anywhere; `sw.js` serves the
  shell for every path, so deep links work offline too; Supabase is `detectSessionInUrl:false`,
  no conflict).
- **Unknown id** (deleted/merged record): toast + land on scan/search screen. Never a dead end —
  the printed serial still searches.
- **In-app scanner:** `handleCode` learns one new case — payload starts with the app origin →
  extract uuid → open unit. Legacy serial/tag scanning unchanged.

**A scan lands on the unit card, never a form.** This matches the app's existing architecture:
today there is no path from any entry point directly into the check form — everything lands on
unit detail first. Scan keeps that invariant and the tech chooses the action.

### The stale-assignment trap

Confirmed in code: a saved check's `showId` comes from `unitShowId(u)` — the **unit's** assigned
location, never the UI-selected show. So a check on a stale-assigned unit is stamped to the old
show, exactly as feared. The scan is itself evidence of where the unit is; use it:

On scan-open, evaluate in order, show at most one dismissible banner on the unit card:

1. **In transit to this show** (`locationType='transit'`, destination = context show):
   "In transit to {show}. Arrived?" → one tap = existing `doMove` with fresh GPS.
2. **Assigned to a different show than the one open in the top bar:**
   "Assigned to {Show A} — you're working {Show B}." → [Move to Show B] / dismiss.
3. **Assigned to a shop / unassigned** while a show is open: same one-tap move offer.
4. **Assignment matches context: no banner, zero friction.** This answers the false-positive
   worry — a unit legitimately checked at its own show never sees the prompt, because techs work
   with their show open. Dismissals are remembered per unit per session (no re-nagging).
5. Only when no show is open (fleet-wide view): best-effort GPS vs the assigned show's site
   coords; > ~25 km apart → soft "this unit is assigned far from here" with recent-show
   choices. Silent on GPS failure.

Nothing blocks logging. A tech who dismisses and logs anyway produces exactly today's data — no
regression, and the movement written by an accepted one-tap move carries fresh GPS, which is
also how map pins are set. **QR adoption therefore heals the stale-pin clustering as a side
effect** (pins derive solely from movement GPS; a move without GPS keeps the old pin — that's
the confirmed clustering mechanism).

Residual gap, named honestly: if the tech dismisses the banner, the check still stamps the old
show. Reattributing later would need the scanning context stored per check; deliberately
excluded from v1 to keep the schema change minimal — the archives will show whether dismissals
are common enough to justify it.

---

## 2. Check provenance (scan cannot be the only path)

Scanning is never required; the record captures **how** each check was opened.

**Schema — complete column list (idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`):**

| Table | Column | Type | Values |
|---|---|---|---|
| `reports` | `opened_via` | `text` null | `'scan'` \| `'search'` \| `'map'` \| `'list'`; null = legacy |
| `movements` | `opened_via` | `text` null | same vocabulary |

Plumbing: `openUnit(id, origin)` records the origin; it rides the open unit card and is copied
into the check/movement at save. Navigating away clears it. MAPS entries added for both columns
(schema gate satisfied — column exists before field ships).

Surfacing: **aggregate only.** Archive `dictionary.md` documents the column; `checks.csv` /
`movements.csv` carry it; `cadence.md` gains one line per show — "N% of checks opened by scan."
No per-tech splits anywhere, no in-app per-check badge in v1.

Sequencing insight: this ships **before labels exist** and is immediately useful — the in-app
barcode scanner already exists, so one show of data establishes the baseline mix of map-tap vs
list vs search vs scan. That baseline is the evidence the wrong-unit conversation currently
lacks (today nothing records entry point, which is why the incident analysis below cannot say
whether the map was the vector).

---

## 3. What the existing data shows (Lollapalooza + Hinterland archives)

Method: per-unit engine-hour sequences (split per engine), flagged backward jumps and
faster-than-wall-clock advances, then tested every anomalous reading against co-located
neighbours' trajectories, plus fingerprint conflicts (battery 12 V vs 24 V, voltage class,
rating vs unit kW). Live data was not readable (RLS blocks anon; correct behavior) — analysis
covers the two archives: 349 checks, 326 with meter readings.

**Detected: 5 wrong-unit checks, 4 incidents, ~1.5% of hour-bearing checks. Multiple techs at
both shows — systemic, not one person.**

| Case | What the data shows |
|---|---|
| Show A, X5M00357 | Its record received a neighbour's meter (19,822) twice within minutes; the true neighbour X5M00394 — same model, same stage, 136 m away — read 19,823 thirteen minutes later. The tech even self-annotated "last check had typos." Identical model: voltage, battery, rating fingerprints all match — only the hour meter differs. |
| Show A, X5M00446 | 14,645 logged two minutes after its own 21,610. 14,645 interpolates same-stage neighbour X5M00207's trajectory exactly (14,638 → 14,647 bracket); X5M00207 has **no check at that time** — its reading landed on the wrong record. |
| Show B, 8510811 | Two clean interleaved trajectories on one record: 3,030 → 3,054 and 9,545 → 9,561, logged by two different techs over the same two days. No unit in the archive carries a ~9,500-hour meter — the second machine was never registered or never otherwise checked. Consequence: the unit's stored hours are now 9,561 against a real meter of ~3,054, showing **over service by 6,366 hours** — a phantom alert manufactured by wrong-unit logging. |

Context that keeps this honest:

- Most anomalies the scan surfaced are **typos**, not wrong units: dropped digits (6150→615),
  fat-fingered extra digits (2641→12641), and decimal-display misreads (615.0 read as 6150).
  The shipped hours warning now catches that whole class at entry.
- The hours warning fires on all five wrong-unit checks too (backward/too-fast) — but it frames
  the problem as a typo, is dismissible, and structurally **cannot** catch the worst variant: a
  wrong unit whose meter happens to be close (the two Show-A pairs are identical models where
  every fingerprint matches except hours).
- **Detection floor, not a rate.** Only large meter divergence is detectable; co-located
  same-model units with similar hours are invisible by construction, and the median unit at
  Show A has 2 checks — too few to self-check. 1.5% is the minimum, unknowable maximum.
- The map-pin mechanism specifically: pin clusters exist (two ≥3-unit clusters within 15 m at
  Show A), but with no provenance recorded, **the data cannot say which entry point caused any
  incident** — both confirmed Show-A cases are same-stage neighbours, consistent with a
  cluster mis-pick via map or list alike. §2 exists to answer this next time.

---

## 4. Service logging at the machine

**Model: one authoritative clock on the unit (as today) + an append-only `services` history
table. The typed service record with a `kind` field is ~90% of the value; a second clock is
deliberately not built.**

Reasoning: filters-only service is an emergency stopgap that keeps a bogging machine running —
it is not a scheduled cadence anyone manages a countdown for. It needs to be *visible in
history* (so a mechanic knows filters are fresh), not *counted down*. Oil keeps the one clock.
The `kind` column leaves room for a second clock later without remodeling; build it only if
filter cadence ever becomes a managed thing.

**Schema — new table, complete column list:**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `unit_id` | `uuid` not null | |
| `show_id` | `uuid` null | unit's location at time of service; null off-show |
| `engine` | `text` null | `'A'`/`'B'` for TwinPak engines, null = whole unit |
| `kind` | `text` not null | `'full'` \| `'filters'` |
| `at_hours` | `numeric` null | meter at service — **typed, never prefilled** (observation rule) |
| `tech_name` | `text` null | |
| `notes` | `text` null | |
| `photos` | `jsonb` null | sticker/oil-analysis photo if wanted |
| `ts` | `timestamptz` | device time, consistent with other tables |
| `received_at` | `timestamptz` default `now()` | server-owned; `ro` in MAPS |

RLS: same flat authenticated policy as every other table. Archive: `services.json` +
`services.csv` + dictionary entry.

Behavior:

- Service pane gains **Log service**: kind toggle (Full / Filters only), hours (typed), notes,
  optional photo. Every field optional except kind.
- `kind='full'` → insert row **and** reset the clock exactly as the existing mark-serviced flow
  does (last = at, due = at + interval, interval prefilled 250 — prefill is fine here, it's
  system knowledge, not an observation). `kind='filters'` → row only, clock untouched. That is
  the two-service-types distinction expressed in one column.
- The existing mark-serviced button becomes the `'full'` path so history is never skipped.
- **Append-only.** No edit/delete UI; a mistake is corrected by another entry with a note.
  That is the sticker-stack semantics, and it is what makes the history trustworthy.
- Service history list on the unit card = the 38-sticker stack, digitized, readable below the
  top layer for the first time.

**Self-correction is designed in, with one correction to the premise:** the walk-up flow does
*not* prompt for hours when a unit is scanned into a show — that intake happens only in the
add-asset form or the service-pane edit. Current hours self-correct from the first check
(singles); `serviceDueHours` only corrects when someone edits it. The model tolerates this:
clock authoritative and editable on the unit, history sparse and append-only, no reconciliation
logic. An unlogged shop service costs one stale countdown until the next edit — same as today.

**Roles: not needed.** The two travel mechanics and the regional manager are already
authenticated users of the same flat-RLS fleet; nothing in this design is more destructive than
the existing mark-serviced. Roles (§10 item 11) stay parked; they become worth revisiting only
if office wants edit-locks on history.

---

## 5. Labels — the honest operational cost

Inside the control-panel door solves weather and puts the label on the surface people already
open. What it does **not** solve:

| Problem | Honest answer |
|---|---|
| Durability | Laminated polyester/vinyl thermal labels (oil- and abrasion-resistant) — not paper. ~$0.10–0.50/label; a suitable thermal printer is ~$300 once, or pre-printed polyester labels from a vendor off a CSV export. Diesel-soaked rags will still kill some; plan on reprints. |
| Rollout on 238 units | **No blitz.** Print-on-demand at the shop as units cycle through service; coverage grows over roughly one service cycle. Units on long deployments stay unlabeled until they return — the serial-search fallback *is* the current UX, so unlabeled ≠ broken. |
| New unit | Record created in the app first (existing add flow), label printed at the shop with the unit present. The label is born from the record, so mis-marriage of label-to-record can't happen at a desk. |
| Missing/destroyed label | Fallback is today's flow (search/near-match). Reprint = regenerate the same URL from the unit card or tools script — idempotent because the payload is the record id, not the serial. |
| **Door swaps** | The worst residual risk, named plainly: control doors get swapped between units during repairs, and a label that travels with a door asserts a wrong identity with full confidence. Rule: whoever swaps a door peels the label; the printed serial-vs-nameplate glance and the hours warning are the backstops. This will occasionally fail. A frame-mounted label avoids it but abandons the sticker-habit surface — not worth it. |
| Ongoing burden | Someone at each shop owns printer + stock. Initial coverage ≈ a day of labor spread across service visits; steady state ≈ minutes per week (reprints + new units). |
| Tooling | `tools/fv_labels.js` generating a print-ready PDF (pdfkit already an approved tools/ dep) — batch or single unit. Inside the no-dependency rule's scope. |

---

## 6. What the data honestly supports (for August 17)

Three facts that survive questioning:

1. **Coverage and cadence.** At the two archived shows, 92 of 104 deployed units were checked —
   Hinterland: 27 of 27, every unit — 349 checks at ~26–28/day across up to 9 techs, with 96% /
   89% of checks carrying a meter reading even though every field is optional.
2. **The mechanics' workflow is real and unprompted.** Travel mechanics logged faults on the
   record mid-show — low charging voltage caught and annotated, an alternator belt tightened and
   logged, fuel/oil-pressure catches before failure, a unit hard-downed. Notes on 22–48% of
   checks. This was adoption nobody had to run.
3. **Observed load is documented, unit by unit.** Median load 11% (Lollapalooza) / 17%
   (Hinterland), p90 ≤ 40%, across 274 load readings — hard per-unit evidence for right-sizing
   conversations, stated as observations, not savings claims.

Plus the deliverable itself: archives with site maps, placement photos, per-unit cadence — a
client-ready record that didn't previously exist. And a defensible meta-point: the data is
audit-grade enough that it surfaced its own data-quality problem (§3), and the fix is scoped
(§1–2) — that is a stronger position than pretending the data is perfect.

What it does **not** support — do not say these:

- Dollar savings, downtime-prevented counterfactuals, fuel numbers (no fill records).
- Fleet-wide claims: 104 of ~238 units appear; the rest have never been logged.
- Adoption *trend* claims — two shows, and early-show silence reflects the adoption ramp, not
  usage decay.
- A precise wrong-unit rate (1.5% is a detection floor).
- Anything per-tech. The record is not a scoreboard.

---

## 7. Costs and build order

| Phase | What | Size | Schema |
|---|---|---|---|
| 1 | Provenance capture (`opened_via`) + archive columns + cadence aggregate | ~80–120 lines + 1 invariant file | 2 columns |
| 2 | Hash deep-link + QR-URL scan handling + stale-assignment banner | ~200–300 lines + invariants (boot-order care: offline shell, auth stash) | none |
| 3 | `services` table + Log-service sheet + history pane + archive export | ~150–250 lines + invariants | 1 table, 11 columns |
| 4 | Labels: `tools/fv_labels.js` + printer + shop process | ~150 lines tooling; the real cost is operational (§5) | none |

Phases are independent; each is a normal ship-verify-loop deploy. 1 and 3 deliver value with no
labels in the world. 2 makes the app scan-ready before the first label is printed. 4 rides the
service cycle.

Constraint check: no new required field anywhere; scan never mandatory; banner warns and
offers, never gates; no per-tech surfacing; every schema change lists all columns; reporting
still never mutates (a *full service* mutates the clock — that is the service action itself,
same as the existing mark-serviced, not a status report side effect).

---

## 8. Corrections to the prompt's description of the code

1. **Scan-into-show does not prompt for hours.** The scan-in loop writes a movement and
   location only. Hours intake exists only in the add-asset form and the service-pane edit, so
   "the system self-corrects at the next show" is only half-automatic: `currentHours` heals via
   the first check; `serviceDueHours` heals only if someone edits it.
2. **A map pin already opens the unit card, not a check form** — no entry point reaches the
   form directly. The scan-lands-on-card instinct matches the existing architecture exactly.
3. **Near-match tolerance is 1 edit** (Damerau-Levenshtein ≤1, case/punctuation-normalized), so
   a nameplate serial with 3+ padding zeros indeed finds nothing and offers "add new" — the
   duplicate-creation risk described is real; exact duplicates are hard-blocked at save.
4. **Checks carry no GPS by design** (`gps: null` on every report), so no presence evidence of
   any kind exists today. A cheap alternative — storing GPS on checks (the column already
   exists) — would detect ~100 m-scale wrong-unit cases after the fact, but it stores per-tech
   location on every check, which is scoreboard-adjacent surveillance. Recommended instead:
   GPS used transiently at scan time for the staleness banner (§1), persisted only on
   movements, as today.
5. **One clock is right for singles; TwinPaks already run per-engine clocks** in the `engines`
   JSON — the `services.engine` column covers them.
