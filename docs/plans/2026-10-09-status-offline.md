# Status Model (OFFLINE) + Undisplaceable Badge + Card Icon Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship two builds: `card-icon-size` (the oversized ⚠ on stale cards + an invariant killing the unsized-icon class) and `status-offline` (quick states become STAGED/ONLINE/OFFLINE, Down moves behind Flag Issue with a working recovery loop, and the status badge becomes undisplaceable — condition facts move to stripe color + metaline chips).

**Architecture:** `computeStatus` splits into two channels: `state` (what the machine IS — drives the pill, can never be displaced) and `color` (worst condition — drives the stripe and map pin, unchanged priority). `'offline'` is a new stored value on `units.op_status` / `status_events.status` — **zero schema** (text columns, no CHECK constraints, verified live 2026-10-09). `'running'` stays the stored string and renders as ONLINE (the render-only-rename house pattern, same as kW). No data migration: history is append-only truth; the live fleet converges as crews tap (Andy's ruling 2026-10-09 — **no day-one reclass pass**).

**Tech stack:** vanilla JS in `index.html`, invariants in `tools/fv_inv_*.js` run by `tools/fv_smoke.js` / preflight. No deps, no build step.

**Settled decisions (Andy, 2026-10-09 — do not re-litigate):**
- Quick states: STAGED / ONLINE / OFFLINE. Down leaves the quick row AND the check-form segment; Flag Issue → Hard down is the only down writer.
- OFFLINE = in place, cabled, deliberately shut off (plant rotation / PM window). Wind-down at show wrap keeps using STAGED.
- OFFLINE color must read "deliberate and fine" at a glance — not a warning. (Chosen below: muted teal.)
- Alerts: OFFLINE suppresses the 6-h stale nag and low-fuel like staged, **with a 14-day re-arm** into Overdue-for-a-check.
- No bulk reclass for AQHC/Head Trip — first offline tap must be a real one.
- Report: offline units live in RUNNING OK with plain "switched off on purpose" language an ops reader can't mistake for a fault.
- Non-negotiables: size-first titles stand; nothing displaces the status badge (pinned by invariant); receiving unconditional; no new required inputs.

**Gate (every task):** invariant first → watch it fail → implement → suite passes → commit by named file. Suite run: `TZ=America/Los_Angeles node tools/fv_smoke.js index.html tools/fv_inv_*.js`. Full gate before each commit: `python3 tools/fv_deploy.py preflight -m "<msg>"`. **Never `git add -A`** — stage by name. **STOP BEFORE PUSH** — Andy pushes after review.

**§9.1 rule applies to every task: read the real current lines before editing. Line numbers below were true at plan time and WILL drift as tasks land.**

---

## Build A — `card-icon-size`

### Task 1: Kill the unsized-icon class

**Files:**
- Create: `tools/fv_inv_icons.js`
- Modify: `index.html` (IC map ~:309–326; CSS `.fresh` ~:123)

**Why:** The stale ⚠ is `IC.warn` inside `<span class="fresh">` (unitCard metaline, ~:1080). Every other icon context has a CSS svg rule (`.uloc svg{15px}`, `.btn svg{17px}`, nav 23px); `.fresh` has none and no IC glyph carries width/height attributes, so the SVG renders at the replaced-element default (300×150) and wraps the timestamp/tech line (visible on X5M00213, X5M00375). Same class as the unsized empty-state glyph killed in `add-flow-clarity`.

**Fix shape:** every IC glyph gets intrinsic `width="16" height="16"` (CSS rules override attributes, so all sized contexts render byte-identically; anywhere unstyled now gets 16px instead of 300×150), plus a `.fresh svg` rule sized to the 11px mono line.

**Step 1 — write the failing invariant.** Create `tools/fv_inv_icons.js`:

```js
/**
 * fv_inv_icons.js — no unsized icon markup may render, anywhere
 * (2026-10-09, `card-icon-size`).
 *
 * Field incident: the stale ⚠ (IC.warn) inside .fresh had no CSS svg rule and
 * no intrinsic size, so it rendered at the 300x150 replaced-element default and
 * wrapped the card's timestamp/tech line (X5M00213, X5M00375). Same class as
 * the unsized empty-state glyph killed in add-flow-clarity. Contracts:
 *
 *  1. SOURCE-LEVEL (kills the class): every IC.* svg string carries explicit
 *     width= and height= attributes. CSS still overrides where a context wants
 *     a different size; the attribute is the floor that makes "unstyled
 *     context" mean 16px, never 300x150.
 *  2. RENDER-LEVEL: a stale unit's card contains no <svg without width=.
 *  3. The .fresh context has its own CSS svg sizing rule (the icon rides an
 *     11px mono line; 16px intrinsic is still too big there).
 */
'use strict';
const fs = require('fs');
const path = require('path');
module.exports = (app, t) => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  t.group('icons: every IC glyph carries an intrinsic size');
  {
    // The IC literal + the IC.plus append both live before the BACKEND banner.
    const zone = src.slice(src.indexOf('const IC={'), src.indexOf('/* ===== BACKEND'));
    const svgs = zone.match(/<svg[^>]*>/g) || [];
    t.ok(svgs.length >= 15, 'found the IC glyph set (' + svgs.length + ')');
    svgs.forEach((s) => {
      t.ok(/\bwidth="\d+"/.test(s) && /\bheight="\d+"/.test(s),
        'IC glyph has explicit width+height: ' + s.slice(0, 60));
    });
  }

  t.group('icons: stale card renders no unsized svg; .fresh is CSS-sized');
  {
    app.setState({
      shows: [{ id: 's1', name: 'Show' }],
      units: [{ id: 'u1', serial: 'X5M00213', klass: 'big', kw: 625,
        opStatus: 'running', locationType: 'show', locationId: 's1',
        currentHours: 3200, serviceDueHours: 3022, jobMeta: {}, photos: [] }],
      reports: [{ id: 'r1', unitId: 'u1', engineHours: 3200, techName: 'Edwin M.',
        timestamp: Date.now() - 48 * 3600e3 }],
      issues: [], movements: [], status_events: [] });
    const u = app.S.units[0];
    t.eq(app.fn.isStale(u), true, 'fixture is stale (control — the warn icon renders)');
    const card = app.fn.unitCard(u, 's1');
    (card.match(/<svg[^>]*>/g) || []).forEach((s) =>
      t.ok(/\bwidth="\d+"/.test(s), 'card svg is sized: ' + s.slice(0, 60)));
    t.ok(/\.fresh svg\{[^}]*width/.test(src), '.fresh has its own svg sizing rule');
  }
};
```

**Step 2 — run it, expect FAIL** (no IC glyph has width=; no `.fresh svg` rule):
`TZ=America/Los_Angeles node tools/fv_smoke.js index.html tools/fv_inv_*.js`

**Step 3 — implement.** In `index.html`:
- In the `IC` map (~:309) and the `IC.plus` append (~:326): change every `<svg viewBox=` to `<svg width="16" height="16" viewBox=` (17 glyphs: bolt, jobs, fleet, map, bell, scan, pin, truck, warn, back, search, check, wrench, log, report, plus). Nothing else in the strings changes.
- CSS, next to `.fresh` (~:123), add: `.fresh svg{width:12px;height:12px;flex:0 0 12px}`

**Step 4 — suite passes.** Also eyeball in the harness or browser: stale card metaline is one line again; nav/btn/uloc icons unchanged (their CSS rules still win).

**Step 5 — preflight + commit** (bump marker `index.html:13` → `<!-- fleetview build 2026-10-09 card-icon-size -->`):

```bash
python3 tools/fv_deploy.py preflight -m "card-icon-size: intrinsic icon sizes; stale ⚠ no longer explodes the metaline"
git add index.html tools/fv_inv_icons.js
git commit -m "card-icon-size: every IC glyph gets intrinsic 16px; .fresh svg sized; invariant kills the unsized-icon class"
```

---

## Build B — `status-offline`

All Build B invariants live in one new file, `tools/fv_inv_statusmodel.js`, grown group-by-group per task (the fv_inv_fuelunit pattern). Create it in Task 2 with the header below; each later task appends its group. Shared fixture helpers at the top:

```js
/**
 * fv_inv_statusmodel.js — operating state vs condition, OFFLINE, down coupling
 * (2026-10-09, `status-offline`).
 *
 * Data verdict that drove this (live, 2026-10-09): 166 running→staged flips,
 * median 25 h running; 115 flip BACK to running after a median 24 h parked —
 * daily plant rotation on big iron (AC/DC TGDs, AQHC U122s, Meta Classic,
 * Portola UVC700s, Head Trip), logged as "staged" because no honest state
 * existed. OFFLINE names it: in place, cabled, deliberately off.
 *
 * Contracts:
 *  1. THE BADGE IS NEVER DISPLACED. computeStatus returns state (what the
 *     machine IS) and color (worst condition) as separate channels. The pill
 *     text is always the state label — ONLINE/OFFLINE/STAGED/DOWN/IN TRANSIT —
 *     no condition (service, fuel, cosmetic) may ever appear in it.
 *  2. 'offline' is stored; 'running' stays stored and renders ONLINE
 *     (render-only rename, the kW pattern). New units still default 'staged'.
 *  3. Down leaves the quick row and the check form; Flag Issue is the only
 *     down writer. Resolving the last down issue ASKS for the new state
 *     (no preselect — rule 3); setting a state over an open down issue offers
 *     to resolve it. No more stuck-red in either direction.
 *  4. OFFLINE suppresses stale + low-fuel like staged, but re-arms after 14
 *     silent days — cycling is daily-granularity, so a real rotation never
 *     trips it; a forgotten machine degrades from silence to a flag.
 *  5. Report: offline is "switched off on purpose", never a fault, and the
 *     RUNNING OK partition includes teal.
 */
'use strict';
const fs = require('fs');
const path = require('path');
module.exports = (app, t) => {
  let seq = 0;
  const mkU = (o = {}) => Object.assign({ id: 'u-' + (++seq), serial: 'SER' + seq,
    klass: 'big', kw: 625, opStatus: 'running', locationType: 'show',
    locationId: 's1', jobMeta: {}, photos: [], updatedAt: 1 }, o);
  const base = (units, extra = {}) => app.setState(Object.assign({
    settings: { techName: 'Test T.', staleHours: 6, warnHours: 20 },
    shows: [{ id: 's1', name: 'Show' }], units,
    reports: [], issues: [], movements: [], status_events: [] }, extra));
  // ... groups appended by Tasks 2–7 below ...
};
```

(Confirm the harness exposes `settings` through `setState` the way other inv files do — read `tools/fv_inv_alerts.js`'s setup first and copy its working idiom. §9.1 applies to tests too.)

### Task 2: Split state from condition — the undisplaceable badge

**Files:**
- Create: `tools/fv_inv_statusmodel.js` (header above + group below)
- Modify: `index.html` — `:root` color tokens (~:39 dark, ~:52 light), `SC` (~:930), `computeStatus` (~:931–957), `statusPill` (~:980), `statusHex` (~:1190), `engineRow` (~:1550), map popup status line (~:1249)
- Modify: `tools/fv_inv_bigiron.js` (label pins), `tools/fv_inv_status.js` (if label pins trip)

**Step 1 — failing invariants** (append to `fv_inv_statusmodel.js`):

```js
  t.group('badge: state and condition are separate channels — nothing displaces the pill');
  {
    // X5M00213's exact shape: running AND over service.
    base([mkU({ serial: 'X5M00213', currentHours: 3200, serviceDueHours: 3022 })]);
    const cs = app.fn.computeStatus(app.S.units[0]);
    t.eq(cs.label, 'ONLINE', 'running+over-service: pill says ONLINE, not OVER SERVICE');
    t.eq(cs.state, 'running', 'state channel reports the operating state');
    t.eq(cs.color, 'orange', 'condition channel still screams orange (stripe/pin)');
    t.ok(cs.reasons.some(r => /Over service/i.test(r.t)), 'service fact survives in reasons');
    const pill = app.fn.statusPill(cs);
    t.includes(pill, 'ONLINE', 'pill text is the state');
    t.excludes(pill, 'OVER', 'no condition text in the pill, ever');

    base([mkU({ opStatus: 'staged', currentHours: 500, serviceDueHours: 400 })]);
    t.eq(app.fn.computeStatus(app.S.units[0]).label, 'STAGED', 'staged+over-service keeps STAGED');

    base([mkU({ opStatus: 'offline' })]);
    const off = app.fn.computeStatus(app.S.units[0]);
    t.eq(off.label, 'OFFLINE', 'offline is a first-class state');
    t.eq(off.color, 'teal', 'clean offline reads calm (teal), not alarm');

    base([mkU({ opStatus: 'offline', currentHours: 3200, serviceDueHours: 3022 })]);
    const offSvc = app.fn.computeStatus(app.S.units[0]);
    t.eq(offSvc.label, 'OFFLINE', 'offline+over-service: pill holds');
    t.eq(offSvc.color, 'orange', 'condition goes orange — the PM-window signal');

    base([mkU({ opStatus: 'down' })]);
    t.eq(app.fn.computeStatus(app.S.units[0]).label, 'DOWN', 'DOWN is a state and keeps the pill');

    base([mkU({ locationType: 'transit', locationId: null, inTransitToShowId: 's1' })]);
    t.eq(app.fn.computeStatus(app.S.units[0]).label, 'IN TRANSIT', 'transit pill unchanged');
    // Pill colors follow the STATE, not the condition:
    base([mkU({ currentHours: 3200, serviceDueHours: 3022 })]);
    t.includes(app.fn.statusPill(app.fn.computeStatus(app.S.units[0])), 'var(--green)',
      'running-over-service pill is green (state) while the stripe is orange (condition)');
  }
```

**Step 2 — run, expect FAIL** (`cs.label` is `'OVER SERVICE'`, no `state` key, no teal).

**Step 3 — implement** in `index.html`:

1. **Color token.** Add to both theme blocks: dark `:root` (~:39): `--teal:#53a08f;` · light theme block (~:52): `--teal:#1f7d6d;`. Muted, desaturated — reads "deliberate and fine" next to `--green`, nothing like the warning hues. Add to `SC`: `teal:'var(--teal)'`. Add to `statusHex` (~:1190): `teal:'#53a08f'`.

2. **State maps** (above `computeStatus`):
```js
/* Operating state: what the machine IS. The condition (service/fuel/issues)
   colors the stripe and the map pin; it may NEVER displace the state label. */
const STATE_LABEL={running:'ONLINE',offline:'OFFLINE',staged:'STAGED',down:'DOWN',transit:'IN TRANSIT'};
const STATE_COLOR={running:'green',offline:'teal',staged:'grey',down:'red',transit:'blue'};
```

3. **`computeStatus`** — keep the `reasons` construction byte-identical, replace the label chain. The condition color chain preserves today's exact priority (red > orange > yellow > blue > state color); the label becomes state-only:
```js
  /* state channel */
  let state,label;
  if(down){state='down';label=(de.length&&de.length<ENG.length)?(engName(u,de[0]).toUpperCase()+' DOWN'):'DOWN';}
  else if(u.locationType==='transit'){state='transit';label='IN TRANSIT';}
  else if(st==='running'){state='running';label='ONLINE';}
  else if(st==='offline'){state='offline';label='OFFLINE';}
  else{state='staged';label='STAGED';}
  /* condition channel — same priority as the old chain, minus the label coupling */
  let color;
  if(down)color='red';
  else if(sv.state==='over'||maint||low||sv.state==='soon')color='orange';
  else if(cosm)color='yellow';
  else color=STATE_COLOR[state];
  return{color,state,label,stateColor:STATE_COLOR[state],reasons};
```
(Note `NEEDS SERVICE`/`LOW FUEL`/`SERVICE SOON`/`COSMETIC` stop existing as pill labels; their facts live in `reasons` — rendered on the unit-detail stathead — and in Task 3's metaline chip. Transit keeps its today-quirk: an over-service transit unit is orange.)

4. **`statusPill`** (~:980): `return `<span class="pill" style="background:${SC[cs.stateColor]}">${cs.label}</span>`;` (the yellow-text special case dies — stateColor is never yellow).

5. **`engineRow`** (~:1550): `const col=...` gains offline: `st==='down'?'var(--red)':(st==='running'?'var(--green)':(st==='offline'?'var(--teal)':'var(--grey)'))`; `const word=st?(STATE_LABEL[st]||st.toUpperCase()):'NOT YET CHECKED';`

6. **Map popup status line** (~:1249): the dot + word currently use `computeStatus(u).color/.label`. Change the DOT to `statusHex(computeStatus(u).stateColor)` so dot and word agree (both state); **the pin itself (~:1266) stays on `.color`** — orange pins still mean trouble from across the site.

7. `renderUnit` stathead (~:1561) needs no edit — it reads `cs.label` (now the state) over `SC[cs.color]` background (still the condition), and `cs.reasons` chips carry the service/fuel facts. Verify, don't assume.

**Step 4 — amend the deliberate pins, run suite until green:**
- `tools/fv_inv_bigiron.js` ~:92/:103/:105 — `'RUNNING'` → `'ONLINE'` (update the "byte-identical" comments: identical except the 2026-10-09 render-only rename). `:106 'STAGED'`, `:111–114 'GEN B DOWN'` family, `:213`, `:276` — unchanged, should still pass.
- `tools/fv_inv_status.js` ~:111 `'GEN B DOWN'` — unchanged.
- Run full suite; fix ONLY label-rename fallout. Any other failure is a real regression — stop and investigate (superpowers:systematic-debugging), don't bend the assertion.

**Step 5 — commit:**
```bash
python3 tools/fv_deploy.py preflight -m "status-offline task 2: state/condition split"
git add index.html tools/fv_inv_statusmodel.js tools/fv_inv_bigiron.js
git commit -m "status: pill shows operating state (ONLINE/OFFLINE/STAGED/DOWN), condition keeps the stripe — badge undisplaceable"
```
(If `tools/fv_inv_status.js` needed amending, stage it too — by name.)

### Task 3: Service fact back on the card — metaline fallback chip

**Files:**
- Modify: `index.html` — new `svcChip(u)` next to `runwayChip` (~:1055), `unitCard` metaline (~:1080), fleet-card row (~:1176–1178)
- Modify: `tools/fv_inv_statusmodel.js` (append group)

The 🔧 runway chip already carries service when provable (fresh post-arrival reading). When it can't render but `serviceState` (currentHours-based) says over/soon, the card must still say so — previously the pill did; now a chip does.

**Step 1 — failing invariants:**

```js
  t.group('service fact never leaves the card: runway chip OR fallback chip, exactly one');
  {
    // Over service, no fresh post-arrival reading => runway chip absent => fallback renders.
    base([mkU({ currentHours: 3200, serviceDueHours: 3022 })]);
    const u = app.S.units[0];
    t.eq(app.fn.svcRunway(u), null, 'control: no runway (no arrival movement + reading)');
    const card = app.fn.unitCard(u, 's1');
    t.includes(card, 'OVER SERVICE', 'fallback chip carries the fact the pill used to');
    t.ok(/chip bad[^>]*>🔧 OVER SERVICE/.test(card), 'and it is a red chip, not the pill');
    t.includes(card, 'ONLINE', 'pill untouched beside it');
    // With a provable runway the fallback must NOT duplicate:
    const arr = Date.now() - 3 * 86400e3;
    base([mkU({ serial: 'RW1', currentHours: 3200, serviceDueHours: 3022 })], {
      movements: [{ id: 'm1', unitId: app.S ? 'u-0' : '', }] });
    // Build the real fixture from fv_inv_svcrunway.js's arrival+reading idiom —
    // copy its working shape; assert: card contains '🔧' once and 'OVER' once.
  }
```
(The second half MUST reuse `fv_inv_svcrunway.js`'s proven fixture for an arrival movement + fresh reading — read that file and lift its setup verbatim rather than inventing one.)

**Step 2 — FAIL.** `OVER SERVICE` appears nowhere on the card.

**Step 3 — implement.** New helper under `runwayChip`:
```js
/* Fallback when the runway chip can't render (no fresh post-arrival reading)
   but serviceState (currentHours) says over/soon: the fact used to ride the
   pill; the pill is state-only now, so it rides a chip. Alerts stay
   currentHours-based (bias-to-flagging) — this is the same signal, on-card. */
function svcChip(u){const sv=serviceState(u);
  const tag=isTwin(u)?(function(){const e=worstServiceEngine(u).engine;return e?(engName(u,e)+' '):'';})():'';
  if(sv.state==='over')return '<span class="chip bad">🔧 '+esc(tag)+'OVER SERVICE</span>';
  if(sv.state==='soon')return '<span class="chip warn">🔧 '+esc(tag)+sv.remaining+' h to service</span>';
  return '';}
```
- `unitCard` metaline: `${runwayChip(u)}` → `${runwayChip(u)||svcChip(u)}`.
- Fleet card (~:1176): today its metaline renders only for twins. Change the trailing template so the metaline renders when `isTwin(u) || svcChip(u)` is truthy, containing the twin chips as today plus `svcChip(u)`. (The fleet card previously showed OVER SERVICE in its pill; without this it loses the fact entirely. `svc-runway`'s "fleet card deliberately unchanged" ruling was about the RUNWAY chip — `svcChip` is the pill's relocated text, not a runway import.)

**Step 4 — suite green. Step 5 — commit** (`index.html`, `tools/fv_inv_statusmodel.js`).

### Task 4: OFFLINE becomes a state — quick row, check form, twin aggregation

**Files:**
- Modify: `index.html` — `STATUS_OPTS` + `statusSeg` (~:909–911), check-form status segment inside `logVitals`'s sheet markup (~:1789), `vseg` (~:1811), `chassisStatus` (~:880), elecOff copy
- Modify: `tools/fv_inv_statusmodel.js`, amend `tools/fv_inv_status.js` (statusSeg pins ~:85–94)

**Step 1 — failing invariants:**

```js
  t.group('quick row: STAGED / ONLINE / OFFLINE — down is not a button anywhere');
  {
    base([mkU({})]);
    const seg = app.fn.statusSeg(app.S.units[0], null);
    t.includes(seg, 'data-v="offline"', 'offline button exists');
    t.includes(seg, '>Online<', 'running renders as Online');
    t.excludes(seg, 'data-v="down"', 'down is not a quick state');
    // A down unit: no button selected, and the row says why.
    base([mkU({ opStatus: 'down' })]);
    const dseg = app.fn.statusSeg(app.S.units[0], null);
    t.excludes(dseg.replace(/style="[^"]*"/g, ''), 'class="on"', 'down preselects nothing');
    t.includes(dseg, 'DOWN', 'the down banner names the state');
    t.includes(dseg, 'resolve', 'and points at the recovery path');
  }
  t.group('check form: segment matches the quick row; offline collapses electricals');
  {
    // Lift fv_inv_checkform.js's working logVitals/sheet-capture idiom for this.
    // Assert: form HTML has data-v="offline", no data-v="down";
    // setting vsegVal 'offline' => vsegElec hides #v_elec (same as staged);
    // a currently-down unit's form shows the down note and preselects nothing.
  }
  t.group('twin aggregation: offline sits between running and staged');
  {
    const twin = (a, b) => { base([mkU({ engines: { style: 'AB',
      A: { kvaEach: 500, opStatus: a }, B: { kvaEach: 500, opStatus: b } } })]);
      return app.fn.computeStatus(app.S.units[0]); };
    t.eq(twin('running', 'offline').label, 'ONLINE', 'one engine running => trailer ONLINE (rotation is normal)');
    t.eq(twin('offline', 'offline').label, 'OFFLINE', 'both deliberately off => OFFLINE');
    t.eq(twin('offline', 'staged').label, 'OFFLINE', 'a deliberate act outranks the default state');
    t.eq(twin('offline', 'down').label, 'GEN B DOWN', 'down still outranks everything');
  }
```

**Step 2 — FAIL. Step 3 — implement:**

1. `STATUS_OPTS` (~:909): `[['staged','Staged','var(--grey)'],['running','Online','var(--green)'],['offline','Offline','var(--teal)']]` — lifecycle order, Andy's wording. (Stored values unchanged + `'offline'`; new-unit default stays `'staged'` — §8 rule 3 untouched.)
2. `statusSeg` (~:910): when `cur==='down'`, prepend a banner before the segwrap:
```js
const downNote=cur==='down'?`<div class="uloc bad" style="margin:0 0 7px">${IC.warn}<span>DOWN — resolve its issue (Issues tab) to bring it back</span></div>`:'';
```
and return `downNote + segwrap`. With `cur==='down'` no button matches, so nothing preselects — correct: the three buttons are where the unit GOES, the banner is where it IS.
3. Check form segment (inside `logVitals`'s sheet template, ~:1789): replace the three buttons `Running/Staged/Down` with `Staged/Online/Offline` (same `data-v` scheme: `staged`/`running`/`offline`; on-state colors grey/green/teal). When `_st==='down'`: no button gets `class="on"`, and add under the segment's helper line: `<p class="muted" style="font-size:11px;margin:-2px 0 8px">Currently DOWN — the unit stays down until its issue is resolved on the Issues tab.</p>`. Keep the existing "Starts on this unit's current status." helper.
4. `vseg` (~:1811): color map drops the down case, adds `b.dataset.v==='offline'?'var(--teal)'`.
5. `vsegElec` (~:1816): **no change** — `run = vsegVal==='running'` already collapses offline. Update the `#v_elecOff` copy (~:1789): "…Flip Status to **Online** to record them."
6. `chassisStatus` (~:880): insert `if(sts.indexOf('offline')>=0)return 'offline';` between the `running` and `maintenance` lines. Update the comment block above it (offline = deliberate rest; one engine running still means the trailer is ONLINE).
7. `saveVitals`'s status write (~:1922) and `setStatus` need no structural change here (Task 5 touches `setStatus` for coupling) — `'offline'` flows through the existing event + opStatus write and `MAPS.status_events` already maps `status`.

**Step 4 — amend pins:** `tools/fv_inv_status.js` ~:85–94 renders `statusSeg` for down/staged units — update expectations to the new three-button row + down banner (keep the spirit: the control starts on the current status, a default is never a claim). Run full suite; `fv_inv_checkform.js`'s "segment leads" group (~:87–102) pins ordering (`v_seg` before `v_ll`), which survives — verify.

**Step 5 — commit** (`index.html`, `tools/fv_inv_statusmodel.js`, `tools/fv_inv_status.js`).

### Task 5: Alert gating — free suppression + the 14-day re-arm

**Files:**
- Modify: `index.html` — `owesCheck` (~:812), new helpers near it, `computeStatus` reasons
- Modify: `tools/fv_inv_statusmodel.js`; possibly `tools/fv_inv_alerts.js` (additive group only)

**Step 1 — failing invariants:**

```js
  t.group('offline alerts: suppressed like staged, re-armed after 14 silent days');
  {
    const DAY = 86400e3;
    const offU = (daysAgo, extra = {}) => {
      base([mkU(Object.assign({ opStatus: 'offline' }, extra))], {
        status_events: [{ id: 'se1', unitId: 'u-' + seq, engine: null,
          status: 'offline', techName: 'Travis P.', timestamp: Date.now() - daysAgo * DAY }] });
      return app.S.units[0]; };
    t.eq(app.fn.owesCheck(offU(1), null), false, 'offline 1d: no nag (the AQHC rotation)');
    t.eq(app.fn.owesCheck(offU(13), null), false, 'offline 13d: still quiet');
    t.eq(app.fn.owesCheck(offU(15), null), true, 're-arm: 15 silent days => owes a confirm');
    t.eq(app.fn.lowFuel(Object.assign(offU(1), /* give it 10% fuel via a report */ {})), false,
      'low fuel on a deliberately-off machine is not news');
    // a fresh check resets the re-arm clock:
    const u15 = offU(15);
    app.S.reports.push({ id: 'r9', unitId: u15.id, timestamp: Date.now() - 1 * DAY, techName: 'T' });
    t.eq(app.fn.owesCheck(u15, null), false, 'any check resets the 14d clock');
    // and the card says why it surfaced:
    const uOver = offU(15);
    t.ok(app.fn.computeStatus(uOver).reasons.some(r => /offline 15d/.test(r.t)),
      'reason chip: "offline 15d — confirm it\'s deliberate"');
    // staged behavior is UNTOUCHED (never re-arms):
    base([mkU({ opStatus: 'staged' })]);
    t.eq(app.fn.owesCheck(app.S.units[0], null), false, 'staged never nags — status quo holds');
  }
```
(Fix up the fixture plumbing against the real harness — `lowFuel` needs a fuel report, lift the `fuel()` helper idiom from `tools/fv_inv_alerts.js` ~:30–46.)

**Step 2 — FAIL** (`owesCheck` returns false for offline at any age; no reason chip).

**Step 3 — implement** in `index.html`, next to `owesCheck`:

```js
/* OFFLINE and the clock (2026-10-09): a deliberately-off machine suppresses
   the 6h stale nag and low-fuel exactly like staged — eight cycling main-stage
   units must not nag every night. But silence must not be forever: after 14
   days with no check and no fresh offline tap, it surfaces in Overdue as a
   confirm. Cycling is daily-granularity (live data: median 24h parked), so a
   real rotation never trips this; a forgotten machine degrades from silence
   to a flag. Evidence resets the clock; absence escalates — bias-to-flagging
   shaped. Staged keeps its never-nags behavior unchanged. */
const OFFLINE_REARM_MS=14*24*3600e3;
function offlineAnchor(u,e){
  const ev=(S.status_events||[]).filter(x=>x.unitId===u.id&&(e?x.engine===e:true)&&x.status==='offline')
    .reduce((m,x)=>Math.max(m,x.timestamp||0),0);
  const t=e?engLastTs(u,e):lastCheckTs(u);
  return Math.max(ev,t||0)||null;}
function offlineConfirmDays(u,e){const st=e?engStatus(u,e):((u&&u.opStatus)||'staged');
  if(st!=='offline'||!onJob(u)||showClosed(u.locationId))return null;
  const a=offlineAnchor(u,e);if(!a)return null;
  const d=Math.floor((now()-a)/86400e3);return d>=14?d:null;}
```
`owesCheck`: after the `showClosed` guard, replace the single `if(st!=='running')return false;` with:
```js
  if(st==='offline')return offlineConfirmDays(u,e)!=null;
  if(st!=='running')return false;
```
`lowFuel` needs **no edit** — `chassisStatus(u)==='running'` already excludes offline (assert it anyway, above).
`computeStatus` reasons — after the `low` push:
```js
  engList(u).forEach(e=>{const d=offlineConfirmDays(u,e);
    if(d!=null)reasons.push({t:(e?engName(u,e)+' ':'')+'offline '+d+'d — confirm it’s deliberate',cls:'warn'});});
```
This makes the re-armed unit visible in three existing surfaces for free: the Alerts "Overdue for a check" section (via `isStale`→`owesCheck`), the card's stale ⚠ fresh-chip, and the unit-detail reasons chips. No new alert section.

**Step 4 — full suite.** `tools/fv_inv_alerts.js`'s existing staged/down suppression pins must pass untouched — they're the control group. **Step 5 — commit** (`index.html`, `tools/fv_inv_statusmodel.js`).

### Task 6: Down behind Flag Issue — close the stuck-red loop both ways

**Files:**
- Modify: `index.html` — `setStatus` (~:913), `toggleIssue` (~:1656), two new HTML builders
- Modify: `tools/fv_inv_statusmodel.js`

Both builders are named functions returning HTML (the `pinPopupHtml` testability pattern); the sheet calls wrap them.

**Step 1 — failing invariants:**

```js
  t.group('coming back up: resolving the last down issue asks for the new state');
  {
    base([mkU({ opStatus: 'down' })], { issues: [{ id: 'i1', unitId: 'u-' + seq,
      severity: 'down', title: 'Coolant leak', resolved: false, engine: null,
      techName: 'T', timestamp: 1 }] });
    const h = app.fn.backUpAskHtml(app.S.units[0], null);
    ['staged', 'running', 'offline'].forEach(v =>
      t.includes(h, `'${v}'`, 'offers ' + v));
    t.excludes(h.replace(/style="[^"]*"/g, ''), 'class="on"',
      'NO preselect — restored health must be claimed by a human (rule 3)');
    t.includes(h, 'Still down', 'an honest escape hatch: leave it down');
    // the wiring: toggleIssue on the last down issue (status down) must route
    // to the ask, not silently leave the unit red — assert via the seam the
    // implementation exposes (see Step 3), not by scraping the live sheet.
  }
  t.group('going around an open down issue: the tap offers to resolve it');
  {
    base([mkU({ opStatus: 'down' })], { issues: [{ id: 'i1', unitId: 'u-' + seq,
      severity: 'down', title: 'Coolant leak', resolved: false, engine: null,
      techName: 'T', timestamp: 1 }] });
    const h = app.fn.statusVsIssuesHtml(app.S.units[0], null, 'running',
      app.fn.openIssuesFor(app.S.units[0].id));
    t.includes(h, 'Coolant leak', 'names the issue in the way');
    t.includes(h, 'Resolve', 'offers resolve-and-set');
    t.includes(h, 'keep', 'offers set-but-keep-open (never blocked)');
    // and the no-issue path is untouched: setStatus with no open down issue
    // writes the event directly (assert S.status_events grows by one).
  }
```

**Step 2 — FAIL** (functions don't exist).

**Step 3 — implement.**

```js
/* ===== DOWN COUPLING (2026-10-09) =====
   Down has ONE writer — Flag Issue → Hard down (saveIssue, unchanged). The two
   stuck states this closes: (a) Resolve flipped only the boolean, so a fixed
   machine stayed red forever; (b) flipping status under an open down issue
   left the card red with no explanation. Recovery asks, never assumes:
   restored health is an observation, so nothing preselects (rule 3). */
function backUpAskHtml(u,e){
  const who=e?(' · '+engName(u,e)):'';
  return `<p style="margin-top:0">Issue resolved. Where does this leave <b>#${esc(u.serial||u.tagId)}</b>${esc(who)}?</p>
  <p class="muted" style="font-size:12px;margin:0 0 12px">Resolving the issue doesn't flip the status — say what the machine is doing now.</p>
  <div class="segwrap" style="margin:0 0 12px">${STATUS_OPTS.map(([v,l])=>`<button type="button" data-v="${v}" onclick="setStatus('${u.id}','${e||''}','${v}')">${l}</button>`).join('')}</div>
  <button class="btn ghost block" onclick="renderUnit('${u.id}')">Still down — leave it</button>`;}
function statusVsIssuesHtml(u,e,st,dIss){
  const l=STATUS_OPTS.find(x=>x[0]===st);const word=l?l[1]:st;
  return `<p style="margin-top:0"><b>${esc(dIss[0].title||'A down issue')}</b>${dIss.length>1?(' and '+(dIss.length-1)+' more'):''} is still open — it keeps this unit red whatever the status says.</p>
  <button class="btn primary block" onclick="setStatus('${u.id}','${e||''}','${st}',true)">Resolve it &amp; set ${esc(word)}</button>
  <button class="btn dark block" style="margin-top:9px" onclick="setStatus('${u.id}','${e||''}','${st}',false)">Set ${esc(word)}, keep the issue open</button>
  <button class="btn ghost block" style="margin-top:9px" onclick="renderUnit('${u.id}')">Cancel</button>`;}
```

`setStatus` gains a 4th arg and the routing (keep the existing body as the core):
```js
function setStatus(unitId,eng,st,alsoResolve){const u=unitById(unitId);if(!u)return;const e=(eng&&isTwin(u))?eng:null;
  const cur=e?engStatus(u,e):((u&&u.opStatus)||'staged');
  if(cur===st)return;
  const dIss=openIssuesFor(unitId).filter(i=>i.severity==='down'&&(e?i.engine===e:true));
  if(st!=='down'&&dIss.length&&alsoResolve===undefined){
    sheet('Open down issue',statusVsIssuesHtml(u,e,st,dIss));return;}
  requireTech(()=>{
    if(alsoResolve)dIss.forEach(i=>{i.resolved=true;});
    /* ...existing event push + opStatus/engines write + save() + renderUnit... */
  });}
```
`toggleIssue` (~:1656):
```js
function toggleIssue(iid,u_){const i=S.issues.find(x=>x.id===iid);if(!i)return;
  i.resolved=!i.resolved;save();
  const u=unitById(i.unitId);
  if(i.resolved&&i.severity==='down'&&u){
    const e=(i.engine&&isTwin(u))?i.engine:null;
    const still=openIssuesFor(u.id).some(x=>x.severity==='down'&&(e?x.engine===e:true));
    const cur=e?engStatus(u,e):((u.opStatus)||'staged');
    if(!still&&cur==='down'){sheet('Back in service?',backUpAskHtml(u,e));return;}}
  renderUnit(u_);}
```
Notes: `setStatus` already calls `renderUnit`, which reopens the unit sheet over the ask — the flow closes itself. `saveIssue`'s down write is untouched. Reopen (`resolved→false`) takes the early `renderUnit` path — no ask. The `(e? i.engine===e : true)` lane filter means a chassis-level resolve on a twin only fires when the chassis itself is down — verify against a twin fixture.

**Step 4 — suite (add a direct-path assertion: `setStatus` with no open down issue still writes exactly one event). Step 5 — commit** (`index.html`, `tools/fv_inv_statusmodel.js`).

### Task 7: Report — an ops reader can't mistake offline for a problem

**Files:**
- Modify: `index.html` — `buildReportText` (~:1344–1364)
- Modify: `tools/fv_inv_statusmodel.js`; amend `tools/fv_inv_report.js` only if its partition pins trip

**Step 1 — failing invariants:**

```js
  t.group('report: offline is deliberate, in RUNNING OK, in plain words');
  {
    // one running, one clean offline, one offline+over-service
    base([ mkU({ serial: 'RUN1' }),
      mkU({ serial: 'OFF1', opStatus: 'offline' }),
      mkU({ serial: 'OFF2', opStatus: 'offline', currentHours: 3200, serviceDueHours: 3022 }) ]);
    const R = app.fn.buildReportText('s1');
    t.includes(R, '== RUNNING OK (2) ==', 'clean offline counts in RUNNING OK');
    t.includes(R, '#RUN1', 'running serial listed');
    t.ok(/Switched off on purpose \(generator rotation — not a fault\): #OFF1/.test(R),
      'offline named in words an outsider cannot read as a failure');
    t.ok(R.indexOf('#OFF1') > R.indexOf('== RUNNING OK'), 'offline line lives inside RUNNING OK');
    // over-service offline still escalates to the service section, honestly:
    t.ok(R.indexOf('#OFF2') > R.indexOf('== NEEDS / OVER SERVICE')
      && R.indexOf('#OFF2') < R.indexOf('== COSMETIC'), 'offline+over-service sits in NEEDS/OVER');
    t.includes(R, 'OFFLINE (deliberate)', 'its detail line says deliberate');
  }
```

**Step 2 — FAIL** (teal units fall out of every section — the partition breaks).

**Step 3 — implement** in `buildReportText`:
- `dline`: `const parts=[cs.state==='offline'?'OFFLINE (deliberate)':cs.label];` (rest unchanged — service wording still appends, which is exactly right for the PM-window case).
- OK partition: `['green','grey','blue','yellow']` → `['green','grey','blue','yellow','teal']`, then split the entries:
```js
  const ok=units.filter(u=>['green','grey','blue','yellow','teal'].includes(col(u)));
  const okOff=ok.filter(u=>computeStatus(u).state==='offline');
  const okRun=ok.filter(u=>computeStatus(u).state!=='offline');
  const okEntries=[];
  if(okRun.length)okEntries.push([okRun.map(u=>'#'+(u.serial||u.tagId)).join(', ')]);
  if(okOff.length)okEntries.push(['Switched off on purpose (generator rotation — not a fault): '
    +okOff.map(u=>'#'+(u.serial||u.tagId)).join(', ')]);
  pushSec('RUNNING OK',ok.length,okEntries);
```
The three unit sections still partition the fleet (fv_inv_report contract 2); COSMETIC still counts items.

**Step 4 — full suite; amend `fv_inv_report.js` only for assertions that pinned the old single-line OK entry, keeping its partition contracts intact. Step 5 — commit** (`index.html`, `tools/fv_inv_statusmodel.js`, plus `tools/fv_inv_report.js` if touched).

### Task 8: Archive dictionary — name the vocabulary for next season's reader

**Files:**
- Modify: `tools/fv_archive.js` — `dictionaryMd` (~:693)

Text-only. In the dictionary's status section (find where `op_status` / `status_events` are described), add:

> `op_status` / `status_events.status` values: `running` · `staged` · `offline` · `down`. `running` displays as **ONLINE** in the app (render-only rename, 2026-10-09). `offline` (added 2026-10-09) = in place, cabled, **deliberately shut off** — generator rotation / PM window, not a fault and not "never commissioned" (that's `staged`). Rows before 2026-10-09 could not say `offline`; cycling crews logged it as `staged`, so pre-cutover staged↔running flip-flops on big iron are rotation, not churn (166 such transitions as of the cutover, median 24 h parked).

No invariant (archive tooling has no inv file; it needs live creds). Run `node -e "require('./tools/fv_archive.js')"`-style syntax check only: `node --check tools/fv_archive.js`.

**Commit** (`tools/fv_archive.js`).

### Task 9: HANDOFF + marker + the full gate

**Files:**
- Modify: `HANDOFF.md` — §3 (two new entries), §4 (`opStatus` row), §5 (status colours), §8 untouched
- Modify: `index.html:13` (marker)

1. **§4 table row:** `opStatus` → `'staged' | 'running' | 'offline' | 'down'`. **New units default `staged`.** `running` renders ONLINE; `offline` = deliberately shut off (rotation/PM); `down` is written only by Flag Issue.
2. **§5 status colours line:** `green = online · teal = offline (deliberate) · yellow = cosmetic · orange = service/fuel · red = down · grey = staged · blue = transit`. Note the split: **pill = operating state, stripe/pin = worst condition.**
3. **§3 entries** (house style — decision + mechanism + invariant home + suite count), one per build:
   - `card-icon-size` — the unsized-icon fix + the IC width/height invariant (`tools/fv_inv_icons.js`).
   - `status-offline` — the data verdict (166 flips, 115 round-trips, median 24/25 h — plant rotation on big iron), the state/condition split (**the badge is undisplaceable — pinned**), OFFLINE semantics + teal, the svcChip fallback, alert suppression + 14-day re-arm, the down coupling (backUpAsk / statusVsIssues), report wording, **no data migration by decision** (history is append-only truth; AQHC/Head Trip converge naturally), `fv_inv_statusmodel.js`, new suite count.
4. Bump marker: `<!-- fleetview build 2026-10-09 status-offline -->`.
5. **Manual sweep** (§9.6 — the suite doesn't render these): job detail + Fleet + Alerts + map popup on empty/populated/edge; the check form on a running, offline, and down unit; the two new sheets (resolve-ask, status-vs-issue) in the harness or browser; hostile strings through `backUpAskHtml` (issue title with quotes/emoji — it's `esc()`d, prove it).
6. Full preflight: `python3 tools/fv_deploy.py preflight -m "status-offline"` — expect `RESULT: PASS` with the grown count.

**Commit** (`HANDOFF.md`, `index.html`).

### Task 10: STOP

Report to Andy: suite count before/after, the commits on `main` ready to push, what the manual sweep showed, and the one-line field note for the crews ("Staged / Online / Offline — Offline is cycling; Down now lives behind Flag Issue, and resolving the issue asks where the machine lands"). **Do not push.** After Andy's push: `python3 tools/fv_deploy.py verify`, then update HANDOFF "built" → "shipped" phrasing if he wants it, and the memory file.

---

## Known edges, decided here so the executor doesn't improvise

- **`maintenance` in `chassisStatus`/`computeStatus`** is a dead legacy value (0 events in production) — leave the branches in place, out of scope.
- **Offline anchor with no event** (can't occur organically — offline only arrives by tap): `offlineAnchor` returns null → no re-arm. Conservative-silent, documented in the code comment.
- **Transit + over-service** stays orange (today's behavior, preserved deliberately).
- **The 20 imported-down unassigned units** (§3 close-out doctrine) are untouched: `saveIssue` still writes down, `computeStatus` still reds them, and none of them have down *issues*, so the resolve-ask never fires on them. They clear exactly as before.
- **`statusHex` teal** must match the dark-theme `--teal` (map pins don't read CSS vars).
- **LIVE_BINDINGS:** this build adds no new mutable top-level bindings (constants + functions only). If the executor finds they need one, register it in `fv_harness.js` or `app.live.X` reads undefined.
