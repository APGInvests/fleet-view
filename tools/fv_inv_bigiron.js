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

  /* ---------------------------------------------------------------- */
  /* Rule 2, paired: the hours input is blank on EVERY unit, and the identity
     header supplies the previous reading as reference. The pairing is the
     invariant — blanking without the reference just loses information, and a
     prefilled reading lets someone re-save a stale value, freezing the service
     clock while the engine runs. Neither half ships alone. */
  t.group('bigiron: identity header + blank hours on ALL units (rule 2)');
  app.setState({ settings: tech(), units: [single({ currentHours: 900 })], reports: [
    { id: 'r1', unitId: 'sg', engine: null, engineHours: 900, timestamp: Date.now() - 3600e3, techName: 'Dana P.' }] });
  clear('v_hrs');
  F.logVitals('sg');
  let sh = app.document.getElementById('sheet').innerHTML;
  t.includes(sh, 'LAST RECORDED', 'identity header is present on a single-engine unit too');
  t.includes(sh, '900 h', 'header shows the last recorded reading as REFERENCE');
  t.includes(sh, 'A246B12359', 'header names the serial actually being checked');
  t.includes(sh, 'Dana P.', 'header says who took that reading');
  t.includes(sh, 'value="" placeholder="read the meter"', 'hours input is BLANK on a single-engine unit');
  t.excludes(sh, 'value="900"', 'the stored reading is never prefilled into the input');
  app.setState({ settings: tech(), units: [single({ currentHours: null })], reports: [] });
  F.logVitals('sg');
  sh = app.document.getElementById('sheet').innerHTML;
  t.includes(sh, 'No checks yet', 'header says No checks yet when nothing was ever recorded');
  /* on a TwinPak the header must name the engine and show only ITS reference */
  app.setState({ settings: tech(), units: [twin()], reports: [
    { id: 'rb', unitId: 'tw', engine: 'B', engineHours: 118, timestamp: 3000 }] });
  F.logVitals('tw', 'B');
  sh = app.document.getElementById('sheet').innerHTML;
  t.includes(sh, '118 h', "B's header shows B's own reading");
  t.excludes(sh, '3,243', "B's header never shows the merged pre-split meter");
  F.logVitals('tw', 'A');
  sh = app.document.getElementById('sheet').innerHTML;
  t.includes(sh, 'pre-split', "A's header labels its inherited reading pre-split");

  /* ---------------------------------------------------------------- */
  t.group('bigiron: one check button per engine, same tap count');
  app.setState({ settings: tech(), units: [twin()], reports: [] });
  F.openUnit('tw');
  sh = app.document.getElementById('sheet').innerHTML;
  t.eq((sh.match(/logVitals\('tw','A'\)/g) || []).length, 1, 'exactly one Check Gen A button');
  t.eq((sh.match(/logVitals\('tw','B'\)/g) || []).length, 1, 'exactly one Check Gen B button');
  t.excludes(sh, "logVitals('tw')", 'no chassis-level Log check button on a TwinPak');
  t.includes(sh, 'Check Gen A', 'the button names the engine before you type anything');
  t.includes(sh, 'NOT YET CHECKED', 'an unobserved engine says so on its own row');
  t.includes(sh, "flagIssue('tw','A')", 'flagging an issue is per-engine too');
  app.setState({ settings: tech(), units: [single()], reports: [] });
  F.openUnit('sg');
  sh = app.document.getElementById('sheet').innerHTML;
  t.includes(sh, "logVitals('sg')", 'a single-engine unit keeps its one Log check button');
  t.eq((sh.match(/logVitals\(/g) || []).length, 1, 'exactly one check button on a single-engine unit');

  t.group('bigiron: the half-down split is visible without opening anything');
  app.setState({ settings: tech(), units: [twin({ engines: engs('running', 'down') })], reports: [] });
  F.openUnit('tw');
  sh = app.document.getElementById('sheet').innerHTML;
  t.includes(sh, 'GEN B DOWN', 'the chassis header names the down engine');
  t.includes(sh, '&#9679; RUNNING', "Gen A's row still reads RUNNING");
  t.includes(sh, '&#9679; DOWN', "Gen B's row reads DOWN, side by side with A");

  /* ---------------------------------------------------------------- */
  t.group('bigiron: vitals pane filters by engine');
  app.setState({ settings: tech(), units: [twin()], reports: [
    { id: 'ra', unitId: 'tw', engine: null, engineHours: 3300, timestamp: 2000, techName: 'Old Hand', voltageLL: 480 },
    { id: 'rb', unitId: 'tw', engine: 'B', engineHours: 118, timestamp: 3000, techName: 'Dana P.', voltageLL: 478 }] });
  F.openUnit('tw');
  F.setVitalsEng('tw', 'B');
  sh = app.document.getElementById('sheet').innerHTML;
  t.includes(sh, 'Dana P.', "the B filter shows B's checks");
  t.excludes(sh, 'Old Hand', 'the B filter hides pre-split history entirely');
  F.setVitalsEng('tw', 'A');
  sh = app.document.getElementById('sheet').innerHTML;
  t.includes(sh, 'Old Hand', 'the A filter includes pre-split history');
  t.includes(sh, 'margin-left:6px">pre-split<', 'and chips those rows pre-split so nobody misreads them');
  t.excludes(sh, 'Dana P.', "the A filter hides B's checks");
  F.setVitalsEng('tw', '');
  sh = app.document.getElementById('sheet').innerHTML;
  t.includes(sh, 'Old Hand', 'Both shows everything');
  t.includes(sh, 'Dana P.', 'Both shows everything (B too)');

  /* ---------------------------------------------------------------- */
  t.group('bigiron: service pane is per-engine, no chassis path left');
  app.setState({ units: [twin()], reports: [] });
  u = app.S.units[0];
  const pane = F.paneService(u, F.serviceState(u));
  t.includes(pane, "editService('tw','A')", 'Gen A has its own edit-target action');
  t.includes(pane, "markServiced('tw','B')", 'Gen B has its own mark-serviced action');
  t.excludes(pane, "editService('tw','')", 'no chassis-level service action survives on a TwinPak');
  t.includes(pane, 'Gen A', 'countdown cards are labelled per engine');
  t.includes(pane, 'No checks yet', "an engine with no observed meter says so instead of showing a number");
  app.setState({ units: [single()], reports: [] });
  const p2 = F.paneService(app.S.units[0], F.serviceState(app.S.units[0]));
  t.includes(p2, "editService('sg','')", 'a single-engine unit still gets the chassis path');
  t.includes(p2, 'Service countdown', 'and keeps its single countdown card');

  t.group('bigiron: issues pane chips the engine');
  app.setState({ units: [twin()], issues: [
    { id: 'i1', unitId: 'tw', engine: 'B', severity: 'down', title: 'No start', timestamp: 2, resolved: false },
    { id: 'i2', unitId: 'tw', engine: null, severity: 'cosmetic', title: 'Dent', timestamp: 1, resolved: false }] });
  const pi = F.paneIssues(app.S.units[0]);
  t.includes(pi, '>Gen B<', 'an engine-tagged issue carries its engine chip');
  t.includes(pi, 'Dent', 'an untagged legacy issue still renders, unchipped');

  /* ---------------------------------------------------------------- */
  t.group('bigiron: conversion needs both nameplates, logs intake as checks');
  const FORM = ['f_serial', 'f_tag', 'f_weight', 'f_make', 'f_model', 'f_kw', 'f_breaker',
    'f_trailer', 'f_fuel', 'f_tank', 'f_hours', 'f_svc', 'f_area', 'f_notes',
    'f_kvaA', 'f_kvaB', 'f_hrsA', 'f_hrsB'];
  const convFixture = () => {
    app.setState({ settings: tech(), shows: [{ id: 's1', name: 'Fest' }], currentShowId: 's1', reports: [],
      units: [{ id: 'cv', serial: 'TGD62501', klass: 'big', kw: 1000, currentHours: 3243,
        opStatus: 'running', locationType: 'show', locationId: 's1', jobMeta: {} }] });
    clear(...FORM);
    F.editUnit('cv');
    app.document.getElementById('f_serial').value = 'TGD62501';
    app.document.getElementById('f_kw').value = '1000';
    app.document.getElementById('f_hours').value = '3243';
  };
  convFixture();
  F.tpseg(btn('yes'));
  F.lsseg(btn('12'));
  F.saveUnit('cv');                       // nameplates deliberately blank
  t.ok(!F.isTwin(app.S.units[0]), 'conversion REFUSES without both nameplate kVAs');
  t.eq(app.S.reports.length, 0, 'and manufactures no intake readings on the way out');

  app.document.getElementById('f_kvaA').value = '625';
  app.document.getElementById('f_kvaB').value = '625';
  app.document.getElementById('f_hrsB').value = '118';
  F.saveUnit('cv');
  u = app.S.units[0];
  t.ok(F.isTwin(u), 'conversion lands once both nameplates are read');
  t.eq(u.engines.style, '12', 'the housing label style is stored');
  t.eq(F.engName(u, 'B'), 'Gen 2', 'and drives display, while the tag stays canonical B');
  t.eq(F.engKva(u, 'A'), 625, "A's nameplate stored");
  t.eq(F.engKva(u, 'B'), 625, "B's nameplate stored (not 500 = kw/2)");
  const intake = app.S.reports.filter((x) => x.engine === 'B');
  t.eq(intake.length, 1, "B's meter reading became a CHECK, not a column write");
  t.eq(intake[0].engineHours, 118, 'with the observed value');
  t.eq(intake[0].techName, 'Mike R.', 'stamped with the tech who read it');
  t.includes(intake[0].notes, 'Intake', 'and labelled as an intake reading');
  t.eq(app.S.reports.filter((x) => x.engine === 'A').length, 0, 'a blank intake field creates nothing');
  t.eq(F.engHours(u, 'B'), 118, "B's hours now derive from its own intake check");
  t.eq(F.engHours(u, 'A'), 3243, 'A keeps the pre-split seed');
  t.ok(F.engPreSplit(u, 'A'), "and A's reading is labelled pre-split");
  t.eq(u.currentHours, 3243, 'the flat seed is preserved, not cleared');
  t.eq(F.computeStatus(u).color, 'green', 'a converted running TwinPak is still green');

  t.group('bigiron: re-saving a converted unit does not duplicate intake readings');
  clear('f_hrsA', 'f_hrsB');
  app.document.getElementById('f_serial').value = 'TGD62501';
  app.document.getElementById('f_kw').value = '1000';
  app.document.getElementById('f_hours').value = '3243';
  app.document.getElementById('f_kvaA').value = '625';
  app.document.getElementById('f_kvaB').value = '625';
  F.saveUnit('cv');
  t.eq(app.S.reports.filter((x) => x.engine === 'B').length, 1, 'still exactly one B intake reading');
  t.ok(F.isTwin(app.S.units[0]), 'and it is still a TwinPak');

  t.group('bigiron: per-engine targets survive a re-save; un-splitting keeps history');
  app.S.units[0].engines.B.serviceDueHours = 368;
  app.document.getElementById('f_serial').value = 'TGD62501';
  app.document.getElementById('f_kvaA').value = '625';
  app.document.getElementById('f_kvaB').value = '700';
  F.saveUnit('cv');
  t.eq(app.S.units[0].engines.B.serviceDueHours, 368, 'an existing per-engine target is preserved');
  t.eq(F.engKva(app.S.units[0], 'B'), 700, 'a corrected nameplate is written through');
  /* ---------------------------------------------------------------- */
  /* Toggling off STOPS USING the split; it does not forget it. An accidental
     toggle must cost nothing, so it is free when nothing is tagged to an engine
     and typed-gated only when real observations would be stranded. */
  t.group('bigiron: toggle-off preserves the jsonb, and is free when nothing is tagged');
  convFixture();
  F.tpseg(btn('yes'));
  F.lsseg(btn('AB'));
  app.document.getElementById('f_kvaA').value = '625';
  app.document.getElementById('f_kvaB').value = '700';
  F.saveUnit('cv');
  t.ok(F.isTwin(app.S.units[0]), 'converted with no intake readings logged');
  t.eq(app.S.reports.length, 0, 'so nothing is tagged to an engine yet');
  F.tpseg(btn('no'));
  app.document.getElementById('f_serial').value = 'TGD62501';
  F.saveUnit('cv');
  u = app.S.units[0];
  t.ok(!F.isTwin(u), 'toggling off stops using the split, no confirmation needed');
  t.ok(F.engArchived(u), 'and the jsonb is PRESERVED, not cleared');
  t.eq(u.engines.off, true, 'marked off rather than deleted');
  t.eq(u.engines.A.kvaEach, 625, "A's nameplate survives the toggle-off");
  t.eq(u.engines.B.kvaEach, 700, "B's nameplate survives the toggle-off");
  t.eq(F.engMeta(u, 'B').kvaEach, 700, 'and is still readable, so the form can prefill it');
  F.editUnit('cv');
  sh = app.document.getElementById('sheet').innerHTML;
  t.includes(sh, 'value="700"', 'reopening the form shows the preserved nameplate');
  t.includes(sh, 'still saved', 'and tells you the values were kept');
  app.document.getElementById('f_serial').value = 'TGD62501';
  app.document.getElementById('f_kvaA').value = '625';
  app.document.getElementById('f_kvaB').value = '700';
  F.tpseg(btn('yes'));
  F.saveUnit('cv');
  t.ok(F.isTwin(app.S.units[0]), 'toggling back on restores the split');
  t.ok(!app.S.units[0].engines.off, 'and clears the off flag');

  t.group('bigiron: toggle-off IS gated once observations are tagged to an engine');
  convFixture();
  F.tpseg(btn('yes'));
  F.lsseg(btn('AB'));
  app.document.getElementById('f_kvaA').value = '625';
  app.document.getElementById('f_kvaB').value = '625';
  app.document.getElementById('f_hrsB').value = '118';
  F.saveUnit('cv');
  t.eq(F.engTagged(app.S.units[0]).total, 1, 'one observation is now tagged to an engine');
  clear('tw_confirm');
  F.tpseg(btn('no'));
  app.document.getElementById('f_serial').value = 'TGD62501';
  F.saveUnit('cv');
  t.ok(F.isTwin(app.S.units[0]), 'the save does NOT quietly toggle off');
  sh = app.document.getElementById('sheet').innerHTML;
  t.includes(sh, 'Type TWINPAK to confirm', 'a typed gate appears instead');
  t.includes(sh, '1 check tagged Gen B', 'naming exactly what would be stranded');
  t.includes(sh, 'Nothing is deleted', 'and stating plainly that nothing is deleted');
  t.includes(sh, 'Keep TwinPak on', 'with a way out that changes nothing');
  app.document.getElementById('tw_confirm').value = 'TWIN';
  F.doTwinOff('cv');
  t.ok(F.isTwin(app.S.units[0]), 'a partial confirmation refuses');
  app.document.getElementById('tw_confirm').value = 'twinpak';
  F.doTwinOff('cv');
  u = app.S.units[0];
  t.ok(!F.isTwin(u), 'typing TWINPAK turns it off (case-insensitive, like the delete gate)');
  t.ok(F.engArchived(u), 'still preserved after the gated toggle-off');
  t.eq(u.engines.B.kvaEach, 625, 'nameplates kept');
  t.ok(app.S.reports.some((x) => x.engine === 'B'), 'and the tagged check is still in history');

  /* ---------------------------------------------------------------- */
  /* Binding-pass progress must be visible from the Fleet list. Inherited pre-split
     hours are NOT a reading for Engine A — otherwise a tech who skips A because
     "the app already has it" leaves A's countdown running on an unattributable
     number, which is the freeze failure rebuilt inside the fix. */
  t.group('bigiron: an engine without its OWN meter reading is flagged on the card');
  app.setState({ shows: [{ id: 's1', name: 'Fest' }], currentShowId: 's1',
    units: [twin()], reports: [] });
  u = app.S.units[0];
  t.eq(F.twinGaps(u).join(','), 'A,B', 'a freshly converted unit needs BOTH meters read');
  t.ok(F.engNeedsReading(u, 'A'), 'the inherited pre-split seed does NOT count as A having been read');
  let card = F.unitCard(u, 's1');
  t.includes(card, 'TWINPAK', 'the card shows the unit is a TwinPak');
  t.includes(card, 'Gen A needs a meter reading', 'and names Engine A as still needing one');
  t.includes(card, 'Gen B needs a meter reading', 'and Engine B too');
  /* pre-split untagged history still does not count */
  app.setState({ shows: [{ id: 's1', name: 'Fest' }], currentShowId: 's1', units: [twin()],
    reports: [{ id: 'r0', unitId: 'tw', engine: null, engineHours: 3300, timestamp: 2000 }] });
  t.ok(F.engNeedsReading(app.S.units[0], 'A'), 'untagged history is history, not a reading');
  /* one engine read, one not */
  app.setState({ shows: [{ id: 's1', name: 'Fest' }], currentShowId: 's1', units: [twin()],
    reports: [{ id: 'ra', unitId: 'tw', engine: 'A', engineHours: 3310, timestamp: 3000 }] });
  u = app.S.units[0];
  t.eq(F.twinGaps(u).join(','), 'B', 'once A is read on its own meter, only B remains');
  card = F.unitCard(u, 's1');
  t.excludes(card, 'Gen A needs', 'A is no longer flagged');
  t.includes(card, 'Gen B needs a meter reading', 'B still is');
  /* both read => binding pass complete, no flags */
  app.setState({ shows: [{ id: 's1', name: 'Fest' }], currentShowId: 's1', units: [twin()],
    reports: [{ id: 'ra', unitId: 'tw', engine: 'A', engineHours: 3310, timestamp: 3000 },
      { id: 'rb', unitId: 'tw', engine: 'B', engineHours: 118, timestamp: 3000 }] });
  u = app.S.units[0];
  t.eq(F.twinGaps(u).length, 0, 'both engines read => binding pass complete for this unit');
  card = F.unitCard(u, 's1');
  t.excludes(card, 'needs a meter reading', 'and the card carries no gap flag');
  t.includes(card, 'TWINPAK', 'but still identifies as a TwinPak');
  /* label style flows into the chip, and single-engine units are untouched */
  app.setState({ shows: [{ id: 's1', name: 'Fest' }], currentShowId: 's1',
    units: [twin({ engines: { style: '12', A: { kvaEach: 625 }, B: { kvaEach: 625 } } })], reports: [] });
  t.includes(F.unitCard(app.S.units[0], 's1'), 'TWINPAK · 1/2', 'the chip follows the housing label style');
  app.setState({ shows: [{ id: 's1', name: 'Fest' }], currentShowId: 's1', units: [single()], reports: [] });
  t.excludes(F.unitCard(app.S.units[0], 's1'), 'TWINPAK', 'a single-engine card is unchanged');
  t.eq(F.twinGaps(app.S.units[0]).length, 0, 'and has no engine gaps by definition');

  t.group('bigiron: a tagged issue alone earns the gate');
  app.setState({ units: [twin()], reports: [], issues: [
    { id: 'i1', unitId: 'tw', engine: 'B', severity: 'down', title: 'No start', timestamp: 1, resolved: false }] });
  const tg = F.engTagged(app.S.units[0]);
  t.eq(tg.total, 1, 'a tagged issue with no tagged checks still counts');
  t.includes(tg.parts.join(' '), 'issue tagged Gen B', 'and is named in the warning');

  /* ---------------------------------------------------------------- */
  t.group('bigiron: same-kVA sort tiebreak is the job label, then serial');
  app.setState({ shows: [{ id: 's1', name: 'Fest' }], currentShowId: 's1', units: [
    { id: 'zz', serial: 'ZZZ001', klass: 'big', kw: 500, opStatus: 'running', locationType: 'show', locationId: 's1', jobMeta: { s1: { name: 'Zulu tent' } } },
    { id: 'mm', serial: 'MMM001', klass: 'big', kw: 500, opStatus: 'running', locationType: 'show', locationId: 's1', jobMeta: {} },
    { id: 'aa', serial: 'QQQ001', klass: 'big', kw: 500, opStatus: 'running', locationType: 'show', locationId: 's1', jobMeta: { s1: { name: 'Alpha stage' } } },
  ] });
  t.eq(app.S.units.slice().sort(F.byKva).map((x) => x.id).join(','), 'aa,mm,zz',
    'labelled units sort by label, unlabelled by serial: Alpha stage, MMM001, Zulu tent');
  /* the two rules that outrank the tiebreak must still hold */
  app.setState({ shows: [{ id: 's1', name: 'Fest' }], currentShowId: 's1', units: [
    { id: 'big', serial: 'B', klass: 'big', kw: 900, opStatus: 'running', locationType: 'show', locationId: 's1', jobMeta: {} },
    { id: 'dn', serial: 'A', klass: 'big', kw: 100, opStatus: 'down', locationType: 'show', locationId: 's1', jobMeta: { s1: { name: 'Aaa' } } },
    { id: 'sm', serial: 'C', klass: 'big', kw: 200, opStatus: 'running', locationType: 'show', locationId: 's1', jobMeta: {} },
  ] });
  t.eq(app.S.units.slice().sort(F.byKva).map((x) => x.id).join(','), 'sm,big,dn',
    'kVA ascending still wins, and a down unit still sinks below everything');
};
