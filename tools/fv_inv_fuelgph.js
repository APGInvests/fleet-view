/**
 * fv_inv_fuelgph.js — standing invariants for the fuel-rate (gal/hr) vital.
 *
 * GPH is an OBSERVED reading: nearly every big-iron controller displays it and
 * crews were typing it into check notes ("10.6 gallons per hour" — 26 notes,
 * Head Trip, Oct 2026) because the form had no field. It mirrors fuel psi
 * exactly: big-iron only, lives inside the running-only electrical collapse,
 * never prefilled, always optional, gauge-broken-flaggable, stored per check
 * row (per ENGINE on twins — the controller reports each engine's own rate).
 *
 * Label doctrine (Andy, 2026-10-09): "gal/hr" must be visible on the form —
 * it's what the controllers show and what crews say. No range flag at launch:
 * GPH is a function of load, so a fixed lo/hi band would be dishonest.
 *
 * Fuel-tank doctrine (Andy, 2026-10-09, HANDOFF §3 fuel-gph entry): born twins
 * share ONE tank — chassis burn = A + B, and a tank-level drop can never be
 * attributed to one engine. Paired singles each have their OWN tank. Any
 * future consumption analysis must branch on `engines` (born-twin doctrine)
 * or shared-tank twins come out roughly double. Capture stays per engine;
 * no combined-GPH field or echo may ever exist on a capture surface.
 */
'use strict';
const fs = require('fs');
const path = require('path');
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    opStatus: 'running', locationType: 'show', locationId: 'show-A', photos: [], jobMeta: {}, updatedAt: 1 }, o);

  t.group('fuel gph: big iron only, crew vocabulary on the label');
  app.setState({ units: [mkUnit({ id: 'u-big', klass: 'big' }), mkUnit({ id: 'u-small', klass: 'small' })],
                 shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  app.fn.logVitals('u-big');
  const bigForm = app.document.querySelector('#sheet').innerHTML;
  t.includes(bigForm, 'Fuel rate (gal/hr)', 'big iron form has the field, gal/hr visible in the label');
  t.includes(bigForm, 'v_gph', 'field wired to v_gph');
  app.fn.logVitals('u-small');
  const smallForm = app.document.querySelector('#sheet').innerHTML;
  t.excludes(smallForm, 'gal/hr', 'small iron form has no gph field');
  t.excludes(smallForm, 'v_gph', 'small iron form has no gph input');

  t.group('fuel gph: saves, round-trips, small iron stores null');
  app.fn.logVitals('u-big');
  t.eq(app.document.querySelector('#v_gph').value, '', 'field opens blank — never prefilled (observation rule)');
  app.document.querySelector('#v_gph').value = '9.8';
  app.fn.saveVitals('u-big');
  const r = app.S.reports.find((x) => x.unitId === 'u-big');
  t.ok(r && r.fuelGph === 9.8, 'typed 9.8 stored as fuelGph (got ' + (r && r.fuelGph) + ')');
  const row = app.fn.toRow('reports', r);
  t.eq(row.fuel_gph, 9.8, 'persists as fuel_gph');
  t.eq(app.fn.fromRow('reports', row).fuelGph, 9.8, 'round-trips back');
  app.fn.logVitals('u-small');
  app.document.querySelector('#v_hz').value = '60'; // a real reading — blank checks arm the two-tap confirm instead
  app.fn.saveVitals('u-small');
  const rs = app.S.reports.find((x) => x.unitId === 'u-small');
  t.ok(rs && rs.fuelGph == null, 'small iron check stores null, never a value');

  t.group('fuel gph: a gph-only check is a real check, not a blank one');
  // The field must count toward "something was observed" — a tech who reads
  // only the fuel rate off the controller must not be challenged as blank.
  app.setState({ units: [mkUnit({ id: 'u-only', klass: 'big' })], shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  app.fn.logVitals('u-only');
  app.document.querySelector('#v_gph').value = '7.1';
  app.fn.saveVitals('u-only');
  t.eq(app.S.reports.filter((x) => x.unitId === 'u-only').length, 1,
    'gph-only save lands on the first tap (no two-tap blank confirm)');

  t.group('fuel gph: lives inside the running-only electrical collapse');
  app.setState({ units: [mkUnit({ id: 'u-run', klass: 'big', opStatus: 'running' })], shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  const fakeBtn = (v) => ({ dataset: { v }, classList: { add() {}, remove() {} }, style: {} });
  app.fn.logVitals('u-run');
  const f1 = app.document.querySelector('#sheet').innerHTML;
  const elecBody = f1.slice(f1.indexOf('id="v_elec"'), f1.indexOf('id="v_elecOff"'));
  t.includes(elecBody, 'v_gph', 'gph collapses with the electricals — running only for free');
  app.document.querySelector('#v_gph').value = '10.5';
  app.fn.vseg(fakeBtn('staged'));
  t.eq(app.document.querySelector('#v_elec').style.display, 'none', 'staged collapses the grid');
  t.eq(app.document.querySelector('#v_gph').value, '10.5', 'collapse never clears a typed gph');
  app.fn.vseg(fakeBtn('running'));
  t.eq(app.document.querySelector('#v_gph').value, '10.5', 'typed gph survives the round trip');

  t.group('fuel gph: per engine on twins — the controller reports each engine\'s own rate');
  // Field evidence (Head Trip 2026-10-09): TGD62510 A 10.5 / B 10.6 — distinct
  // values per engine on one chassis. Capture rides the existing engine-tagged
  // check lanes; chassis burn = A + B is analysis-time ONLY (shared tank).
  app.setState({ units: [mkUnit({ id: 'u-tw', klass: 'big', kw: 500,
    engines: { style: 'AB', A: { kvaEach: 438 }, B: { kvaEach: 438 } } })], shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  app.fn.logVitals('u-tw', 'A');
  app.document.querySelector('#v_gph').value = '10.5';
  app.fn.saveVitals('u-tw', 'A');
  app.fn.logVitals('u-tw', 'B');
  app.document.querySelector('#v_gph').value = '10.6';
  app.fn.saveVitals('u-tw', 'B');
  const twA = app.S.reports.find((x) => x.unitId === 'u-tw' && x.engine === 'A');
  const twB = app.S.reports.find((x) => x.unitId === 'u-tw' && x.engine === 'B');
  t.ok(twA && twA.fuelGph === 10.5, 'engine A check carries its own gph');
  t.ok(twB && twB.fuelGph === 10.6, 'engine B check carries its own gph');
  const twForm = (() => { app.fn.logVitals('u-tw', 'A'); return app.document.querySelector('#sheet').innerHTML; })();
  t.excludes(twForm, '21.1', 'no combined-gph number ever renders on a capture surface');

  t.group('fuel gph: gauge-broken chip covers it (controllers do fail)');
  app.setState({ units: [mkUnit({ id: 'u-g', klass: 'big' }), mkUnit({ id: 'u-gs', klass: 'small' })],
                 shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  app.fn.logVitals('u-g');
  const gForm = app.document.querySelector('#sheet').innerHTML;
  t.includes(gForm, 'vg_fuel_gph', 'gauge panel offers the fuel-rate gauge on big iron');
  app.fn.logVitals('u-gs');
  t.excludes(app.document.querySelector('#sheet').innerHTML, 'vg_fuel_gph', 'gauge panel never offers it on small iron');
  const issuesBefore = app.S.issues.length;
  app.fn.logVitals('u-g');
  app.fn.gaugeT('fuel_gph');
  app.fn.saveVitals('u-g');
  const gr = app.S.reports.find((x) => x.unitId === 'u-g');
  t.ok(gr && Array.isArray(gr.brokenGauges) && gr.brokenGauges.includes('fuel_gph'),
    'flag saves into broken_gauges');
  t.eq(app.S.issues.length, issuesBefore, 'flagging never auto-creates an issue row');
  t.ok(app.fn.brokenGaugesFor(app.fn.unitById('u-g')).includes('fuel_gph'),
    'derived badge sees the broken fuel-rate gauge');
  app.S.reports.unshift({ id: 'r-heal', unitId: 'u-g', techName: 'Dana', timestamp: Date.now() + 60e3, fuelGph: 8.2 });
  t.ok(!app.fn.brokenGaugesFor(app.fn.unitById('u-g')).includes('fuel_gph'),
    'a later real reading clears the badge by construction — no resolve flow');

  t.group('fuel gph: read surfaces mirror fuel psi');
  const now = Date.now();
  app.setState({ units: [mkUnit({ id: 'u-rd', klass: 'big' })], shows: [{ id: 'show-A', name: 'A' }] });
  app.S.reports = [
    { id: 'r1', unitId: 'u-rd', techName: 'Mike R.', timestamp: now, fuelGph: 9.9 },
    { id: 'r2', unitId: 'u-rd', techName: 'Dana', timestamp: now - 3600e3, fuelGph: 12.3 },
  ];
  const tbl = app.fn.recentChecksTable(app.fn.reportsFor('u-rd'));
  t.includes(tbl, 'Gal/hr', 'Recent-checks table grows the row when values exist');
  t.includes(tbl, '▼', 'trend arrow rendered (9.9 vs 12.3)');
  t.excludes(tbl, 'var(--red)', 'arrow is neutral, not colour-judged');
  const pane = app.fn.paneVitals(app.fn.unitById('u-rd'));
  t.includes(pane, 'Fuel rate', 'latest-check card shows the reading');
  t.includes(pane, 'gal/hr', 'latest-check card speaks gal/hr');
  app.S.reports.forEach((x) => { delete x.fuelGph; });
  t.excludes(app.fn.recentChecksTable(app.fn.reportsFor('u-rd')), 'Gal/hr',
    'row absent when no check ever recorded it');

  t.group('fuel gph: archive export carries the column');
  const arch = fs.readFileSync(path.join(__dirname, 'fv_archive.js'), 'utf8');
  t.includes(arch, "'fuel_gph'", 'checks.csv header exports fuel_gph');
  t.includes(arch, 'r.fuel_gph', 'checks.csv row exports the value');
  t.includes(arch, 'reports.fuel_gph', 'data dictionary documents it');
  t.includes(arch, 'A + B', 'dictionary states the shared-tank doctrine (chassis burn = A + B)');
};
