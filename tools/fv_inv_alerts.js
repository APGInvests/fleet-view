/**
 * fv_inv_alerts.js — standing invariants for alert gating.
 *
 * The contract: an alert is a claim that a unit owes someone something. Four
 * predicates define that, and every surface (Alerts screen, nav badge, job health)
 * reads the same four, so the number on the tab can never disagree with what you
 * find when you open it.
 *
 *   owesCheck    — on a job AND running, then the staleness clock. A unit that
 *                  isn't on a job can't be checked; a staged unit has nothing to
 *                  observe yet. Placing 20 generators in a day, some not running
 *                  for a week, must not produce 20 nags.
 *   lowFuel      — running only. Fuel on a staged machine isn't news.
 *   isHardDown   — regardless of assignment. That's how the owner sees what's broken.
 *   needsService — regardless of assignment. A machine overdue for service in the
 *                  Jersey shop is exactly what a service department needs to see.
 *
 * The two "regardless of assignment" rules are a WIDENING: before this, every alert
 * section was filtered to units on a show, so a dead machine in a shop was invisible.
 */
'use strict';
module.exports = (app, t) => {
  const F = app.fn;
  const set = (units) => {
    app.setState({ settings: F.blankState().settings, shows: [{ id: 's1', name: 'Fest' }],
      shops: [{ id: 'sh1', name: 'Indio' }], currentShowId: 's1', units, reports: [], issues: [] });
    return app.S.units[0];
  };
  const ago = (h) => Date.now() - h * 3600e3;
  /* staleHours defaults to 6, warnHours to 20 */
  const unit = (o) => Object.assign({ id: 'u1', serial: 'A1', klass: 'big', kw: 500,
    opStatus: 'staged', locationType: 'fleet', locationId: null, jobMeta: {} }, o);
  const withCheck = (u, tsAgo, extra) => {
    app.setState({ settings: F.blankState().settings, shows: [{ id: 's1', name: 'Fest' }],
      shops: [{ id: 'sh1', name: 'Indio' }], currentShowId: 's1', units: [u],
      reports: tsAgo == null ? [] : [Object.assign({ id: 'r1', unitId: u.id, engine: null,
        engineHours: 100, timestamp: ago(tsAgo) }, extra || {})], issues: [] });
    return app.S.units[0];
  };

  t.group('alerts: overdue fires only when on a job AND running');
  let u = withCheck(unit({ opStatus: 'running', locationType: 'show', locationId: 's1' }), 20);
  t.eq(F.isStale(u), true, 'running, on a job, last check 20h ago => owes a check');
  u = withCheck(unit({ opStatus: 'running', locationType: 'show', locationId: 's1' }), 1);
  t.eq(F.isStale(u), false, 'running, on a job, checked an hour ago => owes nothing');
  u = withCheck(unit({ opStatus: 'staged', locationType: 'show', locationId: 's1' }), 20);
  t.eq(F.isStale(u), false, 'STAGED on a job => never overdue, nothing to observe yet');
  u = withCheck(unit({ opStatus: 'down', locationType: 'show', locationId: 's1' }), 20);
  t.eq(F.isStale(u), false, 'DOWN on a job => never overdue (unchanged rule)');
  u = withCheck(unit({ opStatus: 'running', locationType: 'shop', locationId: 'sh1' }), 20);
  t.eq(F.isStale(u), false, 'running in a SHOP => not on a job, so it cannot owe a check');
  u = withCheck(unit({ opStatus: 'running', locationType: 'fleet', locationId: null }), 20);
  t.eq(F.isStale(u), false, 'running but UNASSIGNED => cannot owe a check');
  u = withCheck(unit({ opStatus: 'running', locationType: 'show', locationId: 's1' }), null);
  t.eq(F.isStale(u), true, 'never checked, running, on a job => owes a check');
  u = withCheck(unit({ opStatus: 'staged', locationType: 'fleet' }), null);
  t.eq(F.isStale(u), false, 'the import shape (staged, unassigned, never checked) is SILENT');

  t.group('alerts: low fuel fires only when running');
  const fuel = (pct, o) => withCheck(unit(o), 1, { fuelLevelPct: pct });
  t.eq(F.lowFuel(fuel(10, { opStatus: 'running', locationType: 'show', locationId: 's1' })), true,
    'running with 10% fuel => low fuel');
  t.eq(F.lowFuel(fuel(10, { opStatus: 'staged', locationType: 'show', locationId: 's1' })), false,
    'STAGED with 10% fuel => silent, fuel on a staged unit is not news');
  t.eq(F.lowFuel(fuel(10, { opStatus: 'down', locationType: 'show', locationId: 's1' })), false,
    'DOWN with 10% fuel => silent');
  t.eq(F.lowFuel(fuel(10, { opStatus: 'running', locationType: 'shop', locationId: 'sh1' })), true,
    'running in a shop still counts — running is the gate, not the job');
  t.eq(F.lowFuel(fuel(50, { opStatus: 'running', locationType: 'show', locationId: 's1' })), false,
    '50% fuel is not low');
  t.eq(F.lowFuel(withCheck(unit({ opStatus: 'running', locationType: 'show', locationId: 's1' }), 1)), false,
    'no fuel reading at all => no claim');

  t.group('alerts: hard down fires regardless of assignment (WIDENED)');
  t.eq(F.isHardDown(set([unit({ opStatus: 'down', locationType: 'fleet' })])), true,
    'a dead machine sitting unassigned is visible');
  t.eq(F.isHardDown(set([unit({ opStatus: 'down', locationType: 'shop', locationId: 'sh1' })])), true,
    'a dead machine in the Jersey shop is visible');
  t.eq(F.isHardDown(set([unit({ opStatus: 'down', locationType: 'show', locationId: 's1' })])), true,
    'and on a job, as before');
  t.eq(F.isHardDown(set([unit({ opStatus: 'staged', locationType: 'fleet' })])), false,
    'a staged unit is not hard down');

  t.group('alerts: service fires regardless of assignment (WIDENED)');
  t.eq(F.needsService(set([unit({ locationType: 'shop', locationId: 'sh1', currentHours: 400, serviceDueHours: 350 })])), true,
    'overdue for service in a shop is visible — the service department needs this');
  t.eq(F.needsService(set([unit({ locationType: 'fleet', currentHours: 345, serviceDueHours: 350 })])), true,
    'due soon while unassigned is visible');
  t.eq(F.needsService(set([unit({ locationType: 'fleet', currentHours: 100, serviceDueHours: 350 })])), false,
    'plenty of hours left => silent');
  t.eq(F.needsService(set([unit({ locationType: 'fleet' })])), false,
    'BLANK HOURS => no countdown => silent. This is why the import cannot flood service.');
  t.eq(F.needsService(set([unit({ locationType: 'fleet', currentHours: null, serviceDueHours: 350 })])), false,
    'a target with no hours read is still no countdown');

  t.group('alerts: the import shape contributes nothing but its known-dead units');
  /* 3 staged unassigned blank-hours units + 1 NES hard-down = exactly 1 alert */
  app.setState({ settings: F.blankState().settings, shows: [{ id: 's1', name: 'Fest' }], currentShowId: 's1',
    units: [unit({ id: 'i1' }), unit({ id: 'i2' }), unit({ id: 'i3' }),
      unit({ id: 'i4', opStatus: 'down' })], reports: [], issues: [] });
  const secs = app.S.units.filter(F.isHardDown).length + app.S.units.filter(F.needsService).length
    + app.S.units.filter(F.lowFuel).length + app.S.units.filter(F.isStale).length;
  t.eq(secs, 1, 'four imported units, one of them hard down => exactly one alert entry');
  t.eq(app.S.units.filter(F.needsAttention).length, 1, 'and exactly one unit needs attention');

  t.group('alerts: the badge is the union of the sections, by construction');
  app.setState({ settings: F.blankState().settings, shows: [{ id: 's1', name: 'Fest' }],
    shops: [{ id: 'sh1', name: 'Indio' }], currentShowId: 's1',
    units: [
      unit({ id: 'a', opStatus: 'down', locationType: 'fleet' }),                                    // down only
      unit({ id: 'b', locationType: 'shop', locationId: 'sh1', currentHours: 400, serviceDueHours: 350 }), // service only
      unit({ id: 'c', opStatus: 'running', locationType: 'show', locationId: 's1' }),                 // overdue (never checked)
      unit({ id: 'd', opStatus: 'staged', locationType: 'fleet' }),                                   // silent
      unit({ id: 'e', opStatus: 'down', locationType: 'show', locationId: 's1', currentHours: 400, serviceDueHours: 350 }), // in TWO sections
    ], reports: [], issues: [] });
  const union = new Set([...app.S.units.filter(F.isHardDown), ...app.S.units.filter(F.needsService),
    ...app.S.units.filter(F.lowFuel), ...app.S.units.filter(F.isStale)].map((x) => x.id));
  t.eq(union.size, 4, 'four distinct units across the sections (one appears twice, one is silent)');
  F.updateBadge();
  t.eq(String(app.document.getElementById('alertBadge').textContent), String(union.size),
    'the badge equals the DISTINCT union of the sections');
  const html = F.renderAlerts();
  t.includes(html, 'Hard down', 'Alerts renders the hard down section');
  t.includes(html, 'Service due', 'and the service section');
  t.ok(html.length > 200, 'and renders unassigned/shop units without crashing on a null show id');

  t.group('alerts: per-engine on a TwinPak');
  const twin = (a, b, o) => Object.assign(unit({ id: 'tw', serial: 'TW1', kw: 1000,
    engines: { style: 'AB', A: Object.assign({ kvaEach: 625 }, a ? { opStatus: a } : {}),
      B: Object.assign({ kvaEach: 625 }, b ? { opStatus: b } : {}) } }), o || {});
  const twinChecks = (a, b, tsA, tsB, o) => {
    const reps = [];
    if (tsA != null) reps.push({ id: 'ra', unitId: 'tw', engine: 'A', engineHours: 10, timestamp: ago(tsA) });
    if (tsB != null) reps.push({ id: 'rb', unitId: 'tw', engine: 'B', engineHours: 20, timestamp: ago(tsB) });
    app.setState({ settings: F.blankState().settings, shows: [{ id: 's1', name: 'Fest' }], currentShowId: 's1',
      units: [twin(a, b, o)], reports: reps, issues: [] });
    return app.S.units[0];
  };
  const onj = { locationType: 'show', locationId: 's1' };
  t.eq(F.isStale(twinChecks('running', 'running', 1, 1, onj)), false, 'both engines running and fresh => silent');
  t.eq(F.isStale(twinChecks('running', 'running', 1, 20, onj)), true, 'one running engine stale => the unit owes a check');
  t.eq(F.engStale(twinChecks('running', 'running', 1, 20, onj), 'B'), true, 'and it is B that owes it');
  t.eq(F.engStale(twinChecks('running', 'running', 1, 20, onj), 'A'), false, 'A owes nothing');
  t.eq(F.isStale(twinChecks('running', 'staged', 1, 20, onj)), false, 'a STAGED engine never owes a check');
  t.eq(F.isStale(twinChecks('running', 'down', 1, 20, onj)), false, 'a DOWN engine never owes a check');
  t.eq(F.isStale(twinChecks('staged', 'staged', 20, 20, onj)), false, 'nothing running => nothing owed');
  t.eq(F.isStale(twinChecks('running', 'running', 20, 20, { locationType: 'fleet', locationId: null })), false,
    'a TwinPak off any job owes nothing, however stale');
  t.eq(F.isStale(twinChecks('running', 'running', 1, null, onj)), true,
    'an engine never checked, running and on a job, owes a check');
};
