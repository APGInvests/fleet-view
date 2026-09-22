/**
 * fv_inv_svcrunway.js — hours-to-service runway on the job card (2026-09-22, `svc-runway`).
 *
 * The PM placement question at unload: which units have the most hours left
 * before service. Contracts: the chip renders ONLY when provable — a
 * service-due target exists AND a non-voided hours reading is timestamped
 * AFTER the unit's latest real arrival movement onto THIS show (from ≠ to,
 * kind null; pin-sets and photo events are never arrivals). No target, no
 * reading, or a pre-arrival reading = nothing — never invent an interval,
 * never carry old hours. Age always renders next to the hours; past 14 days
 * the wording drops the live claim ("to service") for a dated fact ("as of").
 * Overdue is red at any age — hours only increase, so an old OVERDUE is
 * certain, not stale. Twins: lower-of-two, engine named; lanes per the house
 * doctrine (A inherits untagged, B never does). Nothing here blocks receiving
 * a unit or makes hours required. openServicePlanner (§6 cut, zero callers)
 * is deleted in the same build and must stay gone.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const SID = 'show-RW';
  const NOW = Date.now();
  const days = (n) => n * 864e5;

  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'small',
    make: 'MQ', model: 'DCA150', kw: 150, opStatus: 'running',
    locationType: 'show', locationId: SID, photos: [], jobMeta: {}, updatedAt: 1 }, o);
  const mkMove = (unitId, o = {}) => Object.assign({ id: id('mv'), unitId, fromType: 'shop', fromId: 'shop-1',
    toType: 'show', toId: SID, techName: 'Mike R.', timestamp: NOW - days(10), gps: null, photos: null, kind: null }, o);
  const mkRead = (unitId, hrs, o = {}) => Object.assign({ id: id('rpt'), unitId, showId: SID, techName: 'Mike R.',
    timestamp: NOW - days(3), gps: null, engine: null, engineHours: hrs, notes: 'Meter reading' }, o);
  const setState = (units, movements, reports) =>
    app.setState({ units, shows: [{ id: SID, name: 'Runway Fest' }], issues: [], movements, reports });

  t.group('runway arrival: only a real movement onto THIS show counts');
  {
    const u = mkUnit({ id: 'u-arr' });
    // real move shop -> show
    setState([u], [mkMove('u-arr', { timestamp: NOW - days(10) })], []);
    t.eq(app.fn.arrivalTs(u), NOW - days(10), 'shop->show move is the arrival');
    // birth row: new asset created on the job (fromType null)
    setState([u], [mkMove('u-arr', { fromType: null, fromId: null, timestamp: NOW - days(9) })], []);
    t.eq(app.fn.arrivalTs(u), NOW - days(9), 'birth row (fromType null -> show) is an arrival');
    // pin-set / placement capture: from = to, never an arrival
    setState([u], [mkMove('u-arr', { fromType: 'show', fromId: SID, timestamp: NOW - days(1) })], []);
    t.eq(app.fn.arrivalTs(u), null, 'pin-set (from = to) is NOT an arrival');
    // adversarial: a photo event handed a real from/to and a destination still never counts
    setState([u], [mkMove('u-arr', { kind: 'photo', timestamp: NOW - days(1) })], []);
    t.eq(app.fn.arrivalTs(u), null, 'kind:photo is NOT an arrival even with from != to');
    // move onto a DIFFERENT show is not an arrival here
    setState([u], [mkMove('u-arr', { toId: 'show-OTHER', timestamp: NOW - days(1) })], []);
    t.eq(app.fn.arrivalTs(u), null, 'a move onto another show is not an arrival on this one');
    // latest arrival wins: left and came back
    setState([u], [
      mkMove('u-arr', { timestamp: NOW - days(40) }),
      mkMove('u-arr', { fromType: 'show', fromId: 'show-OTHER', timestamp: NOW - days(5) }),
    ], []);
    t.eq(app.fn.arrivalTs(u), NOW - days(5), 'latest real arrival wins after a leave-and-return');
    // off-show unit has no arrival
    const uf = mkUnit({ id: 'u-fleet', locationType: 'fleet', locationId: null });
    setState([uf], [mkMove('u-fleet')], []);
    t.eq(app.fn.arrivalTs(uf), null, 'an off-show unit has no arrival');
  }

  t.group('runway floor: reading must postdate the arrival, and both inputs must exist');
  {
    const u = mkUnit({ id: 'u-fl', serviceDueHours: 1000 });
    // fresh reading after arrival -> runway
    setState([u], [mkMove('u-fl')], [mkRead('u-fl', 790)]);
    const rw = app.fn.svcRunway(u);
    t.ok(rw, 'fresh reading + target -> runway exists');
    t.eq(rw.remaining, 210, 'remaining = due - fresh reading');
    // reading BEFORE arrival -> nothing (no carrying old hours)
    setState([u], [mkMove('u-fl')], [mkRead('u-fl', 790, { timestamp: NOW - days(20) })]);
    t.eq(app.fn.svcRunway(u), null, 'a pre-arrival reading shows NOTHING');
    // no arrival row at all -> nothing (the D1970162 case)
    setState([u], [], [mkRead('u-fl', 790)]);
    t.eq(app.fn.svcRunway(u), null, 'no arrival row -> nothing');
    // no service-due target -> nothing, never invent an interval
    const un = mkUnit({ id: 'u-nodue' });
    setState([un], [mkMove('u-nodue')], [mkRead('u-nodue', 790)]);
    t.eq(app.fn.svcRunway(un), null, 'no due target -> nothing');
    // no reading at all -> nothing (units.currentHours is NEVER a substitute)
    const uc = mkUnit({ id: 'u-cur', serviceDueHours: 1000, currentHours: 790 });
    setState([uc], [mkMove('u-cur')], []);
    t.eq(app.fn.svcRunway(uc), null, 'currentHours without a timestamped check is never used');
    // a voided check never feeds the runway (reportsFor choke point)
    setState([u], [mkMove('u-fl')], [
      mkRead('u-fl', 900, { timestamp: NOW - days(1), voidedAt: NOW - days(1) + 60000, voidedBy: 'Mike R.' }),
      mkRead('u-fl', 790, { timestamp: NOW - days(3) }),
    ]);
    t.eq(app.fn.svcRunway(u).remaining, 210, 'voided check excluded — older live reading used');
    setState([u], [mkMove('u-fl')], [mkRead('u-fl', 900, { voidedAt: NOW, voidedBy: 'Mike R.' })]);
    t.eq(app.fn.svcRunway(u), null, 'only-ever reading voided -> nothing');
  }

  t.group('runway wording: age always shown; 14 days flips claim to dated fact; overdue red at any age');
  {
    const u = mkUnit({ id: 'u-wd', serviceDueHours: 1000 });
    // fresh, plenty of runway
    setState([u], [mkMove('u-wd')], [mkRead('u-wd', 790)]);
    let c = app.fn.runwayChip(u);
    t.includes(c, '🔧 210 h to service · 3d ago', 'fresh: live claim + age');
    t.includes(c, 'class="chip"', 'plenty of runway -> neutral chip');
    // soon: within warnHours (default 20), decimals survive the 0.1 rounding
    setState([u], [mkMove('u-wd')], [mkRead('u-wd', 980.25)]);
    c = app.fn.runwayChip(u);
    t.includes(c, '19.8 h to service', 'decimal remaining rounds to 0.1');
    t.includes(c, 'chip warn', 'within warnHours -> warn chip');
    // overdue, fresh
    setState([u], [mkMove('u-wd')], [mkRead('u-wd', 1035)]);
    c = app.fn.runwayChip(u);
    t.includes(c, 'OVER 35 h · 3d ago', 'overdue: OVER + age');
    t.includes(c, 'chip bad', 'overdue -> red chip');
    // stale reading (26d): number kept, live claim dropped
    setState([u], [mkMove('u-wd', { timestamp: NOW - days(30) })], [mkRead('u-wd', 790, { timestamp: NOW - days(26) })]);
    c = app.fn.runwayChip(u);
    t.includes(c, '210 h as of 26d ago', 'past 14d: "as of", never a live countdown claim');
    t.ok(!/to service/.test(c), 'stale wording drops "to service"');
    // stale AND overdue stays red — an old overdue is certain, not stale
    setState([u], [mkMove('u-wd', { timestamp: NOW - days(30) })], [mkRead('u-wd', 1035, { timestamp: NOW - days(26) })]);
    c = app.fn.runwayChip(u);
    t.includes(c, 'OVER 35 h as of 26d ago', 'old overdue: OVER + dated fact');
    t.includes(c, 'chip bad', 'old overdue stays red');
    // no runway -> empty string, zero markup
    const ub = mkUnit({ id: 'u-blank' });
    setState([ub], [], []);
    t.eq(app.fn.runwayChip(ub), '', 'no runway -> no markup at all');
  }

  t.group('runway twins: lower-of-two named, house lane doctrine');
  {
    const mkTwin = (o = {}) => mkUnit(Object.assign({ klass: 'big', make: 'Technogen', model: 'TGD', kw: 1000,
      engines: { style: 'AB', A: { kvaEach: 500, serviceDueHours: 5000 }, B: { kvaEach: 500, serviceDueHours: 5000 } } }, o));
    // both engines fresh: the worse one shows, named
    const tw = mkTwin({ id: 'u-tw' });
    setState([tw], [mkMove('u-tw')], [
      mkRead('u-tw', 4700, { engine: 'A' }),
      mkRead('u-tw', 4880, { engine: 'B' }),
    ]);
    let rw = app.fn.svcRunway(tw);
    t.eq(rw.eng, 'B', 'lower-of-two: B (120h) beats A (300h)');
    t.eq(rw.remaining, 120, 'twin remaining from the worse engine');
    t.includes(app.fn.runwayChip(tw), 'Gen B 120 h to service', 'chip names the engine (style AB)');
    // only one engine has a due target -> that engine shows; the other never invents
    const t1 = mkTwin({ id: 'u-tw1', engines: { style: 'AB', A: { kvaEach: 500, serviceDueHours: 5000 }, B: { kvaEach: 500 } } });
    setState([t1], [mkMove('u-tw1')], [mkRead('u-tw1', 4700, { engine: 'A' }), mkRead('u-tw1', 100, { engine: 'B' })]);
    rw = app.fn.svcRunway(t1);
    t.eq(rw && rw.eng, 'A', 'engine without a target is skipped, not invented');
    // lane doctrine: an untagged post-arrival reading feeds A, never B
    const t2 = mkTwin({ id: 'u-tw2' });
    setState([t2], [mkMove('u-tw2')], [mkRead('u-tw2', 4700, { engine: null })]);
    rw = app.fn.svcRunway(t2);
    t.eq(rw && rw.eng, 'A', 'untagged reading inherits to A (pre-split doctrine)');
    t.eq(rw.remaining, 300, 'A runway from the untagged reading; B shows nothing');
    // neither engine provable -> nothing
    const t3 = mkTwin({ id: 'u-tw3' });
    setState([t3], [mkMove('u-tw3')], []);
    t.eq(app.fn.svcRunway(t3), null, 'twin with no readings -> nothing');
    // flat serviceDueHours on a twin is ignored (per-engine targets only)
    const t4 = mkTwin({ id: 'u-tw4', serviceDueHours: 5000,
      engines: { style: 'AB', A: { kvaEach: 500 }, B: { kvaEach: 500 } } });
    setState([t4], [mkMove('u-tw4')], [mkRead('u-tw4', 4700, { engine: 'A' })]);
    t.eq(app.fn.svcRunway(t4), null, 'flat due on a twin never substitutes for per-engine targets');
  }

  t.group('runway card: chip leads the metaline, title stays size-locked, no-chip cards unchanged');
  {
    const u = mkUnit({ id: 'u-card', serviceDueHours: 1000 });
    setState([u], [mkMove('u-card')], [mkRead('u-card', 790)]);
    const h = app.fn.unitCard(u, SID);
    t.includes(h, '🔧 210 h to service', 'chip renders on the job card');
    t.includes(h, '<span class="tag">150 kVA</span>', 'title is still the bare size — runway never touches it');
    t.ok(h.indexOf('🔧') > h.indexOf('class="metaline"'), 'chip lives in the metaline, below the title');
    const ub = mkUnit({ id: 'u-card2' });
    setState([ub], [], []);
    const hb = app.fn.unitCard(ub, SID);
    t.ok(hb.indexOf('🔧') === -1, 'a unit with no provable runway renders no runway markup');
    t.includes(hb, '<span class="tag">150 kVA</span>', 'no-chip card otherwise intact');
  }

  t.group('runway never gates: receiving and checks stay untouched');
  {
    // A zero-history unit is fully receivable: doMoveScan records the move with
    // no runway involvement — the chip is derived at render, writes nothing.
    const u = mkUnit({ id: 'u-rec', locationType: 'fleet', locationId: null });
    setState([u], [], []);
    app.S.settings.techName = 'Mike R.';
    app.fn.doMoveScan('u-rec', 'show', SID);
    t.eq(u.locationType, 'show', 'unit received with zero hours history');
    const mv = app.S.movements.find((m) => m.unitId === 'u-rec');
    t.ok(mv && mv.toId === SID, 'arrival movement recorded — and it is the runway floor for later');
    t.eq(app.fn.svcRunway(u), null, 'still no runway (no reading, no target) — and that blocked nothing');
  }

  t.group('runway: openServicePlanner stays deleted (§6 cut, zero callers)');
  {
    t.eq(typeof app.fn.openServicePlanner, 'undefined', 'openServicePlanner is gone');
    t.ok(app.code.indexOf('openServicePlanner') === -1, 'identifier absent from the source');
  }
};
