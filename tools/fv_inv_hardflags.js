/**
 * fv_inv_hardflags.js — standing invariants for hard-impossible caps + the
 * two-tap save gate + check-form field order (2026-10-10).
 *
 * The contract, settled by the 2026-10-10 data pass (16 physically-impossible
 * rows across 7 techs, zero voided; 55 hours anomalies, 17 after the entry-time
 * warning shipped — it renders under a closing sheet when the Save tap outruns
 * it):
 *
 *  - HARD flags fire only on IMPOSSIBLE values (ceilings no real reading can
 *    reach), never on unusual ones. SPEC_RANGES plate-range flags stay soft:
 *    they NEVER arm the gate — oil psi outside an XQ-500's band happens
 *    legitimately, and a second tap demanded routinely becomes noise that
 *    buries the real flags.
 *  - The gate NEVER blocks: saving anyway is always exactly one more tap, and
 *    the value saves AS TYPED — an extreme-but-real reading is the most
 *    valuable row in the app (U12204160's 180%-during-refuel documented a
 *    broken gauge).
 *  - Hours has no digit-count ceiling (23,100 is real; 189,625 is an error,
 *    same digit count) — its check is hoursSanity against the lane's previous
 *    reading, now surviving the Save tap.
 *  - Messages name the problem in the tech's words, never "invalid".
 *  - Field order follows the CAT EMCP panel at screen granularity: Status →
 *    Engine hrs (every-state field, outside the collapse) → engine pair
 *    (coolant/oil) → AC screen (V/A/Hz/kW) → fuel screen (fuel psi/rate).
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const HOUR = 3600e3;
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    make: 'CAT', model: 'XQ-500', kw: 625, opStatus: 'running',
    locationType: 'show', locationId: 'show-A', photos: [], jobMeta: {}, updatedAt: 1 }, o);
  const mkReport = (o = {}) => Object.assign({ id: id('r'), unitId: 'u-a', showId: 'show-A',
    techName: 'Mike R.', timestamp: Date.now() - 9 * HOUR, gps: null, engine: null,
    engineHours: null, notes: '' }, o);
  const $q = (sel) => app.document.querySelector(sel);
  const $v = (sel, v) => { $q(sel).value = v; };
  const clearNum = () => ['#v_ll', '#v_ln', '#v_a1', '#v_a2', '#v_a3', '#v_hz', '#v_kw', '#v_ct',
    '#v_op', '#v_fp', '#v_gph', '#v_fuel', '#v_bat', '#v_def', '#v_hrs']
    .forEach((x) => { const el = $q(x); if (el) el.value = ''; });
  const openForm = (uid2, e) => { app.fn.logVitals(uid2, e); clearNum(); const n = $q('#v_notes'); if (n) n.value = ''; };
  const hard = () => app.fn.hardFlags();
  const hardText = () => hard().join(' | ');
  const reportsOf = (uid2) => app.S.reports.filter((r) => r.unitId === uid2);

  const baseState = () => ({
    units: [mkUnit({ id: 'u-a' }),
            mkUnit({ id: 'u-nr', make: 'MMD', model: 'PowerPro 25', kw: null, klass: 'small' }),
            mkUnit({ id: 'u-sm', make: 'Multiquip', model: 'DCA70', kw: 70, klass: 'small' })],
    shows: [{ id: 'show-A', name: 'A' }],
  });

  app.setState(baseState());app.S.settings.techName='Mike R.';

  t.group('hard caps: percent fields — 0–100 is a definition, not a band');
  openForm('u-a');
  $v('#v_def', '2988.8');
  t.includes(hardText(), '2,988.8', 'DEF 2988.8 flags, value named with locale commas');
  t.includes(hardText(), 'reads 0–100', 'message states the rule in plain words');
  $v('#v_def', '99'); t.eq(hard().length, 0, 'DEF 99 is silent');
  $v('#v_def', '100'); t.eq(hard().length, 0, 'DEF exactly 100 is silent — full tank is real');
  $v('#v_def', '');
  $v('#v_fuel', '600'); t.includes(hardText(), 'reads 0–100', 'fuel % 600 flags (the gallons-typed-as-pct shape)');
  $v('#v_fuel', '100'); t.eq(hard().length, 0, 'fuel 100% silent');
  $v('#v_fuel', '');

  t.group('hard caps: battery / oil / coolant / fuel psi / gph / Hz ceilings — impossible only');
  openForm('u-a');
  $v('#v_bat', '856'); t.includes(hardText(), 'reads 12–30 V', 'batt 856 flags with the real battery range named');
  $v('#v_bat', '94');  t.ok(hard().length === 1, 'batt 94 flags (the triple-digit-adjacent typo)');
  $v('#v_bat', '32');  t.eq(hard().length, 0, 'batt 32 is unusual, NOT impossible — stays silent');
  $v('#v_bat', '27.3'); t.eq(hard().length, 0, 'batt 27.3 (the panel photo value) silent');
  $v('#v_bat', '');
  $v('#v_op', '6678'); t.includes(hardText(), 'past 150', 'oil 6,678 psi flags');
  $v('#v_op', '95');   t.eq(hard().length, 0, 'oil 95 is above the XQ-500 SOFT ceiling but NOT hard-impossible');
  $v('#v_op', '');
  $v('#v_ct', '310'); t.includes(hardText(), 'past 300', 'coolant 310 flags');
  $v('#v_ct', '230'); t.eq(hard().length, 0, 'coolant 230 (live-data max) silent');
  $v('#v_ct', '');
  $v('#v_fp', '250'); t.includes(hardText(), 'past 200', 'fuel psi 250 flags');
  $v('#v_fp', '103'); t.eq(hard().length, 0, 'fuel psi 103 (live-data max) silent');
  $v('#v_fp', '');
  $v('#v_gph', '200'); t.includes(hardText(), 'burns', 'gph 200 flags');
  $v('#v_gph', '36');  t.eq(hard().length, 0, 'gph 36 (XQ-500 full-load burn) silent');
  $v('#v_gph', '');
  $v('#v_hz', '90'); t.includes(hardText(), '60 Hz', 'Hz 90 flags naming what these units make');
  $v('#v_hz', '61'); t.eq(hard().length, 0, 'Hz 61 silent');
  $v('#v_hz', '30'); t.eq(hard().length, 0, 'Hz 30 low side deliberately unflagged — a spooling engine can read low');
  $v('#v_hz', '');

  t.group('hard caps: amps and kW against the rating — never guess without one');
  openForm('u-a');                                    // 625 kVA
  $v('#v_a1', '5447'); t.includes(hardText(), '625 kVA', 'amps 5,447 on a 625 kVA flags, rating named');
  t.includes(hardText(), '208 V', 'message explains the ceiling is the 208 V worst case');
  $v('#v_a1', '1500'); t.eq(hard().length, 0, 'amps 1,500 at 208 V is real — silent');
  $v('#v_a1', '');
  $v('#v_kw', '700'); t.includes(hardText(), 'can make', 'kW 700 > 625 kVA flags — PF cannot exceed 1');
  $v('#v_kw', '490'); t.eq(hard().length, 0, 'kW 490 silent');
  $v('#v_kw', '');
  openForm('u-nr');                                   // no rating
  $v('#v_a1', '5447'); t.eq(hard().length, 0, 'no rating -> no amps cap, never the wrong ceiling');
  $v('#v_kw', '700');  t.eq(hard().length, 0, 'no rating -> no kW cap');

  t.group('hard caps: negatives are impossible everywhere');
  openForm('u-a');
  $v('#v_op', '-5'); t.includes(hardText(), 'negative', 'negative oil psi flags');
  $v('#v_op', '');

  t.group('hard caps: fuel in inches mode caps at the stick, in stick words');
  app.fn.setFuelUnit('show-A', 'in');
  openForm('u-a');
  $v('#v_fuel', '600'); t.includes(hardText(), '0–11', 'inches mode: 600 flags against the 11″ stick, not 100%');
  $v('#v_fuel', '10.5'); t.eq(hard().length, 0, 'inches 10.5 silent');
  app.fn.setFuelUnit('show-A', 'pct');

  t.group('hard caps: hours is hoursSanity surviving the save, never a digit ceiling');
  app.setState(baseState());app.S.settings.techName='Mike R.';
  app.S.reports.push(mkReport({ unitId: 'u-a', engineHours: 12094 }));
  openForm('u-a');
  $v('#v_hrs', '1200');
  t.includes(hardText(), '12,094', 'hours 1,200 below last reading flags, last reading named');
  t.includes(hardText(), 'run backward', 'and says why in meter words');
  $v('#v_hrs', '23100'); t.ok(hard().length > 0, 'impossible-fast advance flags too (23,100 in 9h)');
  $v('#v_hrs', '12100'); t.eq(hard().length, 0, 'plausible advance silent — no digit-count rule on hours');
  $v('#v_hrs', '');

  t.group('save gate: impossible -> two taps, saves AS TYPED; soft flags save on the first');
  app.setState(baseState());app.S.settings.techName='Mike R.';
  openForm('u-a');
  $v('#v_def', '2988.8');
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 0, 'first tap on an impossible value does NOT save');
  t.includes($q('#v_save').textContent, 'Save anyway', 'button re-arms as Save anyway');
  t.includes($q('#v_hardWarn').innerHTML, 'reads 0–100', 'the warning is on screen at the moment of the tap');
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 1, 'second tap saves');
  t.eq(reportsOf('u-a')[0].defPct, 2988.8, 'value saved EXACTLY as typed — never modified, never blocked');

  app.setState(baseState());app.S.settings.techName='Mike R.';
  openForm('u-a');                                    // XQ-500, running
  $v('#v_op', '30');                                  // soft plate flag live, nothing hard
  app.fn.rangeFlags();
  t.ok($q('#v_rangeFlags').innerHTML.length > 0, 'fixture check: the soft flag IS firing');
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 1, 'SOFT flag saves on the FIRST tap — plate ranges never arm the gate');

  app.setState(baseState());app.S.settings.techName='Mike R.';
  openForm('u-a');
  $v('#v_bat', '27.3');
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 1, 'clean check saves first tap (regression)');

  t.group('save gate: fixing the value disarms; a DIFFERENT impossible value re-gates');
  app.setState(baseState());app.S.settings.techName='Mike R.';
  openForm('u-a');
  $v('#v_def', '2988.8');
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 0, 'armed');
  $v('#v_def', '29.8');
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 1, 'fixed value saves on the next tap');
  t.eq(reportsOf('u-a')[0].defPct, 29.8, 'and saves the corrected value');

  app.setState(baseState());app.S.settings.techName='Mike R.';
  openForm('u-a');
  $v('#v_def', '2988.8');
  app.fn.saveVitals('u-a', '');
  $v('#v_def', '5000');                               // still impossible, different value
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 0, 'a different impossible value re-gates — the arm is per-reading, not per-form');
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 1, 'and one more tap saves that one as typed');

  t.group('save gate: re-opening the form resets the arm');
  app.setState(baseState());app.S.settings.techName='Mike R.';
  openForm('u-a');
  $v('#v_def', '2988.8');
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 0, 'armed');
  openForm('u-a');                                    // close/reopen
  $v('#v_def', '2988.8');
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 0, 'fresh form gates again — the arm never leaks across opens');

  t.group('save gate: hours-below-previous survives the Save tap');
  app.setState(baseState());app.S.settings.techName='Mike R.';
  app.S.reports.push(mkReport({ unitId: 'u-a', engineHours: 12094 }));
  openForm('u-a');
  $v('#v_hrs', '1200');
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 1, 'first tap gated (only the fixture report exists)');
  t.includes($q('#v_hardWarn').innerHTML, '12,094', 'warning names the last reading at the button');
  app.fn.saveVitals('u-a', '');
  const hrsRow = reportsOf('u-a').find((r) => r.engineHours === 1200);
  t.ok(hrsRow, 'second tap saves 1,200 as typed — meters get replaced, the tech decides');

  t.group('save gate: hidden-but-typed electricals still gate (collapse never hides a bad save)');
  app.setState(baseState());app.S.settings.techName='Mike R.';
  openForm('u-a');
  $v('#v_op', '6678');
  const fakeBtn = (v) => ({ dataset: { v }, classList: { add() {}, remove() {} }, style: {} });
  app.fn.vseg(fakeBtn('staged'));                     // collapses electricals, value stays
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 0, 'gated: the hidden 6,678 would still be stored');

  t.group('save gate: small iron has no big-iron fields and must not throw');
  app.setState(baseState());app.S.settings.techName='Mike R.';
  openForm('u-sm');
  $v('#v_bat', '94');
  app.fn.saveVitals('u-sm', '');
  t.eq(reportsOf('u-sm').length, 0, 'batt cap fires on small iron, missing fuel-psi/gph/DEF DOM tolerated');
  app.fn.saveVitals('u-sm', '');
  t.eq(reportsOf('u-sm').length, 1, 'and saves on the second tap');

  t.group('save gate: blank-check two-tap unchanged (hard gate does not interfere)');
  app.setState(baseState());app.S.settings.techName='Mike R.';
  openForm('u-a');
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 0, 'blank first tap still gated by emptyOk');
  t.includes($q('#v_save').textContent, 'empty check', 'with the visit wording, not the flag wording');
  app.fn.saveVitals('u-a', '');
  t.eq(reportsOf('u-a').length, 1, 'blank second tap still saves as a visit');

  t.group('observation rule: flags comment, never touch inputs, never offer controls');
  app.setState(baseState());app.S.settings.techName='Mike R.';
  openForm('u-a');
  $v('#v_def', '2988.8');
  app.fn.saveVitals('u-a', '');
  t.eq($q('#v_def').value, '2988.8', 'typed value never modified by the gate');
  const hw = $q('#v_hardWarn').innerHTML;
  t.excludes(hw, '<input', 'warn area renders text, no inputs');
  t.excludes(hw, 'onclick', 'warn area offers no actions — comment, not correction');
  t.excludes(hw.toLowerCase(), 'invalid', 'never says "invalid" — names the problem instead');

  t.group('field order: hours leads (under Status, outside the collapse), panel order inside');
  app.setState(baseState());app.S.settings.techName='Mike R.';
  openForm('u-a');
  const f = $q('#sheet').innerHTML;
  const at = (s) => { const i = f.indexOf(s); t.ok(i !== -1, 'markup present: ' + s); return i; };
  t.ok(at('id="v_seg"') < at('id="v_hrs"'), 'Status still leads the form');
  t.ok(at('id="v_hrs"') < at('id="v_elec"'), 'ENGINE HRS sits above the electrical block — present in every state');
  t.includes(f, 'drives the service countdown', 'hours keeps its why-label');
  t.includes(f, 'placeholder="read the meter"', 'hours keeps the observation placeholder');
  t.ok(at('id="v_hrsWarn"') > at('id="v_hrs"') && at('id="v_hrsWarn"') < at('id="v_elec"'),
    'the hours warning travels with the field');
  const elecBody = f.slice(f.indexOf('id="v_elec"'), f.indexOf('id="v_elecOff"'));
  const ein = (s) => { const i = elecBody.indexOf(s); t.ok(i !== -1, 'in elec block: ' + s); return i; };
  t.ok(ein('id="v_ct"') < ein('id="v_ll"'), 'coolant/oil (panel engine screen) lead the block');
  t.ok(ein('id="v_ll"') < ein('id="v_hz"'), 'then the AC screen: volts before Hz/kW');
  t.ok(ein('id="v_kw"') < ein('id="v_fp"'), 'fuel psi/rate (panel fuel screen) close the block');
  t.excludes(elecBody, 'id="v_hrs"', 'hours stays OUT of the collapse — observable on an off unit');
  t.includes(f, 'id="v_hardWarn"', 'the hard-flag line renders by the Save button');
  t.ok(at('id="v_hardWarn"') > at('id="v_notes"') && at('id="v_hardWarn"') < at('id="v_save"'),
    'hard warnings sit directly above Save — visible at the moment of decision');
};
