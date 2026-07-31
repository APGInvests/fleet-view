/**
 * fv_inv_bigiron.js — standing invariants for the Big Iron / TwinPak model.
 *
 * The contract, in one breath: a true TwinPak is ONE NES line item, therefore ONE
 * record with ONE serial and TWO engines. Per-engine hours are DERIVED from
 * engine-tagged checks and never stored merged, because a merged "246h to service"
 * is unanswerable — on which engine? Canonical tags are always 'A'/'B'; the housing
 * label style only changes display, so relabelling never breaks history.
 *
 * The invariant that matters most operationally is BLANK-STATE B: a freshly split
 * Engine B must read "no checks yet" and must never inherit the old merged meter,
 * because inheriting it would manufacture a reading nobody observed.
 *
 * Status follows the same per-engine rule as hours and service, and the chassis
 * aggregates on the FAILURE axis only — any engine down turns the trailer red, any
 * engine running keeps it running, and an unobserved engine never downgrades the
 * chassis. That last clause is load-bearing: without it, every conversion would
 * flip a working machine grey the moment it was converted.
 */
'use strict';
module.exports = async (app, t) => {
  const F = app.fn;
  const btn = (v) => ({ dataset: { v }, classList: { add() {}, remove() {} }, style: {} });
  const clear = (...ids) => ids.forEach((i) => { app.document.getElementById(i).value = ''; });
  const tech = () => Object.assign(F.blankState().settings, { techName: 'Mike R.' });

  /* A true TwinPak: one serial, 1000 kVA package, two 625 kVA engines aboard.
     Flat currentHours=3243 is Engine A's PRE-SPLIT SEED, not a shared meter. */
  const twin = (over) => Object.assign({
    id: 'tw', serial: '1LS01712/14', klass: 'big', kw: 1000, currentHours: 3243,
    opStatus: 'running', locationType: 'show', locationId: 's1', jobMeta: {},
    engines: { style: 'AB', A: { kvaEach: 625, serviceDueHours: 3493 }, B: { kvaEach: 625 } },
  }, over || {});
  const single = (over) => Object.assign({
    id: 'sg', serial: 'A246B12359', klass: 'big', kw: 500, currentHours: 100,
    serviceDueHours: 350, opStatus: 'running', locationType: 'show', locationId: 's1', jobMeta: {},
  }, over || {});
  /* engines with explicit per-engine statuses */
  const engs = (a, b, style) => ({
    style: style || 'AB',
    A: Object.assign({ kvaEach: 625 }, a ? { opStatus: a } : {}),
    B: Object.assign({ kvaEach: 625 }, b ? { opStatus: b } : {}),
  });

  /* ---------------------------------------------------------------- */
  t.group('bigiron: engine/engines survive the row round-trip');
  app.setState({
    units: [twin()],
    reports: [{ id: 'r1', unitId: 'tw', engine: 'B', engineHours: 118, timestamp: 1000 }],
    issues: [{ id: 'i1', unitId: 'tw', engine: 'A', severity: 'down', timestamp: 1000, resolved: false }],
  });
  const ur = F.toRow('units', app.S.units[0]);
  t.ok('engines' in ur, 'units.engines is present in MAPS (absent = silently never persists)');
  t.eq(ur.engines.A.kvaEach, 625, 'per-engine nameplate survives toRow');
  t.eq(ur.engines.style, 'AB', 'label style survives toRow');
  t.eq(F.fromRow('units', ur).engines.B.kvaEach, 625, 'engines survives fromRow');
  const rr = F.toRow('reports', app.S.reports[0]);
  t.eq(rr.engine, 'B', 'reports.engine is present in MAPS');
  t.eq(F.fromRow('reports', rr).engine, 'B', 'reports.engine round-trips');
  const ir = F.toRow('issues', app.S.issues[0]);
  t.eq(ir.engine, 'A', 'issues.engine is present in MAPS');
  t.eq(F.fromRow('issues', ir).engine, 'A', 'issues.engine round-trips');

  /* ---------------------------------------------------------------- */
  t.group('bigiron: BLANK-STATE B — a fresh engine never inherits the merged meter');
  app.setState({ units: [twin()], reports: [] });
  let u = app.S.units[0];
  t.ok(F.isTwin(u), 'engines present => true TwinPak');
  t.eq(F.engHours(u, 'A'), 3243, 'Engine A seeds from the pre-split flat meter');
  t.eq(F.engHours(u, 'B'), null, 'Engine B reads NULL even though flat currentHours=3243');
  t.ok(F.engPreSplit(u, 'A'), "A's hours are flagged pre-split so the UI can label them");

  app.setState({ units: [twin()], reports: [{ id: 'r0', unitId: 'tw', engine: null, engineHours: 3300, timestamp: 2000 }] });
  u = app.S.units[0];
  t.eq(F.engHours(u, 'A'), 3300, 'untagged pre-split history counts for A');
  t.eq(F.engHours(u, 'B'), null, 'untagged pre-split history NEVER counts for B');

  app.setState({ units: [twin()], reports: [
    { id: 'rb', unitId: 'tw', engine: 'B', engineHours: 118, timestamp: 3000 },
    { id: 'ra', unitId: 'tw', engine: null, engineHours: 3300, timestamp: 2000 },
  ] });
  u = app.S.units[0];
  t.eq(F.engHours(u, 'B'), 118, "B reads its own observed meter once someone logs it");
  t.eq(F.engHours(u, 'A'), 3300, "B's reading does not disturb A");

  /* ---------------------------------------------------------------- */
  t.group('bigiron: single-engine units see ZERO churn');
  app.setState({ units: [single()], reports: [] });
  u = app.S.units[0];
  t.eq(F.isTwin(u), false, 'no engines => not a twin');
  t.eq(F.engHours(u, null), 100, 'single-engine hours unchanged');
  t.eq(F.computeStatus(u).label, 'RUNNING', 'single-engine label byte-identical (no attribution)');
  t.eq(F.serviceState(u).remaining, 250, 'single-engine service math unchanged');
  app.setState({ units: [single({ opStatus: 'down' })], reports: [] });
  t.eq(F.computeStatus(app.S.units[0]).label, 'DOWN', 'single-engine DOWN label byte-identical');

  /* ---------------------------------------------------------------- */
  t.group('bigiron: chassis status aggregates on the failure axis');
  const chassis = (a, b, style) => {
    app.setState({ units: [twin({ engines: engs(a, b, style) })], reports: [] });
    return F.computeStatus(app.S.units[0]);
  };
  t.eq(chassis('running', 'running').label, 'RUNNING', 'both running => RUNNING');
  t.eq(chassis('running', 'staged').color, 'green', 'one on load, one on standby is NOT idle => green');
  t.eq(chassis('running', 'staged').label, 'RUNNING', 'standby engine does not make the trailer staged');
  t.eq(chassis('staged', 'staged').label, 'STAGED', 'nothing running => STAGED');
  t.eq(chassis('running', 'down').color, 'red', 'any engine down => trailer red');
  t.eq(chassis('down', 'down').color, 'red', 'both down => red');

  t.group('bigiron: half-down must not read as fully dead');
  t.eq(chassis('running', 'down').label, 'GEN B DOWN', 'half-down names the engine');
  t.eq(chassis('down', 'running').label, 'GEN A DOWN', 'attribution follows the actual down engine');
  t.eq(chassis('down', 'down').label, 'DOWN', 'fully down stays plain DOWN');
  t.eq(chassis('running', 'down', '12').label, 'GEN 2 DOWN', 'label style 12 renders Gen 2, tag stays canonical B');
  t.includes(JSON.stringify(chassis('running', 'down').reasons), 'Gen B down', 'reason chip names the down engine');

  t.group('bigiron: an unobserved engine never downgrades the chassis');
  /* The fresh-conversion shape: A inherits the pre-split running status, B has
     never been observed. This must stay green, or all seven conversions go grey. */
  app.setState({ units: [twin({ engines: { style: 'AB', A: { kvaEach: 625 }, B: { kvaEach: 625 } } })], reports: [] });
  u = app.S.units[0];
  t.eq(F.engStatus(u, 'A'), 'running', 'A inherits the pre-split chassis status');
  t.eq(F.engStatus(u, 'B'), null, 'B is unobserved, not staged-by-assumption');
  t.eq(F.computeStatus(u).color, 'green', 'a freshly converted running TwinPak stays green');
  t.eq(F.chassisStatus(u), 'running', 'chassis ignores the unobserved engine');

  /* ---------------------------------------------------------------- */
  t.group('bigiron: worst engine drives service, per engine');
  const svc = (aDue, bDue, aHrs, bHrs) => {
    app.setState({
      units: [twin({ currentHours: aHrs, engines: { style: 'AB', A: { kvaEach: 625, serviceDueHours: aDue }, B: { kvaEach: 625, serviceDueHours: bDue } } })],
      reports: bHrs == null ? [] : [{ id: 'rb', unitId: 'tw', engine: 'B', engineHours: bHrs, timestamp: 3000 }],
    });
    return app.S.units[0];
  };
  u = svc(3493, 130, 3243, 118);
  t.eq(F.engServiceState(u, 'A').remaining, 250, 'A countdown is A hours vs A target');
  t.eq(F.engServiceState(u, 'B').remaining, 12, 'B countdown is B hours vs B target');
  t.eq(F.serviceState(u).state, 'soon', 'unit-level service state follows the WORST engine');
  t.eq(F.worstServiceEngine(u).engine, 'B', 'worst engine identified for attribution');
  t.eq(F.computeStatus(u).color, 'orange', 'worst engine drives the unit chip');
  t.includes(JSON.stringify(F.computeStatus(u).reasons), 'Gen B 12h to service', 'service reason names the engine');
  u = svc(3493, 100, 3243, 118);
  t.eq(F.engServiceState(u, 'B').state, 'over', 'B is over service');
  t.eq(F.serviceState(u).state, 'over', 'over outranks ok');
  t.includes(JSON.stringify(F.computeStatus(u).reasons), 'Gen B over service 18h', 'over-service reason names the engine');
  /* boundaries at warnHours=20 */
  t.eq(F.engServiceState(svc(3493, 138, 3243, 118), 'B').state, 'soon', 'remaining exactly 20 => soon');
  t.eq(F.engServiceState(svc(3493, 139, 3243, 118), 'B').state, 'ok', 'remaining 21 => ok');
  t.eq(F.engServiceState(svc(3493, 118, 3243, 118), 'B').state, 'over', 'remaining 0 => over');
  /* an unset target is unknown, and unknown never downgrades */
  u = svc(3493, null, 3243, 118);
  t.eq(F.engServiceState(u, 'B').state, 'unknown', 'no target on B => unknown');
  t.eq(F.serviceState(u).state, 'ok', 'unknown does not downgrade a healthy A');

  /* ---------------------------------------------------------------- */
  t.group('bigiron: staleness is per-engine');
  const ago = (h) => Date.now() - h * 3600e3;
  const stale = (aTs, bTs, eStat) => {
    const reps = [];
    if (aTs != null) reps.push({ id: 'ra', unitId: 'tw', engine: 'A', engineHours: 10, timestamp: aTs });
    if (bTs != null) reps.push({ id: 'rb', unitId: 'tw', engine: 'B', engineHours: 20, timestamp: bTs });
    app.setState({ units: [twin({ engines: engs(eStat ? eStat[0] : 'running', eStat ? eStat[1] : 'running') })], reports: reps });
    return app.S.units[0];
  };
  t.eq(F.isStale(stale(ago(1), ago(1))), false, 'both engines checked recently => not stale');
  t.eq(F.isStale(stale(ago(1), null)), true, 'A fresh but B never checked => the unit is overdue');
  t.eq(F.engStale(stale(ago(1), null), 'B'), true, 'the unobserved engine is the overdue one');
  t.eq(F.engStale(stale(ago(1), null), 'A'), false, 'the checked engine is not overdue');
  t.eq(F.isStale(stale(ago(20), ago(1))), true, 'A stale => the unit is overdue even though B is fresh');
  t.eq(F.isStale(stale(ago(1), null, ['running', 'down'])), false, 'a DOWN engine is exempt from stale, like a down unit');
  t.eq(F.isStale(stale(ago(20), null, ['running', 'down'])), true, 'a stale RUNNING engine still owes a check');

  /* ---------------------------------------------------------------- */
  t.group('bigiron: per-engine load % uses the nameplate, never kw/2');
  app.setState({ settings: tech(), units: [twin()], reports: [] });
  u = app.S.units[0];
  t.eq(F.engKva(u, 'A'), 625, "divisor is the engine's own nameplate kVA");
  t.ok(F.engKva(u, 'A') !== u.kw / 2, 'divisor is NOT half the package rating (paralleling derates)');
  t.eq(F.engKva(app.S.units[0], 'B'), 625, 'B has its own nameplate');
  clear('v_kw', 'v_hrs', 'v_notes');
  F.logVitals('tw', 'A');
  app.document.getElementById('v_kw').value = '400';
  F.saveVitals('tw', 'A');
  let r = app.S.reports[0];
  t.eq(r.engine, 'A', 'the check is tagged with the engine it was taken on');
  t.eq(r.loadPct, 80, 'load% = 400kW / (625kVA x 0.8) = 80 (kw/2 would read 100)');
  /* kvaEach unset => no guess, the existing hint path takes over */
  app.setState({ settings: tech(), units: [twin({ engines: { style: 'AB', A: {}, B: {} } })], reports: [] });
  clear('v_kw', 'v_hrs', 'v_notes');
  F.logVitals('tw', 'A');
  app.document.getElementById('v_kw').value = '400';
  F.saveVitals('tw', 'A');
  t.eq(app.S.reports[0].loadPct, null, 'no nameplate => load% is null, never guessed');

  /* ---------------------------------------------------------------- */
  t.group('bigiron: a TwinPak check writes the engine, not the chassis meter');
  app.setState({ settings: tech(), units: [twin()], reports: [] });
  clear('v_kw', 'v_hrs', 'v_notes');
  F.logVitals('tw', 'A');
  app.document.getElementById('v_hrs').value = '3310';
  F.saveVitals('tw', 'A');
  t.eq(app.S.units[0].currentHours, 3243, 'the flat pre-split seed is NOT overwritten on a twin');
  t.eq(F.engHours(app.S.units[0], 'A'), 3310, "A's hours now come from the new check");
  t.eq(F.engHours(app.S.units[0], 'B'), null, 'B is still untouched');
  /* status lands on the engine, and the chassis derives from it */
  F.vseg(btn('down'));
  app.S.reports.forEach((x) => { x.timestamp -= 60000; });
  clear('v_hrs');
  F.saveVitals('tw', 'B');
  t.eq(F.engStatus(app.S.units[0], 'B'), 'down', 'the check records status on the engine it was taken on');
  t.eq(F.engStatus(app.S.units[0], 'A'), 'running', "the other engine's status is untouched");
  t.eq(F.computeStatus(app.S.units[0]).label, 'GEN B DOWN', 'chassis derives, and says which engine');

  t.group('bigiron: a single-engine check still writes the chassis (no churn)');
  app.setState({ settings: tech(), units: [single()], reports: [] });
  clear('v_kw', 'v_hrs', 'v_notes');
  F.logVitals('sg');
  F.vseg(btn('running'));
  app.document.getElementById('v_hrs').value = '150';
  F.saveVitals('sg');
  t.eq(app.S.units[0].currentHours, 150, 'single-engine check still updates the flat meter');
  t.eq(app.S.units[0].opStatus, 'running', 'single-engine check still writes chassis opStatus');
  t.eq(app.S.reports[0].engine, null, 'a single-engine check is tagged null, not A');

  /* ---------------------------------------------------------------- */
  t.group('bigiron: honest defaults — the form starts on THAT engine\'s status');
  app.setState({ settings: tech(), units: [twin({ engines: engs('running', 'down') })], reports: [] });
  clear('v_kw', 'v_hrs', 'v_notes');
  F.logVitals('tw', 'B');
  let sheet = app.document.getElementById('sheet').innerHTML;
  t.includes(sheet, 'Gen B', 'the form says which engine is being checked');
  t.includes(sheet, 'data-v="down" class="on"', "B's form pre-selects DOWN, B's own status");
  F.logVitals('tw', 'A');
  sheet = app.document.getElementById('sheet').innerHTML;
  t.includes(sheet, 'data-v="running" class="on"', "A's form pre-selects RUNNING, A's own status");
  /* the pre-split meter must not be offered as a starting value on any engine */
  app.setState({ settings: tech(), units: [twin()], reports: [] });
  F.logVitals('tw', 'B');
  sheet = app.document.getElementById('sheet').innerHTML;
  t.includes(sheet, 'id="v_hrs" type="number" inputmode="decimal" value=""', 'engine hours start BLANK on a twin, never prefilled with the merged meter');
  t.excludes(sheet, 'value="3243"', 'the merged meter value appears nowhere in the form');

  /* ---------------------------------------------------------------- */
  t.group('bigiron: no new required field on a routine check');
  app.setState({ settings: tech(), units: [twin()], reports: [] });
  clear('v_kw', 'v_hrs', 'v_notes', 'v_ll', 'v_ln', 'v_a1', 'v_a2', 'v_a3', 'v_hz', 'v_ct', 'v_op', 'v_fuel', 'v_bat', 'v_def');
  F.logVitals('tw', 'A');
  F.saveVitals('tw', 'A');
  t.eq(app.S.reports.length, 1, 'a completely blank check on a TwinPak still saves');
  r = app.S.reports[0];
  t.eq(r.engineHours, null, 'blank hours stay blank, not zero');
  t.eq(r.engine, 'A', 'the engine tag is still recorded');

  /* ---------------------------------------------------------------- */
  t.group('bigiron: engine-tagged issues');
  app.setState({ units: [twin({ engines: engs('running', 'running') })], reports: [],
    issues: [{ id: 'i9', unitId: 'tw', engine: 'B', severity: 'down', title: 'No start', timestamp: 1000, resolved: false }] });
  u = app.S.units[0];
  t.eq(F.computeStatus(u).color, 'red', 'an open engine-tagged down issue turns the trailer red');
  t.includes(JSON.stringify(F.computeStatus(u).reasons), 'Gen B · No start', 'the issue reason names its engine');
  app.setState({ settings: tech(), units: [twin({ engines: engs('running', 'running') })], reports: [], issues: [] });
  clear('i_title', 'i_text');
  F.flagIssue('tw', 'B');
  F.iseg(btn('down'));
  F.saveIssue('tw', 'B');
  t.eq(app.S.issues[0].engine, 'B', 'the flagged issue carries its engine');
  t.eq(F.engStatus(app.S.units[0], 'B'), 'down', 'a down issue downs THAT engine');
  t.eq(F.engStatus(app.S.units[0], 'A'), 'running', 'the other engine keeps running');
  t.eq(F.computeStatus(app.S.units[0]).label, 'GEN B DOWN', 'and the trailer reads half-down, not dead');

  /* ---------------------------------------------------------------- */
  t.group('bigiron: per-engine service targets are stored, not derived');
  app.setState({ settings: tech(), units: [twin()], reports: [] });
  clear('s_due', 'ms_at', 'ms_int');
  F.editService('tw', 'B');
  sheet = app.document.getElementById('sheet').innerHTML;
  t.includes(sheet, 'No checks yet', "B's derived hours show as No checks yet, not an editable field");
  t.excludes(sheet, 'id="s_cur"', 'derived hours are NOT an editable field on a twin (corrections are new checks)');
  app.document.getElementById('s_due').value = '400';
  F.saveService('tw', 'B');
  t.eq(app.S.units[0].engines.B.serviceDueHours, 400, "the target lands on B's engine record");
  t.ok(app.S.units[0].serviceDueHours == null, 'the flat target is left alone on a twin (never set, never written)');
  t.eq(app.S.units[0].engines.A.serviceDueHours, 3493, "A's target is untouched");
  /* mark serviced writes the engine, never the chassis meter */
  app.setState({ settings: tech(), units: [twin()], reports: [{ id: 'rb', unitId: 'tw', engine: 'B', engineHours: 118, timestamp: 3000 }] });
  clear('ms_at', 'ms_int');
  F.markServiced('tw', 'B');
  app.document.getElementById('ms_at').value = '118';
  app.document.getElementById('ms_int').value = '250';
  F.doServiced('tw', 'B');
  u = app.S.units[0];
  t.eq(u.engines.B.lastServiceHours, 118, 'last service hours stored per engine');
  t.eq(u.engines.B.serviceDueHours, 368, 'next target = 118 + 250, per engine');
  t.eq(u.currentHours, 3243, 'marking an engine serviced does not touch the chassis meter');
  t.eq(F.engHours(u, 'B'), 118, "B's hours still come from its own check");

  /* ---------------------------------------------------------------- */
  t.group('bigiron: status is not placement (rule 1 still holds)');
  app.setState({ settings: tech(), units: [twin()], reports: [], movements: [] });
  clear('v_kw', 'v_hrs', 'v_notes');
  F.logVitals('tw', 'B');
  F.vseg(btn('down'));
  F.saveVitals('tw', 'B');
  t.eq(app.S.movements.length, 0, 'downing an engine writes no movement');
  t.eq(F.unitGps(app.S.units[0]), null, 'and no map pin');
  t.eq(app.S.units[0].locationId, 's1', 'placement untouched');
  t.eq(app.S.reports[app.S.reports.length - 1].gps, null, 'the check stores no GPS, by design');
};
