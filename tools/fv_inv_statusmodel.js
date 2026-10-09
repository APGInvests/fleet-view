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
module.exports = (app, t) => {
  const F = app.fn;
  let seq = 0;
  const mkU = (o = {}) => { seq++; return Object.assign({ id: 'u-' + seq,
    serial: 'SER' + seq, klass: 'big', kw: 625, opStatus: 'running',
    locationType: 'show', locationId: 's1', jobMeta: {}, photos: [],
    updatedAt: 1 }, o); };
  const base = (units, extra = {}) => app.setState(Object.assign({
    settings: Object.assign(F.blankState().settings,
      { techName: 'Test T.', staleHours: 6, warnHours: 20 }),
    shows: [{ id: 's1', name: 'Show' }], currentShowId: 's1', units,
    reports: [], issues: [], movements: [], status_events: [] }, extra));

  t.group('badge: state and condition are separate channels — nothing displaces the pill');
  {
    // X5M00213's exact shape: running AND over service.
    base([mkU({ serial: 'X5M00213', currentHours: 3200, serviceDueHours: 3022 })]);
    const cs = F.computeStatus(app.S.units[0]);
    t.eq(cs.label, 'ONLINE', 'running+over-service: pill says ONLINE, not OVER SERVICE');
    t.eq(cs.state, 'running', 'state channel reports the operating state');
    t.eq(cs.color, 'orange', 'condition channel still screams orange (stripe/pin)');
    t.ok(cs.reasons.some((r) => /Over service/i.test(r.t)), 'service fact survives in reasons');
    const pill = F.statusPill(cs);
    t.includes(pill, 'ONLINE', 'pill text is the state');
    t.excludes(pill, 'OVER', 'no condition text in the pill, ever');
    t.includes(pill, 'var(--green)', 'pill color follows the STATE (green) while the stripe goes orange');

    base([mkU({ opStatus: 'staged', currentHours: 500, serviceDueHours: 400 })]);
    t.eq(F.computeStatus(app.S.units[0]).label, 'STAGED', 'staged+over-service keeps STAGED');

    base([mkU({ opStatus: 'offline' })]);
    const off = F.computeStatus(app.S.units[0]);
    t.eq(off.label, 'OFFLINE', 'offline is a first-class state');
    t.eq(off.color, 'teal', 'clean offline reads calm (teal), not alarm');

    base([mkU({ opStatus: 'offline', currentHours: 3200, serviceDueHours: 3022 })]);
    const offSvc = F.computeStatus(app.S.units[0]);
    t.eq(offSvc.label, 'OFFLINE', 'offline+over-service: pill holds');
    t.eq(offSvc.color, 'orange', 'condition goes orange — the PM-window signal');

    base([mkU({ opStatus: 'down' })]);
    const dn = F.computeStatus(app.S.units[0]);
    t.eq(dn.label, 'DOWN', 'DOWN is a state and keeps the pill');
    t.eq(dn.color, 'red', 'down condition stays red');

    base([mkU({ locationType: 'transit', locationId: null, inTransitToShowId: 's1' })]);
    const tr = F.computeStatus(app.S.units[0]);
    t.eq(tr.label, 'IN TRANSIT', 'transit pill unchanged');
    t.eq(tr.color, 'blue', 'clean transit stays blue');
  }

  t.group('service fact never leaves the card: runway chip OR fallback chip, exactly one');
  {
    const NOW = Date.now(), days = (n) => n * 864e5;
    // Over service, no fresh post-arrival reading => runway absent => fallback renders.
    base([mkU({ currentHours: 3200, serviceDueHours: 3022 })]);
    const u = app.S.units[0];
    t.eq(F.svcRunway(u), null, 'control: no runway (no arrival movement + reading)');
    const card = F.unitCard(u, 's1');
    t.includes(card, 'OVER SERVICE', 'fallback chip carries the fact the pill used to');
    t.ok(/chip bad">🔧 OVER SERVICE/.test(card), 'and it is a red chip, not the pill');
    t.includes(card, 'ONLINE', 'pill untouched beside it');
    // Service soon => warn chip with the hours
    base([mkU({ currentHours: 3010, serviceDueHours: 3022 })]);
    const soon = F.unitCard(app.S.units[0], 's1');
    t.ok(/chip warn">🔧 12 h to service/.test(soon), 'soon state names the hours');
    // Healthy => no chip at all
    base([mkU({ currentHours: 100, serviceDueHours: 500 })]);
    t.excludes(F.unitCard(app.S.units[0], 's1'), '🔧', 'healthy unit carries no service chip');
    // With a provable runway the fallback must NOT duplicate: exactly one 🔧.
    const rw = mkU({ serial: 'RW1', currentHours: 3200, serviceDueHours: 3022 });
    base([rw], {
      movements: [{ id: 'mv-rw', unitId: rw.id, fromType: 'shop', fromId: 'sh-x',
        toType: 'show', toId: 's1', techName: 'Mike R.', timestamp: NOW - days(10),
        gps: null, photos: null, kind: null }],
      reports: [{ id: 'r-rw', unitId: rw.id, showId: 's1', techName: 'Mike R.',
        timestamp: NOW - days(3), gps: null, engine: null, engineHours: 3200 }] });
    const u2 = app.S.units[0];
    t.ok(F.svcRunway(u2), 'control: runway is provable');
    const card2 = F.unitCard(u2, 's1');
    t.eq((card2.match(/🔧/g) || []).length, 1, 'exactly one wrench chip — runway wins, fallback stands down');
    t.includes(card2, 'OVER 178 h', 'and it is the runway chip (real reading, real hours)');
    // The fleet registry card carries the fallback too (its pill used to say it).
    base([mkU({ currentHours: 3200, serviceDueHours: 3022, locationType: 'fleet', locationId: null })]);
    const fleet = F.renderFleet();
    t.includes(fleet, 'OVER SERVICE', 'fleet card keeps the service fact (chip, not pill)');
    t.includes(fleet, 'ONLINE', 'fleet pill is the state');
  }
};
