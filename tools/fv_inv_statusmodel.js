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

  t.group('quick row: STAGED / ONLINE / OFFLINE — down is not a button anywhere');
  {
    base([mkU({})]);
    const seg = F.statusSeg(app.S.units[0], null);
    t.includes(seg, 'data-v="offline"', 'offline button exists');
    t.includes(seg, '>Online<', 'running renders as Online');
    t.excludes(seg, 'data-v="down"', 'down is not a quick state');
    t.ok(seg.indexOf('data-v="staged"') < seg.indexOf('data-v="running"')
      && seg.indexOf('data-v="running"') < seg.indexOf('data-v="offline"'),
      'lifecycle order: Staged · Online · Offline');
    // A down unit: no button selected, and the row says why.
    base([mkU({ opStatus: 'down' })]);
    const dseg = F.statusSeg(app.S.units[0], null);
    t.excludes(dseg.replace(/style="[^"]*"/g, ''), 'class="on"', 'down preselects nothing');
    t.includes(dseg, 'DOWN', 'the down banner names the state');
    t.includes(dseg, 'resolve', 'and points at the recovery path');
  }

  t.group('check form: segment matches the quick row; offline collapses electricals');
  {
    base([ mkU({ id: 'u-cf-run', klass: 'big' }),
      mkU({ id: 'u-cf-off', klass: 'big', opStatus: 'offline' }),
      mkU({ id: 'u-cf-dn', klass: 'big', opStatus: 'down' }) ]);
    F.logVitals('u-cf-run');
    const fRun = app.document.querySelector('#sheet').innerHTML;
    t.includes(fRun, 'data-v="offline"', 'form segment offers Offline');
    t.excludes(fRun, 'data-v="down"', 'form segment has no Down button — Flag Issue owns down');
    t.includes(fRun, 'Flip Status to Online', 'elecOff copy speaks the new vocabulary');
    F.logVitals('u-cf-off');
    const fOff = app.document.querySelector('#sheet').innerHTML;
    t.includes(fOff, 'data-v="offline" class="on"', 'offline unit pre-selects Offline (rule 3: current status)');
    t.eq(app.live.vsegVal, 'offline', 'segment state starts on offline');
    // vsegElec: offline collapses like staged (display-only).
    const elec = app.document.querySelector('#v_elec');
    F.vsegElec();
    t.eq(elec.style.display, 'none', 'offline hides the electrical grid');
    F.logVitals('u-cf-dn');
    const fDn = app.document.querySelector('#sheet').innerHTML;
    t.excludes(fDn.slice(fDn.indexOf('id="v_seg"'), fDn.indexOf('</div>', fDn.indexOf('id="v_seg"'))),
      'class="on"', 'a down unit preselects nothing on the form');
    t.includes(fDn, 'Currently DOWN', 'and the form says why');
  }

  t.group('twin aggregation: offline sits between running and staged');
  {
    const twin = (a, b) => { base([mkU({ engines: { style: 'AB',
      A: { kvaEach: 500, opStatus: a }, B: { kvaEach: 500, opStatus: b } } })]);
      return F.computeStatus(app.S.units[0]); };
    t.eq(twin('running', 'offline').label, 'ONLINE', 'one engine running => trailer ONLINE (rotation is normal)');
    t.eq(twin('offline', 'offline').label, 'OFFLINE', 'both deliberately off => OFFLINE');
    t.eq(twin('offline', 'staged').label, 'OFFLINE', 'a deliberate act outranks the default state');
    t.eq(twin('offline', 'down').label, 'GEN B DOWN', 'down still outranks everything');
    t.eq(twin('offline', 'offline').color, 'teal', 'clean all-offline trailer reads calm');
  }

  t.group('offline alerts: suppressed like staged, re-armed after 14 silent days');
  {
    const DAY = 864e5;
    const offU = (daysAgo, extra = {}, reports = []) => {
      const u = mkU(Object.assign({ opStatus: 'offline' }, extra));
      base([u], { reports,
        status_events: [{ id: 'se-' + u.id, unitId: u.id, engine: null,
          status: 'offline', techName: 'Travis P.', timestamp: Date.now() - daysAgo * DAY }] });
      return app.S.units[0]; };
    t.eq(F.owesCheck(offU(1), null), false, 'offline 1d: no nag (the AQHC rotation)');
    t.eq(F.owesCheck(offU(13), null), false, 'offline 13d: still quiet');
    t.eq(F.owesCheck(offU(15), null), true, 're-arm: 15 silent days => owes a confirm');
    t.eq(F.isStale(offU(15)), true, 'and it reaches the Overdue alert section via isStale');
    // low fuel on a deliberately-off machine is not news:
    const uF = offU(1, {}, [{ id: 'rf', unitId: 'pending', fuelLevelPct: 10,
      timestamp: Date.now() - 3600e3 }]);
    app.S.reports[0].unitId = uF.id;
    t.eq(F.latestFuel(uF), 10, 'control: the low reading is on the record');
    t.eq(F.lowFuel(uF), false, 'offline suppresses the low-fuel nag');
    // a fresh check resets the re-arm clock:
    const u15 = offU(15);
    app.S.reports.push({ id: 'r9', unitId: u15.id, engine: null,
      timestamp: Date.now() - 1 * DAY, techName: 'T' });
    t.eq(F.owesCheck(u15, null), false, 'any check resets the 14d clock');
    // and the card says why it surfaced:
    const uOver = offU(15);
    t.ok(F.computeStatus(uOver).reasons.some((r) => /offline 15d/.test(r.t)),
      'reason chip: offline 15d — confirm');
    t.ok(!F.computeStatus(offU(2)).reasons.some((r) => /offline/.test(r.t)),
      'a cycling unit carries no confirm chip');
    // staged behavior is UNTOUCHED (never re-arms):
    base([mkU({ opStatus: 'staged' })]);
    t.eq(F.owesCheck(app.S.units[0], null), false, 'staged never nags — status quo holds');
    // closed show gates offline confirms exactly like every other nag:
    const uc = mkU({ opStatus: 'offline' });
    base([uc], { shows: [{ id: 's1', name: 'Show', archivedAt: 1 }],
      status_events: [{ id: 'se-c', unitId: uc.id, engine: null, status: 'offline',
        techName: 'T', timestamp: Date.now() - 20 * DAY }] });
    t.eq(F.owesCheck(app.S.units[0], null), false, 'closed show: no offline confirm either');
  }

  t.group('coming back up: resolving the last down issue asks for the new state');
  {
    const mkDown = () => { const u = mkU({ opStatus: 'down' });
      base([u], { issues: [{ id: 'i1', unitId: u.id, severity: 'down',
        title: 'Coolant leak', text: '', resolved: false, engine: null,
        techName: 'T', timestamp: 1 }] });
      return u; };
    const u = mkDown();
    const h = F.backUpAskHtml(u, null);
    ['staged', 'running', 'offline'].forEach((v) =>
      t.includes(h, "'" + v + "'", 'offers ' + v));
    t.excludes(h.replace(/style="[^"]*"/g, ''), 'class="on"',
      'NO preselect — restored health must be claimed by a human (rule 3)');
    t.includes(h, 'Still down', 'an honest escape hatch: leave it down');
    // The wiring: resolving the LAST open down issue on a down unit routes to the ask.
    F.toggleIssue('i1', u.id);
    t.includes(app.document.querySelector('#sheet').innerHTML, 'Back in service?',
      'resolve on a down unit opens the state ask');
    t.eq(app.S.issues[0].resolved, true, 'the issue did resolve');
    t.eq(app.S.units[0].opStatus, 'down', 'but status is not flipped silently');
    // Tapping Online from the ask writes the event (issues already resolved => no re-prompt).
    F.setStatus(u.id, '', 'running');
    t.eq(app.S.units[0].opStatus, 'running', 'the human claim lands');
    t.eq(app.S.status_events.length, 1, 'exactly one status event, name-stamped');
    t.eq(app.S.status_events[0].status, 'running', 'and it says running');
    // Resolving a NON-down issue, or with another down issue still open, never asks.
    const u2 = mkU({ opStatus: 'down' });
    base([u2], { issues: [
      { id: 'i2', unitId: u2.id, severity: 'down', title: 'A', resolved: false, engine: null, techName: 'T', timestamp: 1 },
      { id: 'i3', unitId: u2.id, severity: 'down', title: 'B', resolved: false, engine: null, techName: 'T', timestamp: 2 }] });
    F.toggleIssue('i2', u2.id);
    t.excludes(app.document.querySelector('#sheet').innerHTML, 'Back in service?',
      'a second open down issue keeps the unit down — no ask yet');
  }

  t.group('going around an open down issue: the tap offers to resolve it');
  {
    const u = mkU({ opStatus: 'down' });
    base([u], { issues: [{ id: 'i1', unitId: u.id, severity: 'down',
      title: 'Coolant leak', text: '', resolved: false, engine: null,
      techName: 'T', timestamp: 1 }] });
    const h = F.statusVsIssuesHtml(u, null, 'running', F.openIssuesFor(u.id));
    t.includes(h, 'Coolant leak', 'names the issue in the way');
    t.includes(h, 'Resolve', 'offers resolve-and-set');
    t.includes(h, 'keep', 'offers set-but-keep-open (never blocked)');
    // The routing: a quick-row tap with an open down issue asks instead of writing.
    F.setStatus(u.id, '', 'running');
    t.eq(app.S.units[0].opStatus, 'down', 'no silent write under an open down issue');
    t.eq((app.S.status_events || []).length, 0, 'no event either');
    t.includes(app.document.querySelector('#sheet').innerHTML, 'Coolant leak', 'the ask is on screen');
    // Resolve & set:
    F.setStatus(u.id, '', 'running', true);
    t.eq(app.S.issues[0].resolved, true, 'resolve-and-set resolves the issue');
    t.eq(app.S.units[0].opStatus, 'running', 'and sets the state');
    t.eq(app.S.status_events.length, 1, 'one event');
    // Set-but-keep: fresh fixture.
    const u3 = mkU({ opStatus: 'down' });
    base([u3], { issues: [{ id: 'i9', unitId: u3.id, severity: 'down',
      title: 'Leak', text: '', resolved: false, engine: null, techName: 'T', timestamp: 1 }] });
    F.setStatus(u3.id, '', 'offline', false);
    t.eq(app.S.issues[0].resolved, false, 'keep-open keeps the issue');
    t.eq(app.S.units[0].opStatus, 'offline', 'but the state is set');
    t.eq(F.computeStatus(app.S.units[0]).label, 'DOWN', 'and the open down issue honestly keeps the card DOWN');
    // Hostile string through the ask (it is esc()d — prove it):
    const u4 = mkU({ opStatus: 'down' });
    base([u4], { issues: [{ id: 'i4', unitId: u4.id, severity: 'down',
      title: '<img src=x onerror=alert(1)>"quote"', text: '', resolved: false,
      engine: null, techName: 'T', timestamp: 1 }] });
    const h4 = F.statusVsIssuesHtml(u4, null, 'running', F.openIssuesFor(u4.id));
    t.excludes(h4, '<img', 'issue title is escaped in the ask');
    // The direct path is untouched: no down issue => the event writes immediately.
    base([mkU({ opStatus: 'staged' })]);
    F.setStatus(app.S.units[0].id, '', 'offline');
    t.eq(app.S.status_events.length, 1, 'no-issue tap writes exactly one event');
    t.eq(app.S.units[0].opStatus, 'offline', 'and flips the unit');
  }
};
