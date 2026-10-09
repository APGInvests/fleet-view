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
};
