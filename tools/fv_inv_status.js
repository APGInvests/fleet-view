/**
 * fv_inv_status.js — standing invariants for one-tap status and the `ro` contract.
 *
 * WHY THE CONTROL EXISTS: the roster import lands ~120 units as STAGED. If the only
 * way to mark one running were a full check form, they would sit staged forever and
 * the fleet view would be wrong from day one. Placing 20 generators in a day has to
 * be 20 taps, not 20 forms.
 *
 * WHAT IT MUST NOT BECOME: a silent field set. It records an EVENT with who, when
 * and what, because "when did this go down and who called it" is the question the
 * log exists to answer.
 *
 * A status event is NOT A CHECK. It lives in its own table, so it can never reset the
 * freshness clock or feed the hours derivation. If it were a report row, marking a
 * unit running would make it look recently inspected.
 *
 * `ro` CONTRACT: columns Postgres owns. `received_at` is the server-received ordering
 * column from the offline-write-path design — device time is `ts` and is what the UI
 * shows; ordering tiebreaks on `received_at`, which only the server may set. Omitting
 * it from a mapping is a habit; `toRow` stripping it is a guarantee.
 */
'use strict';
module.exports = (app, t) => {
  const F = app.fn;
  const tech = () => Object.assign(F.blankState().settings, { techName: 'Mike R.' });
  const unit = (o) => Object.assign({ id: 'u1', serial: 'A1', klass: 'big', kw: 500,
    opStatus: 'staged', locationType: 'fleet', locationId: null, jobMeta: {} }, o || {});
  const twin = (a, b, o) => Object.assign(unit({ id: 'tw', serial: 'TW1', kw: 1000,
    engines: { style: 'AB', A: Object.assign({ kvaEach: 625 }, a ? { opStatus: a } : {}),
      B: Object.assign({ kvaEach: 625 }, b ? { opStatus: b } : {}) } }), o || {});
  const set = (units, extra) => {
    app.setState(Object.assign({ settings: tech(), shows: [{ id: 's1', name: 'Fest' }],
      currentShowId: 's1', units, reports: [], issues: [], status_events: [] }, extra || {}));
    return app.S.units[0];
  };
  const ev = () => app.S.status_events || [];

  /* ---------------------------------------------------------------- */
  t.group('status: the ro contract — Postgres owns received_at');
  const MAPS = app.live.MAPS;
  ['reports', 'issues', 'movements', 'status_events'].forEach((tbl) => {
    t.ok(MAPS[tbl] && Array.isArray(MAPS[tbl].ro), tbl + ' declares an ro list');
    t.ok(MAPS[tbl].ro.indexOf('received_at') >= 0, tbl + ' marks received_at as server-owned');
  });
  /* structurally impossible to send, not merely absent from the mapping */
  const leak = { id: 'x', unitId: 'u1', status: 'running', techName: 'Mike R.',
    timestamp: 1000, received_at: ' SHOULD NEVER BE SENT ', receivedAt: 'nor this' };
  const row = F.toRow('status_events', leak);
  t.ok(!('received_at' in row), 'toRow never emits received_at even when the source object has it');
  ['reports', 'issues', 'movements', 'status_events'].forEach((tbl) => {
    const r = F.toRow(tbl, leak);
    MAPS[tbl].ro.forEach((c) => t.ok(!(c in r), 'toRow(' + tbl + ') strips ' + c));
  });
  t.eq(row.status, 'running', 'while the real mapped fields still serialise');
  t.eq(row.unit_id, 'u1', 'and camelCase still maps to snake_case');
  t.eq(F.fromRow('status_events', { id: 'x', unit_id: 'u1', engine: 'B', status: 'down',
    tech_name: 'Mike R.', ts: new Date(1000).toISOString() }).engine, 'B', 'and the row round-trips back');
  t.ok(app.live.TABLES.indexOf('status_events') >= 0, 'status_events is synced');
  t.ok(Array.isArray(F.blankState().status_events), 'and blank state has the array');

  /* ---------------------------------------------------------------- */
  t.group('status: one tap writes an event, not a silent field set');
  let u = set([unit({ opStatus: 'staged' })]);
  F.setStatus('u1', '', 'running');
  u = app.S.units[0];
  t.eq(u.opStatus, 'running', 'the unit is now running');
  t.eq(ev().length, 1, 'exactly one event recorded');
  t.eq(ev()[0].status, 'running', 'the event says what');
  t.eq(ev()[0].techName, 'Mike R.', 'and who');
  t.ok(ev()[0].timestamp > 0, 'and when');
  t.eq(ev()[0].unitId, 'u1', 'attributed to the unit');
  t.eq(ev()[0].engine, null, 'with no engine on a single-engine unit');
  t.ok(u.updatedAt > 0, 'and updatedAt is bumped for LWW');

  t.group('status: a status event is NOT a check');
  u = set([unit({ opStatus: 'staged', locationType: 'show', locationId: 's1' })]);
  F.setStatus('u1', '', 'running');
  u = app.S.units[0];
  t.eq(app.S.reports.length, 0, 'no report row is created');
  t.eq(F.lastCheckTs(u), null, 'the freshness clock is untouched');
  t.eq(F.isStale(u), true, 'so a running on-job unit still owes a check afterwards');
  t.eq(F.engHours(u, null), null, 'and no hours are invented');

  t.group('status: rule 3 — the control starts on the current status');
  let sh = F.statusSeg(set([unit({ opStatus: 'down' })]), null);
  t.includes(sh, 'data-v', 'renders a segmented control');
  t.includes(sh, "setStatus('u1','','running')", 'with a one-tap running action');
  t.ok(/class="on"[^>]*>Down</.test(sh.replace(/style="[^"]*"/g, '')), 'Down is the selected option');
  t.excludes(F.statusSeg(set([unit({ opStatus: 'staged' })]), null).replace(/style="[^"]*"/g, ''),
    'class="on">Running', 'Running is never selected by default');
  /* an engine nobody has observed selects nothing at all */
  const fresh = set([twin(null, null, { opStatus: 'staged' })]);
  t.eq(F.engStatus(fresh, 'B'), null, 'an unobserved engine has no status');
  const segB = F.statusSeg(fresh, 'B').replace(/style="[^"]*"/g, '');
  t.excludes(segB, 'class="on"', 'so its control starts on nothing rather than claiming a default');

  t.group('status: tapping the current value records nothing');
  set([unit({ opStatus: 'running' })]);
  F.setStatus('u1', '', 'running');
  t.eq(ev().length, 0, 'a no-op tap creates no event');
  t.eq(app.S.units[0].opStatus, 'running', 'and changes nothing');

  /* ---------------------------------------------------------------- */
  t.group('status: per-engine on a TwinPak');
  set([twin('running', 'running')]);
  F.setStatus('tw', 'B', 'down');
  u = app.S.units[0];
  t.eq(F.engStatus(u, 'B'), 'down', 'B is down');
  t.eq(F.engStatus(u, 'A'), 'running', 'A is untouched');
  t.eq(ev()[0].engine, 'B', 'the event names the engine');
  t.eq(F.computeStatus(u).label, 'GEN B DOWN', 'and the chassis reads half-down');
  t.eq(F.chassisStatus(u), 'down', 'while the chassis aggregates on the failure axis');
  /* the other engine keeps its own control and its own history */
  F.setStatus('tw', 'A', 'staged');
  u = app.S.units[0];
  t.eq(F.engStatus(u, 'A'), 'staged', 'A can be set independently');
  t.eq(F.engStatus(u, 'B'), 'down', 'without disturbing B');
  t.eq(ev().length, 2, 'two events, one per engine');
  t.eq(F.statusEventsFor('tw', 'A').length, 1, 'and they are separable by engine');
  t.eq(F.statusEventsFor('tw', 'B').length, 1, 'one each');
  t.eq(F.statusEventsFor('tw').length, 2, 'or read together for the unit');

  t.group('status: a status change never moves a unit (rule 1)');
  set([twin('running', 'running', { locationType: 'show', locationId: 's1' })], { movements: [] });
  F.setStatus('tw', 'B', 'down');
  t.eq(app.S.movements.length, 0, 'no movement row');
  t.eq(F.unitGps(app.S.units[0]), null, 'no map pin');
  t.eq(app.S.units[0].locationId, 's1', 'placement untouched');

  t.group('status: the control is on unit detail, one tap, no extra screen');
  set([unit({ opStatus: 'staged' })]);
  F.openUnit('u1');
  let html = app.document.getElementById('sheet').innerHTML;
  t.includes(html, "setStatus('u1','','running')", 'a single-engine unit shows the control inline');
  t.includes(html, "setStatus('u1','','down')", 'with all three states reachable in one tap');
  t.includes(html, "logVitals('u1')", 'and the check flow is unchanged beside it');
  set([twin('running', 'staged')]);
  F.openUnit('tw');
  html = app.document.getElementById('sheet').innerHTML;
  t.includes(html, "setStatus('tw','A','down')", 'a twin gets a control on the Gen A row');
  t.includes(html, "setStatus('tw','B','down')", 'and on the Gen B row');
  t.excludes(html, "setStatus('tw','','down')", 'and no chassis-level control on a twin');
  t.eq((html.match(/setStatus\(/g) || []).length, 6, 'exactly three options per engine, no more');

  /* ---------------------------------------------------------------- */
  t.group('status: the check form and a down issue record the same event');
  set([unit({ opStatus: 'staged', locationType: 'show', locationId: 's1' })]);
  ['v_kw', 'v_hrs', 'v_notes'].forEach((i) => { app.document.getElementById(i).value = ''; });
  F.logVitals('u1');
  F.vseg({ dataset: { v: 'running' }, classList: { add() {}, remove() {} }, style: {} });
  F.saveVitals('u1');
  t.eq(ev().length, 1, 'a check that changes status records a status event too');
  t.eq(ev()[0].status, 'running', 'with the new status');
  t.eq(ev()[0].techName, 'Mike R.', 'and the tech who logged it');
  t.eq(app.S.reports.length, 1, 'and the check itself is still a report');
  /* a check that does not change status records no status event */
  set([unit({ opStatus: 'running', locationType: 'show', locationId: 's1' })]);
  F.logVitals('u1');
  F.saveVitals('u1');
  t.eq(ev().length, 0, 'an unchanged status records nothing');
  /* a down issue is the commonest way something goes down */
  set([unit({ opStatus: 'running' })]);
  ['i_title', 'i_text'].forEach((i) => { app.document.getElementById(i).value = ''; });
  F.flagIssue('u1');
  F.iseg({ dataset: { v: 'down' }, classList: { add() {}, remove() {} }, style: {} });
  F.saveIssue('u1');
  t.eq(ev().length, 1, 'flagging a hard-down issue records the status event');
  t.eq(ev()[0].status, 'down', 'as a down event');
  t.eq(app.S.units[0].opStatus, 'down', 'and the unit is down');
};
