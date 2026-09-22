# Hours-to-Service Runway on the Job Card — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After a truck is unloaded, a PM looking at the job sees how many hours each unit has left before service — so high-runtime areas land on units with the most runway.

**Architecture:** Read-only, render-derived, zero schema, zero row writes. A `🔧` chip renders at the head of the unit card's metaline ONLY when provable: a service-due target exists AND an hours reading (non-voided check) is timestamped after the unit's latest arrival movement onto this show. Everything reads through the existing choke points: `reportsFor()`/`engReports()` (void exclusion, twin lanes), `svcCalc()` (over/soon thresholds), `fmtAgo()` (age words).

**Tech Stack:** Vanilla JS inside `index.html` (no-dependency rule); standing invariants in `tools/fv_inv_svcrunway.js` run by `fv_deploy.py preflight`.

---

## Decisions this plan implements (Andy, 2026-09-22)

1. **Hours come from timestamped check records** (`reports.engine_hours` + `ts`) for singles AND twins — never `units.current_hours` (no timestamp of its own; `updated_at` is touched by any edit).
2. **Arrival = latest real movement onto this show**: `toType='show'`, `toId = unit's current show`, `kind` null, and **from ≠ to** (pin-sets/placement captures write from=to; photos carry `kind:'photo'`). The new-asset birth row (`fromType:null → 'show'`) passes from≠to, so born-on-job units are covered with no special case. No arrival row → no chip (1 unit today: D1970162).
3. **Age is the judgment surface.** Crews don't check units out and jobs sit open for months (Lolla's 47 pass the arrival floor on weeks-old readings). The reading's age always renders next to the hours. Past **14 days** the wording flips from a live countdown claim to a dated fact — the number is never hidden (see tradeoff below).
4. **Twins: lower-of-two, engine named** (`🔧 Gen B 120 h to service · 3d ago`). Per-engine detail already lives on the Service tab. If only one engine has target+fresh reading, show that engine; neither → nothing.
5. **No target or no fresh reading → nothing.** Never invent an interval. Expected day-one gaps, not defects.
6. **Overdue reads red** (`chip bad`, `OVER N h`). Nothing blocks receiving; hours stay optional (receipt-before-hours invariants in `fv_inv_addflow.js`/`fv_inv_addsheet.js` untouched).
7. **Delete `openServicePlanner`** (index.html:1808) — dead code, zero callers (verified: 1 occurrence = the definition; zero refs in `tools/` or `docs/`), §6 cut.
8. **No sort/filter by hours left this build** — killed, parked. Rationale: the NES size sort is settled and is how a PM reads the schedule; a second sort mode is mode confusion; at unload time the chip only has data when the scan-hours toggle was used, so the sort's value is unproven. Re-open only if a PM asks for ranking on a >30-unit show that actually has fresh hours.
9. **Alerts screen + `service` filter chip stay `currentHours`-based** — deliberate scope. For singles `currentHours` auto-tracks every check (index.html:1740) so they stay consistent; switching alerts to the freshness rule would REMOVE units from alerts when data is missing, which inverts the bias-to-flagging doctrine. Separate decision if ever.

### The 14-day tradeoff (told, as asked)

Hiding the number past a cutoff prevents overtrust but punishes long quiet shows — a unit parked on a months-old job may not have run at all, so its old reading is still true, and hours-to-service only **shrinks** over time: an old reading can only overstate runway, and an old OVERDUE is certain, not stale. So: never hide, always date. ≤14d: `🔧 210 h to service · 3d ago`. >14d: `🔧 210 h as of 26d ago` ("to service" — a live claim — is dropped; "as of" is a dated fact). Overdue stays red at any age: `🔧 OVER 35 h · 3d ago` / `🔧 OVER 35 h as of 26d ago`. 14 days ≈ one full two-weekend run (Bourbon): within a run readings are days old, across runs weeks — the threshold splits those populations.

### Day-one fleet picture (live data, 2026-09-22)

198 units on non-archived shows → **99 show a chip** (98 singles, 1 twin — C5E02980-85 at Meta Classic, the only twin with per-engine due targets). Nothing at Bourbon (0 — hours deliberately skipped at load-in; crew true-up makes chips appear) and Head Trip (0). Gaps: 12 twins lack per-engine due targets, 32 singles lack `service_due_hours`, 16 units' latest reading predates arrival, 1 unit has no arrival row. All render nothing, honestly.

---

## Task 1: Write the standing invariants (failing first)

**Files:**
- Create: `tools/fv_inv_svcrunway.js`

**Step 1.1: Write the file.** Shape per `tools/README.md`: `module.exports = (app, t) => {...}`, fixtures via `app.setState`. Groups:

- **arrival discrimination** — real move (from show→show, shop→show) counts; birth row (`fromType:null`) counts; pin-set (from=to) never; `kind:'photo'` never even when handed from≠to and a destination (adversarial, same pattern as `fv_inv_placementphotos.js`); latest of several arrivals wins; off-show unit → null.
- **freshness floor** — reading after arrival → chip with correct remaining (due − reading); reading before arrival → no chip; no arrival row → no chip; voided check excluded (next-oldest fresh reading used, or nothing).
- **no inventing** — due missing → nothing; reading missing → nothing; both present but stale → nothing… (floor) / dated wording (age).
- **states & wording** — remaining > warnHours → plain chip `N h to service · <age>`; ≤ warnHours → `chip warn`; ≤ 0 → `chip bad` + `OVER |N| h`; >14d flips to `as of <age>`, overdue stays `bad` at any age.
- **twins** — lower-of-two named via `engName`; A lane accepts untagged (pre-split doctrine), B lane never inherits untagged; one-eligible-engine shows that engine; neither → nothing.
- **card contract** — chip appears in metaline, never in the title (`sizeLabel` still leads, size-locked doctrine); a unit with no chip renders the card unchanged.
- **dead code gone** — `typeof app.fn.openServicePlanner === 'undefined'` (or source does not contain the identifier).
- **nothing blocks** — a unit with zero reports and no movements still renders a receivable card.

**Step 1.2: Run to verify failure.**
```bash
node tools/fv_smoke.js index.html tools/fv_inv_*.js
```
Expected: FAIL — `svcRunway`/`runwayChip` undefined (and the openServicePlanner-absent assertion fails while the function still exists).

## Task 2: Implement in `index.html`

**Files:**
- Modify: `index.html` — new block near the other card helpers (~line 935, above `unitCard`); one-line insert in `unitCard`'s metaline (line 993); delete `openServicePlanner` (line 1808).

**Step 2.1: Add the helpers** (exact code; comments state constraints per house style):

```js
/* ===== HOURS-TO-SERVICE RUNWAY (2026-09-22) =====
   The PM placement question at unload: which units have the most hours left
   before service. Renders ONLY when provable: a service-due target exists AND
   an hours reading was logged AFTER the unit's arrival on THIS show. No
   reading, a pre-arrival reading, or no target = nothing — never invent an
   interval, never carry old hours. Crews don't check units back out and jobs
   sit open for months, so the reading's AGE is the judgment surface; the
   arrival floor only proves "observed on this job". Hours-to-service can only
   shrink between readings, so an old reading overstates runway (and an old
   OVERDUE is certain) — the >14d wording drops the live claim, keeps the fact. */
function arrivalTs(u){const sid=unitShowId(u);if(!sid)return null;let t=null;
  S.movements.forEach(m=>{if(m.unitId===u.id&&m.toType==='show'&&m.toId===sid&&m.kind==null
    &&(m.fromType!==m.toType||m.fromId!==m.toId)&&(t==null||m.timestamp>t))t=m.timestamp;});
  return t;}
function freshRead(u,e,arr){if(arr==null)return null;
  return (e?engReports(u,e):reportsFor(u.id)).find(r=>r.engineHours!=null&&r.timestamp>arr)||null;}
function svcRunway(u){const arr=arrivalTs(u);if(arr==null)return null;
  if(!isTwin(u)){if(u.serviceDueHours==null)return null;
    const r=freshRead(u,null,arr);if(!r)return null;
    return{eng:null,remaining:Math.round((u.serviceDueHours-r.engineHours)*10)/10,readTs:r.timestamp,state:svcCalc(u.serviceDueHours,r.engineHours).state};}
  let best=null;
  ENG.forEach(e=>{const due=engMeta(u,e).serviceDueHours;if(due==null)return;
    const r=freshRead(u,e,arr);if(!r)return;
    const rem=Math.round((due-r.engineHours)*10)/10;
    if(!best||rem<best.remaining)best={eng:e,remaining:rem,readTs:r.timestamp,state:svcCalc(due,r.engineHours).state};});
  return best;}
const RUNWAY_STALE_MS=14*24*3600e3;
function runwayChip(u){const rw=svcRunway(u);if(!rw)return '';
  const cls=rw.state==='over'?'chip bad':(rw.state==='soon'?'chip warn':'chip');
  const age=fmtAgo(rw.readTs);const old=(now()-rw.readTs)>RUNWAY_STALE_MS;
  const who=rw.eng?(engName(u,rw.eng)+' '):'';
  const txt=rw.remaining<=0
    ?('OVER '+Math.abs(rw.remaining)+' h'+(old?(' as of '+age):(' · '+age)))
    :(old?(rw.remaining+' h as of '+age):(rw.remaining+' h to service · '+age));
  return '<span class="'+cls+'">🔧 '+esc(who+txt)+'</span>';}
```

**Step 2.2: Insert into `unitCard` metaline** (line 993) — `runwayChip(u)` becomes the FIRST item so runway sits in the same position on every card (scannable while thumbing a 59-card list):

```
<div class="metaline">${runwayChip(u)}${isTwin(u)?...
```

**Step 2.3: Delete `openServicePlanner`** (the whole function at line 1808 — nothing else on adjacent lines).

**Step 2.4: Syntax check** (HANDOFF §9.3 vm parse). Expected: `syntax OK`.

Harness note: all additions are function declarations + one `const` — no new mutable top-level bindings, so no `LIVE_BINDINGS` registration.

## Task 3: Green suite

**Step 3.1:** `node tools/fv_smoke.js index.html tools/fv_inv_*.js` → expected PASS, count > 1416.
**Step 3.2:** Fix until green. If a fixture exposed a wrong assumption, fix the code, not the assertion.

## Task 4: Manual regression sweep (§9.6)

Harness-render `renderJobDetail` on: empty job, populated job (chip + no-chip + twin + overdue + stale-wording units), hostile strings in job labels alongside the chip. Confirm `renderFleet`/`renderAlerts` unchanged (chip is job-card only — `unitCard` is used by job detail; verify fleet cards don't route through it, and if they do, decide: chip renders there too, which is acceptable and consistent — note the outcome).

## Task 5: HANDOFF + marker

- §3 build entry `svc-runway` (this feature, the 14-day doctrine, day-one counts, the kill on sort/filter, openServicePlanner deletion, **and decision 8: the arrival movement — unit onto job = the receipt — is now load-bearing for this feature; the return/checkout direction is separately unused and could be trimmed later, but the arrival record must stay**).
- §5 job-detail section: one line about the runway chip.
- Bump build marker (index.html:13) to `2026-09-22 svc-runway`.

## Task 6: Preflight + staged commit — STOP BEFORE PUSH

```bash
python3 tools/fv_deploy.py preflight -m "svc-runway: hours-to-service on the job card"
git add index.html tools/fv_inv_svcrunway.js HANDOFF.md docs/plans/2026-09-22-svc-runway.md
git commit -m "svc-runway: hours-to-service runway chip on job cards, 14d age doctrine, openServicePlanner removed"
```
Named-file staging only (never `-A`). **Do not push** — Andy pushes after review.
