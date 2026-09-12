/**
 * fv_inv_fuelunit.js — standing invariants for the fuel %/inches toggle.
 *
 * Techs dip XQ-500-class tanks with a stick marked in EIGHTHS (11″ = full,
 * 750-gal fill; the placard's 780 is shell capacity). Storage is and stays
 * fuelLevelPct — inches exist only at the display/input layer. Targeting is
 * make+model (CATXQ500, nrmCode-normalized) OR an exact-serial allowlist of
 * the 12 blank-model units the fleet capacity record puts on the same tank.
 * NEVER kw/kVA (32 HiPower 625s share kw=625, 600-gal tanks) and NEVER a
 * serial prefix (T4A00754-55 is a 1250 TwinPak sharing T4A007). The toggle is
 * per show (localStorage fleetview_fuelunit_v1), governs input AND display,
 * and changes no stored value, no threshold, no bar geometry.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const HOUR = 3600e3;
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    make: 'CAT', model: 'XQ-500', kw: 625, opStatus: 'running',
    locationType: 'show', locationId: 'show-A', photos: [], jobMeta: {}, updatedAt: 1 }, o);
  const mkRpt = (unitId, o = {}) => Object.assign(
    { id: id('r'), unitId, showId: 'show-A', techName: 'Mike R.', timestamp: Date.now() - HOUR }, o);
  const FKEY = 'fleetview_fuelunit_v1';
  const fdump = () => JSON.parse(app.localStorage.getItem(FKEY) || '{}');
  const ts = () => app.fn.tankSpecFor({ make: 'CAT', model: 'XQ-500', serial: 'X' });

  t.group('fuel-inches: targeting — model string OR exact serial, never size, never prefix');
  t.ok(app.fn.tankSpecFor({ make: 'CAT', model: 'XQ-500', serial: 'X5M00207' }), 'CAT XQ-500 hits by model');
  t.ok(app.fn.tankSpecFor({ make: 'CAT', model: 'xq 500', serial: 'X' }), 'xq 500 hits (case/space normalized)');
  t.ok(app.fn.tankSpecFor({ make: 'CAT', model: 'XQ500', serial: 'X' }), 'XQ500 hits (separator normalized)');
  ['T4A00750','T4A00751','T4A00752','T4A00753','T4A00756','T4A00757','T4A00758','T4A00759',
   'GG500104','GG500109','GG500110','GG500111'].forEach((s) =>
    t.ok(app.fn.tankSpecFor({ make: '', model: '', serial: s }),
      s + ' hits by serial allowlist with blank make AND model'));
  t.ok(app.fn.tankSpecFor({ make: null, model: null, serial: ' t4a00750 ' }), 'allowlist serial match is normalized (case/whitespace)');
  t.eq(app.fn.tankSpecFor({ make: 'CAT', model: '', serial: 'T4A00754-55' }), null,
    'T4A00754-55 (1250 TwinPak, shared prefix) MISSES — exact serials only');
  t.eq(app.fn.tankSpecFor({ make: 'CAT', model: '', serial: 'B3G00213' }), null,
    'B3G00213 misses — capacity unverified, excluded by decision');
  t.eq(app.fn.tankSpecFor({ make: 'HiPower', model: '', serial: 'HP-625-01', kw: 625 }), null,
    'HiPower kw=625 misses — size is never a targeting signal');
  t.eq(app.fn.tankSpecFor({ make: 'CAT', model: '', serial: 'GG500199' }), null,
    'blank-model CAT off the allowlist misses');
  t.eq(app.fn.tankSpecFor(null), null, 'null unit is safe');
  t.eq(ts().fullInches, 11, 'full tank is 11 inches');
  t.eq(ts().gallons, 750, 'capacity is 750 (fleet fill record), not the 780 shell figure');

  t.group('fuel-inches: eighths round-trip through integer pct — all 89 values, zero loss');
  {
    const sp = ts();
    const seen = new Set();
    let stable = true, distinct = true;
    for (let k = 0; k <= 88; k++) {
      const inches = k / 8;
      const pct = app.fn.inToPct(inches, sp);
      if (seen.has(pct)) distinct = false;
      seen.add(pct);
      if (app.fn.pctToIn(pct, sp) !== inches) stable = false;
    }
    t.ok(distinct, 'every eighth 0–11 maps to a DISTINCT integer pct (no two marks collide)');
    t.ok(stable, 'every eighth survives pct round-trip exactly (display never drifts a reading)');
    t.eq(app.fn.inToPct(1.375, sp), 13, 'transit-limit mark 1⅜ -> 13%');
    t.eq(app.fn.pctToIn(13, sp), 1.375, '13% -> 1⅜ back');
    t.eq(app.fn.inToPct(5.5, sp), 50, 'half tank 5½ -> 50%');
    t.eq(app.fn.inToPct(8.25, sp), 75, 'three-quarter mark 8¼ -> 75%');
    t.eq(app.fn.inToPct(15, sp), 100, 'over-full input clamps to 100');
    t.eq(app.fn.inToPct(-2, sp), 0, 'negative input clamps to 0');
  }

  t.group('fuel-inches: display renders stick fractions, not decimals');
  t.eq(app.fn.fmtIn(5.5), '5½″', '5.5 renders 5½″');
  t.eq(app.fn.fmtIn(1.375), '1⅜″', '1.375 renders 1⅜″');
  t.eq(app.fn.fmtIn(0.125), '⅛″', 'bare eighth renders ⅛″ with no leading zero');
  t.eq(app.fn.fmtIn(11), '11″', 'whole inches carry no fraction');
  t.eq(app.fn.fmtIn(0), '0″', 'empty tank is 0″, not blank');
  t.eq(app.fn.fmtIn(9.625), '9⅝″', 'quarter-tank stick mark 9⅝″');

  t.group('fuel-inches: per-show persistence — keyed to the UNIT\'s show, default %');
  {
    app.localStorage.removeItem(FKEY);
    const onShow = mkUnit({ id: 'u-fu-show' });
    const atShop = mkUnit({ id: 'u-fu-shop', locationType: 'fleet', locationId: null });
    const noSpec = mkUnit({ id: 'u-fu-hp', make: 'HiPower', model: '', serial: 'HP-1' });
    app.setState({ units: [onShow, atShop, noSpec], shows: [{ id: 'show-A', name: 'A' }] });
    t.eq(app.fn.fuelUnitForUnit(onShow), 'pct', 'no stored preference -> pct');
    app.fn.setFuelUnit('show-A', 'in');
    t.eq(app.fn.fuelUnitForUnit(onShow), 'in', 'spec unit on the toggled show reads inches');
    t.eq(app.fn.fuelUnitForUnit(atShop), 'pct', 'same-spec unit at the shop stays pct — the preference is the show\'s, not the fleet\'s');
    t.eq(app.fn.fuelUnitForUnit(noSpec), 'pct', 'no-spec unit on the toggled show stays pct');
    t.eq(fdump()['show-A'], 'in', 'preference persisted under the show id');
    app.fn.setFuelUnit('show-A', 'pct');
    t.ok(!('show-A' in fdump()), 'switching back to %% DELETES the key — the map self-prunes');
    t.eq(app.fn.fuelUnitForUnit(onShow), 'pct', 'and the unit reads pct again');
  }

  t.group('fuel-inches: display surfaces convert labels; geometry, colors and thresholds stay pct');
  {
    app.localStorage.removeItem(FKEY);
    const u = mkUnit({ id: 'u-fu-d' });
    app.setState({ units: [u], shows: [{ id: 'show-A', name: 'A' }],
      reports: [mkRpt('u-fu-d', { fuelLevelPct: 13 })] });
    app.S.settings.techName = 'Mike R.';

    let bar = app.fn.fuelBar(u);
    t.includes(bar, '13%', 'pct mode: label reads 13%');
    app.fn.setFuelUnit('show-A', 'in');
    bar = app.fn.fuelBar(u);
    t.includes(bar, '1⅜″', 'in mode: label reads 1⅜″');
    t.includes(bar, 'width:13%', 'in mode: fill width is still the pct — bar geometry never converts');
    t.includes(bar, 'var(--red)', 'in mode: 13% is still red — color thresholds never convert');

    t.ok(app.fn.lowFuel(u), 'lowFuel(<20%) fires identically in inches mode');
    const reason = app.fn.computeStatus(u).reasons.find((r) => /^Fuel /.test(r.t));
    t.ok(reason && reason.t.includes('1⅜″'), 'alert reason reads Fuel 1⅜″ in inches mode');
    app.fn.setFuelUnit('show-A', 'pct');
    const reason2 = app.fn.computeStatus(u).reasons.find((r) => /^Fuel /.test(r.t));
    t.eq(reason2 && reason2.t, 'Fuel 13%', 'alert reason reads Fuel 13% in pct mode');

    t.includes(app.fn.checkLogRow(u, app.S.reports[0]), 'fuel 13%', 'history line pct mode');
    app.fn.setFuelUnit('show-A', 'in');
    t.includes(app.fn.checkLogRow(u, app.S.reports[0]), 'fuel 1⅜″', 'history line inches mode');
  }

  t.group('fuel-inches: check form — toggle only where it belongs, zero footprint elsewhere');
  {
    app.localStorage.removeItem(FKEY);
    const spec = mkUnit({ id: 'u-fu-f1' });
    const hp = mkUnit({ id: 'u-fu-f2', make: 'HiPower', model: '', serial: 'HP-2' });
    const shop = mkUnit({ id: 'u-fu-f3', locationType: 'fleet', locationId: null });
    app.setState({ units: [spec, hp, shop], shows: [{ id: 'show-A', name: 'A' }] });
    app.S.settings.techName = 'Mike R.';
    const sheetHtml = () => app.document.querySelector('#sheet').innerHTML;

    app.fn.logVitals('u-fu-f1');
    t.includes(sheetHtml(), 'Fuel %', 'spec unit, pct mode: label is Fuel %% — no-toggle techs see today\'s form');
    t.includes(sheetHtml(), 'v_fu_in', 'spec unit on show: the %%/in toggle is offered');
    t.excludes(sheetHtml(), 'step="0.125"', 'pct mode: input carries no inches constraints');

    app.fn.logVitals('u-fu-f2');
    t.excludes(sheetHtml(), 'v_fu_in', 'HiPower on the same show: no toggle, pure %%');
    app.fn.logVitals('u-fu-f3');
    t.excludes(sheetHtml(), 'v_fu_in', 'spec unit at the shop: no toggle');

    app.fn.setFuelUnit('show-A', 'in');
    app.fn.logVitals('u-fu-f1');
    t.includes(sheetHtml(), 'Fuel (in)', 'inches mode: label says Fuel (in)');
    t.includes(sheetHtml(), 'step="0.125"', 'inches mode: eighth-inch step — 1.375 must be a legal value');
    t.includes(sheetHtml(), 'max="11"', 'inches mode: capped at the 11″ full mark');
  }

  t.group('fuel-inches: mid-form toggle converts the typed value in place, never rebuilds the sheet');
  {
    app.localStorage.removeItem(FKEY);
    const u = mkUnit({ id: 'u-fu-t' });
    app.setState({ units: [u], shows: [{ id: 'show-A', name: 'A' }] });
    app.S.settings.techName = 'Mike R.';
    app.fn.logVitals('u-fu-t');
    const inp = app.document.querySelector('#v_fuel');
    inp.value = '50';
    app.fn.fuelModeT('in');
    t.eq(inp.value, '5.5', 'typed 50%% converts to 5.5 on toggle to inches');
    t.eq(app.document.querySelector('#v_fuelLb').textContent, 'Fuel (in)', 'label swaps live');
    t.eq(inp.getAttribute('step'), '0.125', 'input constraints swap live');
    app.fn.fuelModeT('pct');
    t.eq(inp.value, '50', 'and converts back losslessly');
    t.eq(app.document.querySelector('#v_fuelLb').textContent, 'Fuel %', 'label restored');
    t.eq(inp.getAttribute('step'), null, 'inches constraints removed in pct mode');
    inp.value = '';
    app.fn.fuelModeT('in');
    t.eq(inp.value, '', 'an empty field stays empty across the toggle — never prefilled');
    app.fn.fuelModeT('pct');
  }

  t.group('fuel-inches: save path — storage is pct, always, and pct mode is untouched');
  {
    app.localStorage.removeItem(FKEY);
    const u = mkUnit({ id: 'u-fu-s' });
    app.setState({ units: [u], shows: [{ id: 'show-A', name: 'A' }], reports: [] });
    app.S.settings.techName = 'Mike R.';
    const FIELDS = ['#v_ll','#v_ln','#v_a1','#v_a2','#v_a3','#v_hz','#v_kw','#v_ct','#v_op','#v_fp','#v_fuel','#v_bat','#v_def','#v_hrs','#v_notes'];
    const openClean = () => { app.fn.logVitals('u-fu-s'); FIELDS.forEach((s) => { app.document.querySelector(s).value = ''; }); };
    const saved = () => app.S.reports.find((r) => r.unitId === 'u-fu-s' && r.fuelLevelPct != null);

    app.fn.setFuelUnit('show-A', 'in');
    openClean();
    app.document.querySelector('#v_fuel').value = '5.5';
    await app.fn.saveVitals('u-fu-s', '');
    t.eq(saved() && saved().fuelLevelPct, 50, 'inches mode: 5.5 typed, 50 STORED — the DB never sees an inch');

    app.S.reports = [];
    openClean();
    app.document.querySelector('#v_fuel').value = '1.375';
    await app.fn.saveVitals('u-fu-s', '');
    t.eq(saved() && saved().fuelLevelPct, 13, 'inches mode: stick mark 1⅜ stores as 13');

    app.S.reports = [];
    app.fn.setFuelUnit('show-A', 'pct');
    openClean();
    app.document.querySelector('#v_fuel').value = '50';
    await app.fn.saveVitals('u-fu-s', '');
    t.eq(saved() && saved().fuelLevelPct, 50, 'pct mode: 50 stores as 50, byte-identical to before this feature');
  }

  t.group('fuel-inches: echo line — confirms the stick mark as typed, display-only, inches mode only');
  {
    app.localStorage.removeItem(FKEY);
    const u = mkUnit({ id: 'u-fu-e' });
    const shop = mkUnit({ id: 'u-fu-e2', locationType: 'fleet', locationId: null });
    app.setState({ units: [u, shop], shows: [{ id: 'show-A', name: 'A' }] });
    app.S.settings.techName = 'Mike R.';
    const echo = () => app.document.querySelector('#v_fuelEcho');
    const typed = (v) => { app.document.querySelector('#v_fuel').value = v; app.fn.fuelEcho(); return echo().textContent; };

    app.fn.setFuelUnit('show-A', 'in');
    app.fn.logVitals('u-fu-e');
    t.includes(app.document.querySelector('#sheet').innerHTML, 'v_fuelEcho', 'echo line rendered in the form markup');
    t.includes(app.document.querySelector('#sheet').innerHTML, 'oninput="fuelEcho()"', 'fuel input drives the echo live');
    t.eq(typed('4.125'), '= 4⅛″ · 38%', 'typed 4.125 echoes the stick mark it means, with the stored pct');
    t.eq(typed('1.3'), '= 1⅜″ · 12%', 'an off-mark value echoes the mark it snaps to — the tech SEES the snap');
    t.eq(typed('11'), '= 11″ · 100%', 'full tank echoes clean');
    t.eq(typed('15'), '= 11″ · 100%', 'over-full echoes the clamp, not a fantasy reading');
    t.eq(typed(''), '', 'empty field echoes nothing — the echo never suggests a value');
    t.eq(echo().style.display, 'none', 'and the empty echo takes no space');
    t.excludes(echo().textContent + echo().innerHTML, 'onclick', 'echo is text, never a control');

    app.fn.setFuelUnit('show-A', 'pct');
    app.fn.logVitals('u-fu-e');
    t.eq(typed('50'), '', 'pct mode: echo stays empty — zero footprint for %% techs');
    t.eq(echo().style.display, 'none', 'pct mode: echo takes zero height');
    app.fn.logVitals('u-fu-e2');
    t.eq(typed('50'), '', 'off-show spec unit: echo stays empty');

    app.fn.setFuelUnit('show-A', 'pct');
    app.fn.logVitals('u-fu-e');
    app.document.querySelector('#v_fuel').value = '50';
    app.fn.fuelModeT('in');
    t.eq(echo().textContent, '= 5½″ · 50%', 'mid-form toggle to inches converts the value AND lights the echo');
    app.fn.fuelModeT('pct');
    t.eq(echo().textContent, '', 'toggle back to %% clears the echo');
    app.fn.setFuelUnit('show-A', 'pct');
  }

  t.group('fuel-inches: unit detail — readout toggle rendered only where eligible');
  {
    app.localStorage.removeItem(FKEY);
    const spec = mkUnit({ id: 'u-fu-p1' });
    const hp = mkUnit({ id: 'u-fu-p2', make: 'HiPower', model: '', serial: 'HP-3' });
    app.setState({ units: [spec, hp], shows: [{ id: 'show-A', name: 'A' }],
      reports: [mkRpt('u-fu-p1', { fuelLevelPct: 50 })] });
    app.S.settings.techName = 'Mike R.';
    const sheetHtml = () => app.document.querySelector('#sheet').innerHTML;

    app.fn.openUnit('u-fu-p1');
    t.includes(sheetHtml(), 'fuelUnitSet', 'spec unit on show: readout toggle present on the vitals pane');
    app.fn.setFuelUnit('show-A', 'in');
    app.fn.openUnit('u-fu-p1');
    t.includes(sheetHtml(), '5½″', 'latest-check card renders the historical 50%% as 5½″');
    app.fn.openUnit('u-fu-p2');
    t.excludes(sheetHtml(), 'fuelUnitSet', 'no-spec unit: no toggle anywhere on the pane');
    app.fn.setFuelUnit('show-A', 'pct');
  }
};
