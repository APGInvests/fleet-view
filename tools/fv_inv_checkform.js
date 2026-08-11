/**
 * fv_inv_checkform.js — standing invariants for the log-check form surface.
 *
 * Fuel pressure (psi) is big-iron only: it's the clogging-filter diagnostic per
 * the CAT XQ-500 data plate ("If changing racor filters does not correct fuel
 * pressure, try changing spin-on filters"). Small iron has no field, and the
 * Recent-checks table only grows the row when a value exists — with the same
 * neutral trend arrows as every other metric.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    opStatus: 'running', locationType: 'show', locationId: 'show-A', photos: [], jobMeta: {}, updatedAt: 1 }, o);

  t.group('check form: fuel psi is big iron only');
  app.setState({ units: [mkUnit({ id: 'u-big', klass: 'big' }), mkUnit({ id: 'u-small', klass: 'small' })],
                 shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  app.fn.logVitals('u-big');
  const bigForm = app.document.querySelector('#sheet').innerHTML;
  t.includes(bigForm, 'Fuel psi', 'big iron form has the field');
  t.includes(bigForm, 'v_fp', 'field wired to v_fp');
  t.excludes(bigForm, 'Stamped with', 'stamped-with copy stays gone');
  t.excludes(bigForm, "Leave blank what you didn", 'leave-blank copy stays gone');
  app.fn.logVitals('u-small');
  const smallForm = app.document.querySelector('#sheet').innerHTML;
  t.excludes(smallForm, 'Fuel psi', 'small iron form unchanged');

  t.group('check form: fuel psi saves and round-trips');
  app.fn.logVitals('u-big');
  app.document.querySelector('#v_fp').value = '101';
  app.document.querySelector('#v_notes').value = '';
  app.fn.saveVitals('u-big');
  const r = app.S.reports.find((x) => x.unitId === 'u-big');
  t.ok(r && r.fuelPsi === 101, 'typed 101 stored as fuelPsi (got ' + (r && r.fuelPsi) + ')');
  const row = app.fn.toRow('reports', r);
  t.eq(row.fuel_psi, 101, 'persists as fuel_psi');
  t.eq(app.fn.fromRow('reports', row).fuelPsi, 101, 'round-trips back');
  app.document.querySelector('#v_fp').value = '';
  app.fn.logVitals('u-small');
  app.document.querySelector('#v_hz').value = '60'; // a real reading — blank checks arm the two-tap confirm instead
  app.fn.saveVitals('u-small');
  const rs = app.S.reports.find((x) => x.unitId === 'u-small');
  t.ok(rs && rs.fuelPsi == null, 'small iron check stores null, never a value');

  t.group('check form: fuel psi in the Recent-checks table, neutral arrows');
  const now = Date.now();
  app.S.reports = [
    { id: 'r1', unitId: 'u-big', techName: 'Mike R.', timestamp: now, fuelPsi: 96 },
    { id: 'r2', unitId: 'u-big', techName: 'Dana', timestamp: now - 3600e3, fuelPsi: 104 },
  ];
  const tbl = app.fn.recentChecksTable(app.fn.reportsFor('u-big'));
  t.includes(tbl, 'Fuel psi', 'row appears when values exist');
  t.includes(tbl, '▼', 'trend arrow rendered (96 vs 104)');
  t.excludes(tbl, 'var(--red)', 'arrow is neutral, not colour-judged');
  app.S.reports.forEach((x) => { delete x.fuelPsi; });
  const tbl2 = app.fn.recentChecksTable(app.fn.reportsFor('u-big'));
  t.excludes(tbl2, 'Fuel psi', 'row absent when no unit ever recorded it');

  t.group('check form: every report stamps the rating it was measured against');
  // Load % is stored on append-only rows; without the rating stamped alongside,
  // a future prime/standby convention change silently breaks comparability.
  app.setState({ units: [
    mkUnit({ id: 'u-rated', klass: 'big', kw: 625 }),
    mkUnit({ id: 'u-norate', klass: 'big', kw: null }),
    mkUnit({ id: 'u-tw', klass: 'big', kw: 500, engines: { style: 'AB', A: { kvaEach: 438 }, B: {} } }),
  ], shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  const check = (uid2, eng, expect, label) => {
    app.fn.logVitals(uid2, eng);
    app.document.querySelector('#v_hz').value = '60'; // a real reading — blank checks arm the two-tap confirm instead
    app.fn.saveVitals(uid2, eng || undefined);
    const rr = app.S.reports.filter((x) => x.unitId === uid2).slice(-1)[0];
    t.ok(rr && (expect === null ? rr.ratingKva === null : rr.ratingKva === expect),
      label + ' (got ' + (rr && rr.ratingKva) + ')');
    return rr;
  };
  const r1 = check('u-rated', null, 625, 'single unit stamps u.kw');
  check('u-norate', null, null, 'no rating set -> stamps null, never a guess');
  check('u-tw', 'A', 438, 'TwinPak engine stamps its own kvaEach, not the package kw');
  const row2 = app.fn.toRow('reports', r1);
  t.eq(row2.rating_kva, 625, 'persists as rating_kva');
  t.eq(app.fn.fromRow('reports', row2).ratingKva, 625, 'round-trips back');

  t.group('check form: status segment leads; electricals collapse when not running');
  // The fake-zero fix (2026-08-10): status at the TOP of the form so an off unit
  // collapses the electrical grid BEFORE anyone types zeros into it. Collapse is
  // display-only — it must never clear a typed value, and save semantics are
  // untouched (hidden typed values still save; blank stays not-observed).
  app.setState({ units: [
    mkUnit({ id: 'u-run2', klass: 'big', opStatus: 'running' }),
    mkUnit({ id: 'u-stg2', klass: 'small', opStatus: 'staged' }),
  ], shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  const fakeBtn = (v) => ({ dataset: { v }, classList: { add() {}, remove() {} }, style: {} });

  app.fn.logVitals('u-run2');
  const f1 = app.document.querySelector('#sheet').innerHTML;
  t.ok(f1.indexOf('id="v_seg"') !== -1 && f1.indexOf('id="v_seg"') < f1.indexOf('id="v_ll"'),
    'status segment renders BEFORE the first electrical field');
  t.includes(f1, 'id="v_elec"', 'electricals live in a collapsible container');
  const elecBody = f1.slice(f1.indexOf('id="v_elec"'), f1.indexOf('id="v_elecOff"'));
  ['v_ll', 'v_ln', 'v_a1', 'v_hz', 'v_kw', 'v_ct', 'v_op', 'v_fp'].forEach((fid) =>
    t.includes(elecBody, fid, fid + ' collapses with the electricals'));
  ['v_fuel', 'v_bat', 'v_def', 'v_hrs', 'v_notes'].forEach((fid) =>
    t.excludes(elecBody, fid, fid + ' stays observable on an off unit'));
  const elec = app.document.querySelector('#v_elec');
  t.ne(elec.style.display, 'none', 'running unit opens with electricals visible');

  app.document.querySelector('#v_ll').value = '480';
  app.fn.vseg(fakeBtn('staged'));
  t.eq(elec.style.display, 'none', 'flipping to staged collapses electricals');
  t.ne(app.document.querySelector('#v_elecOff').style.display, 'none', 'the n/a line shows instead');
  t.eq(app.document.querySelector('#v_ll').value, '480', 'collapse never clears a typed value');
  app.fn.vseg(fakeBtn('running'));
  t.ne(elec.style.display, 'none', 'flipping back restores the grid');
  t.eq(app.document.querySelector('#v_ll').value, '480', 'typed value survives the round trip');
  app.fn.vseg(fakeBtn('down'));
  t.eq(elec.style.display, 'none', 'down collapses too');

  app.fn.logVitals('u-stg2');
  t.eq(app.document.querySelector('#v_elec').style.display, 'none', 'a staged unit opens already collapsed');

  // save is untouched by the collapse: hidden-but-typed still saves as typed
  app.fn.logVitals('u-run2');
  app.document.querySelector('#v_ll').value = '481';
  app.document.querySelector('#v_notes').value = '';
  app.fn.vseg(fakeBtn('staged'));
  app.fn.saveVitals('u-run2');
  const rHid = app.S.reports.filter((x) => x.unitId === 'u-run2').slice(-1)[0];
  t.ok(rHid && rHid.voltageLL === 481, 'hidden typed value still saves (got ' + (rHid && rHid.voltageLL) + ')');

  t.group('check form: "All good" chip — one tap replaces the typed ack');
  // 81 of 189 archive notes were a typed "Running clean". The chip stores a real
  // queryable boolean: true when tapped, NULL when not — untapped is "not
  // asserted", never "not OK". State must reset per form open (no leak between
  // units), and the canned-ack demand must not create a canned note string.
  app.setState({ units: [mkUnit({ id: 'u-ag', klass: 'big', opStatus: 'running' })],
                 shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  app.fn.logVitals('u-ag');
  const fAg = app.document.querySelector('#sheet').innerHTML;
  t.includes(fAg, 'id="v_allgood"', 'chip renders');
  t.ok(fAg.indexOf('id="v_allgood"') < fAg.indexOf('id="v_notes"'), 'chip sits above the notes field');
  t.includes(fAg, 'All good', 'chip says what it means');
  app.document.querySelector('#v_notes').value = '';
  app.fn.saveVitals('u-ag');
  let rAg = app.S.reports.filter((x) => x.unitId === 'u-ag').slice(-1)[0];
  t.ok(rAg && rAg.conditionOk === null, 'untapped saves NULL — not asserted (got ' + (rAg && rAg.conditionOk) + ')');
  app.fn.logVitals('u-ag');
  app.fn.vAllGoodT();
  app.fn.saveVitals('u-ag');
  rAg = app.S.reports.filter((x) => x.unitId === 'u-ag').slice(-1)[0];
  t.ok(rAg && rAg.conditionOk === true, 'tapped saves true (got ' + (rAg && rAg.conditionOk) + ')');
  t.excludes(String(rAg.notes), 'Running', 'chip writes the boolean, never a canned note');
  const rowAg = app.fn.toRow('reports', rAg);
  t.eq(rowAg.condition_ok, true, 'persists as condition_ok');
  t.eq(app.fn.fromRow('reports', rowAg).conditionOk, true, 'round-trips back');
  app.fn.logVitals('u-ag');
  app.fn.vAllGoodT();
  app.fn.vAllGoodT();
  app.fn.saveVitals('u-ag');
  rAg = app.S.reports.filter((x) => x.unitId === 'u-ag').slice(-1)[0];
  t.ok(rAg.conditionOk === null, 'toggled off saves NULL again (got ' + rAg.conditionOk + ')');
  app.fn.logVitals('u-ag');
  app.fn.vAllGoodT();
  app.fn.logVitals('u-ag');
  app.fn.saveVitals('u-ag');
  rAg = app.S.reports.filter((x) => x.unitId === 'u-ag').slice(-1)[0];
  t.ok(rAg.conditionOk === null, 'reopening the form resets the chip — no leak between checks');

  t.group('check form: gauge-broken picker — a blank becomes a signal, never an auto-issue');
  // A blank vital is ambiguous: not observed, or unobservable? The picker stores
  // WHICH gauges are broken (reports.broken_gauges, array of field keys) so the
  // blank reads as deliberate. Contracts: no issue row is ever auto-created
  // (six instrument rows would bury the one real hard-down, and an auto-write
  // with a tech's name on it is how trust dies); the derived badge clears by
  // construction when a LATER check fills that field with a real value.
  app.setState({ units: [mkUnit({ id: 'u-gg', klass: 'big', opStatus: 'running' })],
                 shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  app.fn.logVitals('u-gg');
  const fGg = app.document.querySelector('#sheet').innerHTML;
  t.includes(fGg, 'id="v_gaugechip"', 'picker chip renders');
  t.includes(fGg, 'Gauge broken', 'chip says what it means');
  t.includes(fGg, 'id="v_gpanel"', 'inline panel exists (never a second sheet — the form must not lose typed values)');
  app.document.querySelector('#v_notes').value = '';
  app.fn.saveVitals('u-gg');
  let rGg = app.S.reports.filter((x) => x.unitId === 'u-gg').slice(-1)[0];
  t.ok(rGg && rGg.brokenGauges === null, 'nothing flagged saves NULL (got ' + JSON.stringify(rGg && rGg.brokenGauges) + ')');
  const issuesBefore = app.S.issues.length;
  app.fn.logVitals('u-gg');
  app.fn.gaugeT('oil_pressure');
  app.fn.saveVitals('u-gg');
  rGg = app.S.reports.filter((x) => x.unitId === 'u-gg').slice(-1)[0];
  t.deep(rGg.brokenGauges, ['oil_pressure'], 'flagged gauge saves as its field key');
  t.eq(app.S.issues.length, issuesBefore, 'saving a broken-gauge flag NEVER auto-creates an issue row');
  const rowGg = app.fn.toRow('reports', rGg);
  t.deep(rowGg.broken_gauges, ['oil_pressure'], 'persists as broken_gauges');
  t.deep(app.fn.fromRow('reports', rowGg).brokenGauges, ['oil_pressure'], 'round-trips back');
  app.fn.logVitals('u-gg');
  app.fn.saveVitals('u-gg');
  rGg = app.S.reports.filter((x) => x.unitId === 'u-gg').slice(-1)[0];
  t.ok(rGg.brokenGauges === null, 'reopening the form resets the picker — no leak between checks');

  t.group('gauge badge: derived from checks, cleared by construction');
  const uGg = app.S.units.find((x) => x.id === 'u-gg');
  app.S.reports = [{ id: 'g1', unitId: 'u-gg', timestamp: 1000, brokenGauges: ['oil_pressure'] }];
  t.deep(app.fn.brokenGaugesFor(uGg), ['oil_pressure'], 'a flagged gauge reads broken');
  app.S.reports.push({ id: 'g2', unitId: 'u-gg', timestamp: 2000, notes: 'walked by' });
  t.deep(app.fn.brokenGaugesFor(uGg), ['oil_pressure'], 'a later check WITHOUT a value does not clear it');
  app.S.reports.push({ id: 'g3', unitId: 'u-gg', timestamp: 3000, oilPressure: 42 });
  t.deep(app.fn.brokenGaugesFor(uGg), [], 'a later real reading clears it — no resolve flow, nothing mutates');
  app.S.reports.push({ id: 'g4', unitId: 'u-gg', timestamp: 4000, brokenGauges: ['battery_v'], batteryV: 26 });
  t.deep(app.fn.brokenGaugesFor(uGg), ['battery_v'], 'a report that flags AND carries a value: the explicit flag wins; only a LATER reading clears');
  const cardOne = app.fn.unitCard(uGg, 'show-A');
  t.includes(cardOne, 'batt V gauge u/s', 'unit card shows the amber badge');
  app.S.reports.push({ id: 'g5', unitId: 'u-gg', timestamp: 5000, brokenGauges: ['oil_pressure'] });
  t.includes(app.fn.unitCard(uGg, 'show-A'), '2 gauges u/s', 'multiple broken gauges collapse to a count');
  app.S.reports.push({ id: 'g6', unitId: 'u-gg', timestamp: 6000, oilPressure: 40, batteryV: 26.5 });
  t.excludes(app.fn.unitCard(uGg, 'show-A'), 'u/s', 'badge gone once later readings land');

  t.group('gauge picker: "Also file as issue" is the tech\'s tap, with the tech\'s name');
  app.S.reports = [];
  app.fn.logVitals('u-gg');
  app.fn.gaugeT('oil_pressure');
  const nIss = app.S.issues.length, nSe = (app.S.status_events || []).length;
  app.fn.gaugeIssue('u-gg');
  t.eq(app.S.issues.length, nIss + 1, 'one tap files one issue');
  const gi = app.S.issues.slice(-1)[0];
  t.eq(gi.severity, 'maintenance', 'severity is maintenance, never down');
  t.includes(gi.title, 'gauge', 'title names the gauge problem');
  t.includes(gi.title, 'Oil psi', 'title names WHICH gauge');
  t.eq(gi.resolved, false, 'opens unresolved');
  t.eq(gi.techName, 'Mike R.', 'stamped with the tech who tapped');
  t.eq(uGg.opStatus, 'running', 'filing a gauge issue moves nothing — unit status untouched');
  t.eq((app.S.status_events || []).length, nSe, 'and no status event is written');

  t.group('check form: DEF is opt-in per unit — small iron hides it unless flagged');
  // Most skids have no DEF. units.has_def (null = off) gates the field on small
  // iron: hidden, not grayed — the point is a SHORTER form. Big iron unchanged
  // until the per-model spec list exists. The gauge picker follows the field:
  // you can't flag a gauge the machine doesn't have.
  app.setState({ units: [
    mkUnit({ id: 'u-sd', klass: 'small' }),
    mkUnit({ id: 'u-sy', klass: 'small', hasDef: true }),
    mkUnit({ id: 'u-bd', klass: 'big' }),
  ], shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  app.fn.logVitals('u-sd');
  const fSd = app.document.querySelector('#sheet').innerHTML;
  t.excludes(fSd, 'v_def', 'small iron without DEF: no field');
  t.excludes(fSd, 'DEF %', 'and no label');
  t.includes(fSd, 'grid2"><label class="fld"><span class="lb">Fuel %', 'fuel/batt row drops to grid2 — shorter form, not a gap');
  t.excludes(fSd, 'vg_def_pct', 'gauge picker does not offer DEF');
  app.document.querySelector('#v_def').value = '55'; // stale cache from an earlier form must not leak into the save
  app.document.querySelector('#v_notes').value = '';
  app.fn.saveVitals('u-sd');
  let rSd = app.S.reports.filter((x) => x.unitId === 'u-sd').slice(-1)[0];
  t.ok(rSd && rSd.defPct === null, 'no-DEF unit stores NULL even with a stale field value around (got ' + (rSd && rSd.defPct) + ')');
  app.fn.logVitals('u-sy');
  const fSy = app.document.querySelector('#sheet').innerHTML;
  t.includes(fSy, 'v_def', 'small iron WITH has_def: field renders');
  t.includes(fSy, 'grid3"><label class="fld"><span class="lb">Fuel %', 'fuel/batt/DEF row back to grid3');
  t.includes(fSy, 'vg_def_pct', 'gauge picker offers DEF again');
  app.document.querySelector('#v_def').value = '42';
  app.fn.saveVitals('u-sy');
  const rSy = app.S.reports.filter((x) => x.unitId === 'u-sy').slice(-1)[0];
  t.ok(rSy && rSy.defPct === 42, 'and its DEF reading saves (got ' + (rSy && rSy.defPct) + ')');
  app.fn.logVitals('u-bd');
  const fBd = app.document.querySelector('#sheet').innerHTML;
  t.includes(fBd, 'v_def', 'big iron unchanged: DEF renders regardless of has_def');
  t.includes(fBd, 'vg_def_pct', 'big iron picker unchanged');

  t.group('unit edit: Has DEF toggle — small iron only, a machine property not an observation');
  const rowU = app.fn.toRow('units', { id: 'x', hasDef: true });
  t.eq(rowU.has_def, true, 'persists as has_def');
  t.eq(app.fn.fromRow('units', rowU).hasDef, true, 'round-trips back');
  app.fn.editUnit('u-sd');
  t.includes(app.document.querySelector('#sheet').innerHTML, 'id="f_hasdef"', 'toggle renders on small iron');
  app.fn.editUnit('u-bd');
  t.excludes(app.document.querySelector('#sheet').innerHTML, 'id="f_hasdef"', 'big iron shows no toggle — that list arrives separately');
  const uSd = app.S.units.find((x) => x.id === 'u-sd');
  app.fn.editUnit('u-sd');
  app.document.querySelector('#f_serial').value = 'DEFTEST-1';
  app.document.querySelector('#f_tag').value = '';
  app.fn.hasDefT();
  app.fn.saveUnit('u-sd');
  t.eq(uSd.hasDef, true, 'flipped on and saved');
  app.fn.editUnit('u-sd');
  app.fn.saveUnit('u-sd');
  t.eq(uSd.hasDef, true, 'reopening and saving untouched must not silently clear it');
  app.fn.editUnit('u-sd');
  app.fn.hasDefT();
  app.fn.saveUnit('u-sd');
  t.ok(uSd.hasDef == null, 'flipped off saves null — off is absence, not false (got ' + uSd.hasDef + ')');

  t.group('derived load: apparent-power %, at read time, never a kW');
  // Small iron has no kW meter — 52 archive checks carried amps+volts and no
  // load_kw. Derived load % = sqrt(3)*V_LL*(sum legs)/3 / (kVA*1000): apparent
  // power over nameplate, NO power-factor assumption (it cancels against the
  // rating's 0.8). Guards: metered always wins; all three legs required (one
  // leg probably means single-phase, where sqrt(3) is wrong); nothing stored —
  // every input is already stamped on the row.
  const dl = app.fn.derivedLoadPct;
  t.eq(dl({ voltageLL: 480, ampsL1: 60, ampsL2: 60, ampsL3: 60, ratingKva: 100 }), 50,
    'sqrt(3)*480*60 = 49.9 kVA on a 100 -> 50%');
  t.eq(dl({ voltageLL: 208, ampsL1: 272, ampsL2: 45, ampsL3: 200, ratingKva: 125 }), 50,
    'imbalanced legs SUM — 272/45/200 all count');
  t.eq(dl({ voltageLL: 480, ampsL1: 60, ampsL2: 60, ampsL3: 60, ratingKva: 100, loadKw: 30 }), null,
    'metered kW present -> never overridden');
  t.eq(dl({ voltageLL: 480, ampsL1: 60, ampsL2: 60, ampsL3: 60, ratingKva: 100, loadPct: 40 }), null,
    'stored load % present -> never overridden');
  t.eq(dl({ voltageLL: 480, ampsL1: 60, ampsL3: 60, ratingKva: 100 }), null,
    'a missing leg -> no derivation (single-phase guard)');
  t.eq(dl({ ampsL1: 60, ampsL2: 60, ampsL3: 60, ratingKva: 100 }), null, 'no voltage -> null');
  t.eq(dl({ voltageLL: 480, ampsL1: 60, ampsL2: 60, ampsL3: 60 }), null, 'no stamped rating -> null');

  const tNow = Date.now();
  const tbl3 = app.fn.recentChecksTable([
    { id: 'd1', timestamp: tNow, techName: 'Mike R.', voltageLL: 480, ampsL1: 60, ampsL2: 60, ampsL3: 60, ratingKva: 100 },
    { id: 'd2', timestamp: tNow - 3600e3, techName: 'Dana', voltageLL: 480, ampsL1: 50, ampsL2: 50, ampsL3: 50, ratingKva: 100, loadKw: 32, loadPct: 40 },
  ]);
  t.includes(tbl3, 'Load %', 'derived value fills the Load % row');
  t.includes(tbl3, '~50', 'derived reading is marked with ~');
  t.includes(tbl3, 'est', 'and labeled est');
  t.excludes(tbl3, '~40', 'metered reading carries no derived marker');

  t.group('void: filer-only, 10 min, still-latest — the record heals, never rewrites');
  // Void is voided_at/voided_by set on the SAME row (append-only respected, no
  // separate event to race its own check offline). Only the tail of a unit's
  // record is voidable, so nothing downstream ever anchored to a voided row:
  // reportsFor() is the one choke point and every derived reader flows through
  // it — freshness, hours, fuel, trends — while raw data keeps the row marked.
  const T0 = Date.now();
  app.setState({ units: [mkUnit({ id: 'u-vd', klass: 'small', currentHours: 9999 })],
                 shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  app.S.reports = [
    { id: 'v-old', unitId: 'u-vd', techName: 'Mike R.', timestamp: T0 - 20 * 60e3, engineHours: 100 },
    { id: 'v-new', unitId: 'u-vd', techName: 'Mike R.', timestamp: T0 - 2 * 60e3, engineHours: 9999 },
  ];
  const uVd = app.S.units.find((x) => x.id === 'u-vd');
  const cand = app.fn.voidableReport(uVd, null);
  t.ok(cand && cand.id === 'v-new', 'the tech\'s fresh latest check is voidable');
  t.includes(app.fn.paneVitals(uVd), 'Void my check', 'the affordance renders in the vitals pane');
  app.fn.voidCheck('v-new', 'u-vd');
  const rV = app.S.reports.find((x) => x.id === 'v-new');
  t.ok(rV.voidedAt != null, 'row stays, marked voided — never deleted');
  t.eq(rV.voidedBy, 'Mike R.', 'stamped with who voided');
  t.eq(app.S.reports.length, 2, 'append-only: no row removed');
  t.eq(app.fn.reportsFor('u-vd').length, 1, 'voided row leaves every derived reader');
  t.eq(app.fn.lastReport('u-vd').id, 'v-old', 'latest check heals to the prior one');
  t.eq(app.fn.lastRecordedHours(uVd, null).hrs, 100, 'hours guard now compares against the pre-void reading');
  t.eq(uVd.currentHours, 100, 'the cached hours roll back to the surviving reading');
  const rowV = app.fn.toRow('reports', rV);
  t.ok(typeof rowV.voided_at === 'string', 'voided_at persists as ISO (dt-mapped)');
  t.eq(app.fn.fromRow('reports', rowV).voidedAt, rV.voidedAt, 'and round-trips back to ms');
  t.excludes(app.fn.paneVitals(uVd), 'Void my check', 'v-old is 20 min old — outside the window, no affordance');

  app.S.reports.push({ id: 'v-w1', unitId: 'u-vd', techName: 'Dana', timestamp: T0 - 60e3 });
  t.ok(!app.fn.voidableReport(uVd, null), 'someone else\'s check is never yours to void');
  app.S.reports.push({ id: 'v-w2', unitId: 'u-vd', techName: 'Mike R.', timestamp: T0 - 30e3 });
  app.S.issues.push({ id: 'v-i1', unitId: 'u-vd', timestamp: T0, severity: 'cosmetic', title: 'x', resolved: false });
  t.ok(!app.fn.voidableReport(uVd, null), 'a newer issue closes the window — someone built on this check');

  t.group('empty check: two-tap confirm — a visit is real, an accident is not');
  app.setState({ units: [mkUnit({ id: 'u-mt', klass: 'small', opStatus: 'running' })],
                 shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  app.fn.logVitals('u-mt');
  ['v_ll', 'v_ln', 'v_a1', 'v_a2', 'v_a3', 'v_hz', 'v_kw', 'v_ct', 'v_op', 'v_fp', 'v_fuel', 'v_bat', 'v_def', 'v_hrs', 'v_notes'].forEach(
    (fid) => { app.document.querySelector('#' + fid).value = ''; });
  const n0 = app.S.reports.length;
  app.fn.saveVitals('u-mt');
  t.eq(app.S.reports.length, n0, 'first tap on an all-blank check saves nothing');
  app.fn.saveVitals('u-mt');
  t.eq(app.S.reports.length, n0 + 1, 'second tap saves it — a tech standing there is a real record');
  app.fn.logVitals('u-mt');
  app.document.querySelector('#v_ll').value = '480';
  app.fn.saveVitals('u-mt');
  t.eq(app.S.reports.length, n0 + 2, 'any real reading saves on the first tap — happy path untouched');
};
