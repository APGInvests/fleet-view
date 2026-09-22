# Twin Sizing in Big Iron — kW Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Big iron speaks per-engine kW everywhere crews read a size — "500 kW" singles, "Twin 400 kW" twins — matching the NES, with NES-ordered sorting, size-aware search, a derived spec block on the Info tab, four data corrections, and two NES twins added to the fleet. Small iron unchanged. Storage stays kVA.

**Architecture:** Pure render-layer conversion (kW = stored kVA × 0.8), same doctrine as fuel-inches: storage untouched, labels convert, logic never does. One new choke point `sizeText(u)` feeds every size surface (card titles, fleet card, add-sheet cards, search haystacks); `sizeLabel(u)` becomes `sizeText || make/model fallback`. Twin identity comes ONLY from `isTwin(u)` (`engines` jsonb present) — never `config` (§7 trap). Load % method is deliberately untouched (Andy decision 2026-09-22).

**Tech Stack:** Vanilla JS in `index.html` (no build step), `tools/fv_smoke.js` invariant harness, Supabase SQL for data fixes (Andy-gated).

**Settled decisions (Andy, 2026-09-22) — do not re-open:**
1. kW display for BIG IRON only; small iron stays kVA exactly as today. Every size label always shows its unit. Storage stays kVA everywhere.
2. Load % method unchanged (per-engine kW ÷ rated kW). Amps-based load NOT in this build; park "highest leg % of rated amps" as a possible future secondary warning in HANDOFF.
3. Sort = NES order: per-engine size ascending, single before twin at the same size.
4. "400" finds Twin 400s; "twin" finds twins.
5. Data fixes preview-then-write: TGD 1257→1250 (×3), C5E02263-64 config text, PMC15 kw→null, X5M config clear.
6. Spec block on Info tab: verdict PROPOSE (big iron only) — see Task 7.
7. Add 9NR05394-97 and 9NR05395-96 as 200 kW Twins; exclude the other 11 NES twins, listed in HANDOFF.

**Out of scope, deliberate:** `tools/fv_sitemap.js` and `tools/fv_archive.js` keep kVA (client-sheet conventions + archival fidelity — separate decision). `assetLabel()` stays verbatim (legacy, fv_smoke-pinned, zero production callers). `calcLoad()` copy unchanged (already leads with kW; the kVA parenthetical is the derivation, not a card). Map popup and end-of-show report show no size today — untouched.

---

## Reference: current code facts (verified 2026-09-22)

| Thing | Where | Today |
|---|---|---|
| `sizeLabel(u)` | index.html:949 | `u.kw+' kVA'` else make/model else 'Asset' |
| Card title | index.html:959 | `sizeLabel(u) + ' · ' + jobLabel` |
| Fleet card size | index.html:1049 | `${esc(u.kw)} kVA` right-aligned mono |
| Sort | `byKva()` index.html:987 | `u.kw` asc, red-down-last, jobLabel/serial tiebreak |
| Job search | index.html:1019 | haystack incl. `u.kw+' kva'` |
| Fleet search | index.html:1044 | tagId/serial/make/model ONLY (no size) |
| Add-sheet search | index.html:1235 | haystack incl. `u.kw+' kva'`; cards at 1226/1234 show `· N kVA` |
| Info tab Rating | `paneInfo()` index.html:1471 | `N kVA` kv row |
| Edit form | index.html:1505/1510 | "Rating (kVA)" input `f_kw`; twin nameplate `f_kvaA/B` |
| Twin detection | `isTwin(u)` index.html:807 | `engines` jsonb present |
| `engMeta(u,e)` | index.html:~810 | per-engine jsonb accessor |
| Load % | `engKva` 817 / `saveVitals` 1694 / `derivedLoadPct` 1390 | per-engine, correct, **DO NOT TOUCH** |
| Invariant pins to amend | `tools/fv_inv_fleetcard.js:40` | fixtures are `klass:'big'`, pin `'625 kVA'` → will change to `'500 kW'` |
| Invariant pins that stand | `tools/fv_inv_joblabel.js` | fixtures are `klass:'small'` — `'150 kVA'` titles remain correct, no edits |
| Suite size | preflight | 1319 as of build `add-sheet-trim` |

Live data (all verified): 50 twins with `engines`, all kvaEach = NES per-engine kW ÷ 0.8; `kw` = combined kVA. Exceptions → Task 9 data fixes. No 9NR serials exist anywhere in `units` (checked serial + tag_id).

Harness notes: function declarations attach to global — new fns need no LIVE_BINDINGS entry (that's only for mutable `let` bindings). Tests access via `app.fn.sizeLabel` like fv_inv_joblabel.js does.

---

### Task 1: `sizeText` / `sizeLabel` — failing tests first

**Files:**
- Create: `tools/fv_inv_twinsize.js`
- Modify (later task): `index.html:949`

**Step 1: Write the failing test group** (copy the file skeleton/`t.group` idiom from `tools/fv_inv_joblabel.js`, including its `mkUnit` fixture builder):

```js
/* tools/fv_inv_twinsize.js — twin-size-kw build (2026-09-22)
 * Big iron speaks per-engine kW ("500 kW", "Twin 400 kW") matching the NES;
 * small iron stays kVA; storage stays kVA; twin status from engines only. */
module.exports = function (t, app) {
  const id = (p) => p + Math.random().toString(36).slice(2, 8);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    make: 'CAT', model: '', kw: 625, engines: null, opStatus: 'staged',
    locationType: 'fleet', locationId: null, jobMeta: {}, photos: [] }, o);
  const twin = (per, o = {}) => mkUnit(Object.assign(
    { kw: per * 2, engines: { A: { kvaEach: per }, B: { kvaEach: per } } }, o));

  t.group('size labels: big iron speaks kW, per engine on twins');
  t.eq(app.fn.sizeText(mkUnit()), '500 kW', 'big single 625 kVA -> 500 kW');
  t.eq(app.fn.sizeText(twin(500)), 'Twin 400 kW', 'twin kvaEach 500 -> Twin 400 kW');
  t.eq(app.fn.sizeText(twin(375)), 'Twin 300 kW', 'twin kvaEach 375 -> Twin 300 kW');
  t.eq(app.fn.sizeText(mkUnit({ kw: 1000, engines: { A: {}, B: {} } })), 'Twin 400 kW',
    'kvaEach unset -> per-engine from kw/2 (binding-pass stragglers still read right)');
  t.eq(app.fn.sizeText(mkUnit({ klass: 'small', kw: 150 })), '150 kVA', 'small iron stays kVA');
  t.eq(app.fn.sizeText(mkUnit({ config: 'TwinPak', kw: 625 })), '500 kW',
    'config string is NEVER twin evidence (X5M stragglers read as singles)');
  t.eq(app.fn.sizeText(mkUnit({ kw: null })), null, 'no rating -> null, never "0 kW"/"NaN"');
  t.eq(app.fn.sizeText(mkUnit({ klass: 'small', kw: null })), null, 'small no rating -> null');
  t.eq(app.fn.sizeLabel(mkUnit({ kw: null, make: 'CAT', model: 'XQ-500' })), 'CAT XQ-500',
    'sizeLabel falls back to make/model when no rating');
  t.eq(app.fn.sizeText(mkUnit({ kw: 1257 })), '1006 kW',
    'odd stored value renders honestly (integer kW), never crashes');
  t.includes(app.fn.sizeText(twin(250)), 'Twin 200 kW', 'the two new 9NR 200 kW Twins');
};
```

**Step 2: Run to verify it fails**

Run: `node tools/fv_smoke.js index.html tools/fv_inv_twinsize.js`
Expected: FAIL — `app.fn.sizeText` undefined.

**Step 3: Implement.** Replace `index.html:949` (`sizeLabel`) with:

```js
/* Big iron speaks per-engine kW — "Twin 400", never "1000 kVA" — matching the
   NES and crew vocabulary (Andy, 2026-09-22). Storage stays kVA (units.kw,
   engines[e].kvaEach); kW exists ONLY here: kW = kVA × 0.8. Small iron keeps
   kVA. Twin status from isTwin() — the config string is never evidence (§7). */
function twinPerKva(u){const a=parseFloat(engMeta(u,'A').kvaEach),b=parseFloat(engMeta(u,'B').kvaEach);
  if(a>0&&b>0&&a===b)return a;const k=parseFloat(u.kw);if(k>0)return k/2;return a>0?a:(b>0?b:null);}
function kvaKw(v){const n=parseFloat(v);return (n>0)?Math.round(n*0.8):null;}
function sizeText(u){if(!u)return null;
  if(u.klass==='big'){
    if(isTwin(u)){const kW=kvaKw(twinPerKva(u));return kW?('Twin '+kW+' kW'):null;}
    const kW=kvaKw(u.kw);return kW?(kW+' kW'):null;}
  return u.kw?(u.kw+' kVA'):null;}
function sizeLabel(u){return sizeText(u)||([u.make,u.model].filter(Boolean).join(' ')||'Asset');}
```

**Step 4: Run to verify pass:** `node tools/fv_smoke.js index.html tools/fv_inv_twinsize.js` → PASS. Then the full suite (`node tools/fv_smoke.js index.html tools/fv_inv_*.js`) — expect **fv_inv_fleetcard failures only** (the '625 kVA' pins — fixed in Task 2; card titles route through sizeLabel automatically). fv_inv_joblabel must stay green (small-iron fixtures).

**Step 5:** No commit yet — repo convention is one build commit at the end (Task 11).

---

### Task 2: Fleet card + add-sheet/near-match cards

**Files:**
- Modify: `index.html:1049` (fleet card), `index.html:1226` (near-match card), `index.html:1234` (add-sheet result card)
- Modify: `tools/fv_inv_fleetcard.js:34-42` group
- Test: extend `tools/fv_inv_twinsize.js`

**Step 1: Failing tests.** In fv_inv_fleetcard.js, update the "kVA renders on its own" group: `'625 kVA'` → `'500 kW'`; excludes `'625 kVA'`, `'null'`, `'NaN kW'`. Add to fv_inv_twinsize.js a rendered-card group: `renderFleet` with one big single (625→'500 kW'), one twin (kvaEach 500→'Twin 400 kW'), one small (150→'150 kVA'), one no-rating big (no size text at all). Also `unitCard` title checks (the size-locked doctrine now in kW for big iron): `<span class="tag">Twin 400 kW · Main Stage</span>` when job-labeled; bare `Twin 400 kW` unlabeled; down variant still leads with size.

**Step 2:** Run — FAIL (cards still render kVA).

**Step 3: Implement.** All three sites swap their inline `u.kw + ' kVA'` for `sizeText(u)`:
- 1049: `${sizeText(u)?`<div style="font-family:var(--mono);font-size:12.5px;font-weight:700;margin-top:5px">${esc(sizeText(u))}</div>`:''}`
- 1226 and 1234: `${sizeText(u)?(' · '+esc(sizeText(u))):''}`

**Step 4:** Re-run twinsize + fleetcard + joblabel groups → PASS.

---

### Task 3: Sort — NES order

**Files:**
- Modify: `index.html:987` (`byKva`)
- Test: extend `tools/fv_inv_twinsize.js`

**Step 1: Failing test.** Fixture list shuffled, assert the exact rendered order of serials (the full-order assertion, per §9.4 — a sort bug once passed every crash check):

```
Expected order (per-engine size asc, single-before-twin, small iron interleaved by value):
small 150 kVA → Twin 300 (375/eng) → 437.5 single → Twin 350 (437.5/eng)
→ 500 single → Twin 400 (500/eng) → 625 single → Twin 500 (625/eng) → 700 single
→ no-rating unit last → red hard-down forced to the very bottom regardless of size
```

Also pin: `kw:''` and `kw:null` sort to bottom (the `Number(null)===0` lesson), and two same-size same-type units still tiebreak by jobLabel/serial.

**Step 2:** Run — FAIL (Twin 300 currently sorts at 750 combined, above 700 singles).

**Step 3: Implement.** In `byKva`, replace the `kv`/`x/y` block, keep the red-down guard first and the jobLabel/serial tiebreak last:

```js
  /* NES order (Andy 2026-09-22): per-engine size ascending, single before twin
     at the same size — 500 single, Twin 400 (500/eng), 625 single, Twin 500.
     Missing/blank ratings sink (Number(null)===0 — never let it read as 0). */
  const sz=u=>{if(isTwin(u)){const v=twinPerKva(u);return (v>0)?v:Infinity;}
    if(u.kw===null||u.kw===undefined||u.kw==='')return Infinity;
    const n=Number(u.kw);return Number.isFinite(n)?n:Infinity;};
  const x=sz(a),y=sz(b);if(x!==y)return x-y;
  const tx=isTwin(a)?1:0,ty=isTwin(b)?1:0;if(tx!==ty)return tx-ty;
```

**Step 4:** Run → PASS. Full suite: fv_inv_joblabel's sort assertion ('25 kVA before 500 kVA', small-iron fixtures) must still pass — per-engine size for non-twins IS kw, so it does.

---

### Task 4: Search — "400" and "twin" find twins

**Files:**
- Modify: `index.html:1019` (job search), `index.html:1044` (fleet search), `index.html:1235` (add-sheet search)
- Test: extend `tools/fv_inv_twinsize.js`

**Step 1: Failing tests.** For each of the three search paths: query `'twin'` matches only twins; `'400'` matches a Twin 400 (kvaEach 500); `'400 kw'` matches; legacy `'1000'` STILL matches that twin (kva token kept — muscle memory from a month of kVA cards); small-iron `'150'` still matches small units. Job search via `jobSearch` + rendered job detail; fleet via `fleetSearch` + `renderFleet`; add-sheet via its search fn.

**Step 2:** Run — FAIL.

**Step 3: Implement.** Add two tokens to each haystack array — `(sizeText(u)||'')` and (fleet search only, which today has no size token at all) also `(u.kw?u.kw+' kva':'')`:
- 1019: `[u.tagId,u.serial,u.make,u.model,jobLabel(u,id),(u.kw?u.kw+' kva':''),(sizeText(u)||'')]`
- 1044: `[u.tagId,u.serial,u.make,u.model,(u.kw?u.kw+' kva':''),(sizeText(u)||'')]`
- 1235: `[u.serial,u.tagId,u.make,u.model,(u.kw?u.kw+' kva':''),(sizeText(u)||'')]`

`sizeText` lowercases to `'twin 400 kw'` through the existing `String(x||'').toLowerCase()` — both words hit.

**Step 4:** Run → PASS.

---

### Task 5: Edit form — kVA input stays, live kW echo (proposal, approved shape)

Storage and input unit both stay kVA: the nameplate the tech is standing at reads kVA, and §8 rule 2 favors typing what the plate says. The kW mental model gets a **live echo line** (the `fuelEcho`/`calcLoad` pattern — readback, never a control).

**Files:**
- Modify: `index.html:1505` (f_kw field), `index.html:1510` (f_kvaA/B pair)
- Test: extend `tools/fv_inv_twinsize.js`

**Step 1: Failing tests.** Big iron edit sheet: typing 625 in `f_kw` renders `= 500 kW` in `#f_kwEcho`; blank → echo hidden; small-iron sheet has NO echo element; twin sheet: typing 500 in both nameplate fields renders `= Twin 400 kW` in `#f_kvaEcho`; **saving an untouched form round-trips `kw` unchanged** (no ×0.8 drift — input never converts).

**Step 2:** Run — FAIL.

**Step 3: Implement.** Under `f_kw` (big iron only): `<div id="f_kwEcho" class="muted" style="font-size:12px;margin:-2px 0 10px;display:none"></div>` + `oninput="kwEcho()"` on the input. Under the f_kvaA/B grid: same-pattern `#f_kvaEcho`. New fns:

```js
function kwEcho(){const el=$('#f_kwEcho');if(!el)return;const v=kvaKw($('#f_kw').value);
  el.style.display=v?'block':'none';el.textContent=v?('= '+v+' kW'):'';}
function kvaEcho(){const el=$('#f_kvaEcho');if(!el)return;const a=kvaKw($('#f_kvaA').value),b=kvaKw($('#f_kvaB').value);
  el.style.display=(a&&b)?'block':'none';el.textContent=(a&&b)?((a===b?('= Twin '+a+' kW'):('= '+a+' kW + '+b+' kW')) ):'';}
```

Call both once on sheet open (after render, like `calcLoad()` is).

**Step 4:** Run → PASS.

---

### Task 6: Spec block on the Info tab — VERDICT: propose, big iron only

**Verdict:** It fits. `paneInfo` is the machine-property surface (the `has_def` precedent), the block is derived-only from stored kVA (zero schema, zero inputs, render-only — can never violate the observation rule), and it answers the real field question ("what breaker/feeder does this carry?") without making kVA a working number on cards. Info tab is the right home — not the check form (observation rule), not the card (friction/noise). Small iron deliberately excluded (decision 1: unchanged).

**Files:**
- Modify: `index.html:1471` (`paneInfo`)
- Test: extend `tools/fv_inv_twinsize.js`

**Step 1: Failing tests.** Big single 625 kVA Info pane includes: `500 kW`, `625 kVA`, `0.8 PF`, `1,735 A @208V`, `752 A @480V`. Twin (kvaEach 500) includes a per-engine line (`400 kW · 500 kVA · 1,388 A @208V · 601 A @480V`) AND a combined line labeled **`Combined (when paralleled)`** (`800 kW · 1,000 kVA · 2,776 A @208V · 1,203 A @480V`). Small-iron pane excludes `@208V` entirely and keeps its plain `150 kVA` Rating row. No-rating big iron: no spec block, no `NaN`. Assert it contains **no `<input`** in the block (never a field).

**Step 2:** Run — FAIL.

**Step 3: Implement.** Rated amps helper + block builder:

```js
/* Rated amps = kVA×1000 / (√3×V). Derived at render from the stored nameplate
   rating — never stored, never an input (a formula fix re-derives everything).
   kVA is labeled as the 0.8 PF rating; techs work in kW and amps. */
function ratedA(kva,v){return Math.round(kva*1000/(Math.sqrt(3)*v));}
function specRow(kva){const kW=Math.round(kva*0.8);
  return kW.toLocaleString()+' kW · '+kva.toLocaleString()+' kVA · '+ratedA(kva,208).toLocaleString()+' A @208V · '+ratedA(kva,480).toLocaleString()+' A @480V';}
function specBlock(u){if(!u||u.klass!=='big')return '';
  if(isTwin(u)){const per=twinPerKva(u);if(!(per>0))return '';
    return `<div style="margin-top:10px"><div class="lb" style="margin-bottom:6px">RATED SPECS · from nameplate kVA @ 0.8 PF</div><div style="font-size:12.5px;margin-bottom:3px"><span class="muted">Per engine</span>&nbsp; ${specRow(per)}</div><div style="font-size:12.5px"><span class="muted">Combined (when paralleled)</span>&nbsp; ${specRow(per*2)}</div></div>`;}
  const kva=parseFloat(u.kw);if(!(kva>0))return '';
  return `<div style="margin-top:10px"><div class="lb" style="margin-bottom:6px">RATED SPECS · from nameplate kVA @ 0.8 PF</div><div style="font-size:12.5px">${specRow(kva)}</div></div>`;}
```

In `paneInfo`: Rating kv row becomes `${sizeText(u)||'—'}` (big iron reads "Twin 400 kW" there too); insert `${specBlock(u)}` after the kv table, before PHOTOS.

**Step 4:** Run → PASS.

---

### Task 7: Syntax check, full suite, preflight, manual sweep

**Step 1:** Syntax gate (§9.3): `node -e "…vm.Script…"` → `syntax OK`.
**Step 2:** Full suite: `TZ=America/Los_Angeles node tools/fv_smoke.js index.html tools/fv_inv_*.js` → PASS, note new count (>1319).
**Step 3:** `python3 tools/fv_deploy.py preflight -m "twin-size-kw: big iron speaks per-engine kW"` → RESULT: PASS.
**Step 4:** Manual sweep (§9.6, harness/browser): job detail + Fleet with the real twin mix (populated/empty/edge); Info tab big single, twin, small, no-rating; edit sheet echo on big/small/twin; search each surface for "twin"/"400"/"1000"; hostile strings untouched paths.

---

### Task 8: HANDOFF.md updates + marker bump

**Files:**
- Modify: `HANDOFF.md` (§3 build entry, §10)
- Modify: `index.html:13` marker → `<!-- fleetview build 2026-09-22 twin-size-kw -->`

New §3 entry covering: kW-for-big-iron doctrine (render-only ×0.8, storage kVA, small iron kVA, config never twin evidence), NES sort, search tokens, spec block, edit-form echo, invariants file + suite count. Plus:
- **Born-twin doctrine (Andy, 2026-09-22):** a twin pack is BORN twin — one container, one control panel, A and B engines, never split (Technogen TGDs, CAT twin packs). XQ500/X5M units are ALWAYS singles, even when married in pairs on a 40' chassis: chassis pairings are temporary, can be split and re-paired with any other unit, and are NEVER twin status. Twin status = `engines` set, only ever for born twin packs. (This retires the X5M entries from the §10 binding-pass expectation — they were chassis pairings, not conversion candidates.)
- **Parked:** "highest leg % of rated amps" as a possible future secondary warning (Andy, 2026-09-22 — not this build).
- **Deliberate:** fv_sitemap/fv_archive stay kVA (client-sheet/archival conventions).
- **Intentionally excluded NES twins (Andy, 2026-09-22 — broken or rarely used; do not import):** 1624072-845823 (175 kW Twin, 208V only) · 0626113-845828 (175 kW Twin, 208V only, 30') · 0691927-854743 (175 kW Twin, 208V only) · 0629257/58 (175 kW Twin, 208V only) · MS415044A/B (175 kW Twin, Prod Power, 208V only) · A06503/A06672 (180 kW Twin, 208V only, not for broadcast) · 9NR04789-95 (225 kW Twin, pintle hitch) · 9NR04792-93 (225 kW Twin, pintle hitch) · 0677177/78 (300 kW Twin, 208V only) · 0675783/84 (300 kW Twin, 208V only) · 0639342/0515754 (300 kW Twin, 208V only).

---

### Task 9: Data fixes — PREVIEW, then Andy's go, then write

**Gate: show Andy the exact current rows and the exact statements. No write without his OK.** Idempotent SQL (dashboard SQL editor per house convention, or MCP on his word). `updated_at` bumps so LWW resolves server-wins on any stale client.

Preview selects (run, paste results to Andy):
```sql
select serial, kw, config, engines from units where serial in ('TGD62501','TGD62504','TGD62507','C5E02263-64','X5M00306','X5M00388','X5M00446');
select id, serial, klass, kw, make, model from units where make ilike '%PMC%' or model ilike '%PMC%';
```

Writes (after OK):
```sql
update units set kw=1250, updated_at=now() where serial in ('TGD62501','TGD62504','TGD62507') and kw=1257;
update units set config='TwinPak', updated_at=now() where serial='C5E02263-64' and config='Double 500kW';  -- recommend 'TwinPak': matches family vocabulary; model already reads 'Twin 400 in 20ft can'
update units set kw=null, updated_at=now() where serial='<PMC15 serial from preview>' and kw=500 and klass='small';
update units set config=null, updated_at=now() where serial in ('X5M00306','X5M00388','X5M00446');  -- unconditional (Andy 2026-09-22): XQ500s are ALWAYS singles — see the born-twin doctrine in Task 8
```
Verify: re-run the preview select; expected 1250/1250/1250, 'TwinPak', null kw, three null configs.

---

### Task 10: Add the two 9NR 200 kW Twins — PREVIEW, then Andy's go, then insert

Conventions copied from the 2026-08-01 seed rows (verified live): serial = NES serial portion only; NES annotation → `notes` as `[NES] …`; `op_status 'staged'`, `location_type 'fleet'`; everything the NES doesn't state stays null (make, model, config, tag_id, hours). `gen_random_uuid()` bare — never `::text` (§7). Dedup re-check immediately before insert (search already done 2026-09-22: zero 9NR anywhere).

```sql
insert into units (id, serial, klass, kw, engines, notes, op_status, location_type, created_at, updated_at)
select gen_random_uuid(), '9NR05394-97', 'big', 500,
       '{"A":{"kvaEach":250},"B":{"kvaEach":250}}'::jsonb,
       '[NES] 208V ONLY 30''', 'staged', 'fleet', now(), now()
where not exists (select 1 from units where serial='9NR05394-97');

insert into units (id, serial, klass, kw, engines, notes, op_status, location_type, created_at, updated_at)
select gen_random_uuid(), '9NR05395-96', 'big', 500,
       '{"A":{"kvaEach":250},"B":{"kvaEach":250}}'::jsonb,
       '[NES] 208V ONLY 30''', 'staged', 'fleet', now(), now()
where not exists (select 1 from units where serial='9NR05395-96');
```
Verify select after: both rows present, `sizeText` renders them "Twin 200 kW" (already pinned in Task 1's test). Both engines will correctly show "needs a meter reading" chips until a tech binds real hours — that is the designed behavior, not a defect.

---

### Task 11: Stage by name, commit, STOP

```bash
git add index.html tools/fv_inv_twinsize.js tools/fv_inv_fleetcard.js HANDOFF.md docs/plans/2026-09-22-twin-size-kw.md
git status   # re-preflight eyes: nothing else staged, no archive/ or CLAUDE.md
git commit -m "twin-size-kw: big iron speaks per-engine kW (Twin 400 kW), NES sort, size search, Info-tab rated specs"
```

**STOP. Do not push.** Andy pushes on a fresh ask (git-staging-discipline). Live verify after his push: `python3 tools/fv_deploy.py verify` / marker grep.
