/**
 * fv_inv_closeout.js — job close-out (2026-09-22, `job-closeout`).
 *
 * The alert badge hit ~140 and 82% of it was stale-check nags from July shows
 * nobody will ever check again. The fix is scoping, not dismissal: a show can
 * be CLOSED OUT (shows.archived_at, a column that always existed and synced
 * but was never read by the client). Contracts:
 *
 *  1. Stale + low-fuel alerts gate on the unit's show being open. Down +
 *     service stay global — machine facts, removing them on data absence
 *     would invert bias-to-flagging.
 *  2. Closing lives in Settings ONLY (accident-prevention, not access
 *     control — real role check parked for Phase A). No close-out affordance
 *     on job detail, unit cards, jobs list, or the add/load-in flow.
 *  3. Confirm requires typing the job's name (trimmed, case-insensitive).
 *  4. Closing moves nothing and edits no units — it writes archivedAt on the
 *     show row, full stop. Reopen writes null.
 *  5. Archived = hidden from the working list + excluded from stale/fuel
 *     alerts ONLY. Job detail, unit cards, history, the log — all stay
 *     readable by anyone.
 *  6. Jobs list: closed jobs collapse into a "Closed" group, collapsed by
 *     default, searchable when a query is typed.
 */
'use strict';
module.exports = (app, t) => {
  const NOW = Date.now();
  const DAY = 864e5;
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({
    id: id('u'), serial: 'SER' + (++seq), tagId: '', klass: 'big', make: 'CAT',
    model: 'XQ-500', kw: 625, opStatus: 'running', locationType: 'show',
    locationId: 'sh-closed', photos: [], jobMeta: {}, currentHours: null,
    serviceDueHours: null, updatedAt: 1 }, o);
  const baseShows = () => ([
    { id: 'sh-open', name: 'Portola', location: 'SF', createdAt: 1, archivedAt: null },
    { id: 'sh-closed', name: 'Lollapalooza', location: 'Chicago', createdAt: 1, archivedAt: NOW - 30 * DAY },
  ]);

  /* ---------------------------------------------------------------- */
  t.group('close-out gate: stale + low fuel silenced on a closed show');
  {
    const uOpen = mkUnit({ id: 'u-open', locationId: 'sh-open' });          // running, never checked
    const uClosed = mkUnit({ id: 'u-closed' });                              // same, but on the closed show
    const uFuelOpen = mkUnit({ id: 'u-fo', locationId: 'sh-open' });
    const uFuelClosed = mkUnit({ id: 'u-fc' });
    app.setState({ shows: baseShows(), units: [uOpen, uClosed, uFuelOpen, uFuelClosed],
      reports: [
        { id: 'r1', unitId: 'u-fo', showId: 'sh-open', timestamp: NOW - 1000, fuelLevelPct: 10 },
        { id: 'r2', unitId: 'u-fc', showId: 'sh-closed', timestamp: NOW - 1000, fuelLevelPct: 10 },
      ], issues: [], movements: [] });
    t.eq(app.fn.isStale(uOpen), true, 'running + never checked on an OPEN show is stale (control)');
    t.eq(app.fn.isStale(uClosed), false, 'same unit on a CLOSED show owes nothing');
    t.eq(app.fn.lowFuel(uFuelOpen), true, 'fuel 10% running on an open show alerts (control)');
    t.eq(app.fn.lowFuel(uFuelClosed), false, 'fuel 10% on a closed show is not news');
    t.eq(app.fn.needsAttention(uClosed), false, 'stale-only unit on a closed show leaves the badge');
    t.eq(app.fn.needsAttention(uFuelClosed), false, 'fuel-only unit on a closed show leaves the badge');
  }

  t.group('close-out gate: down + service stay global — machine facts survive closing');
  {
    const uDown = mkUnit({ id: 'u-dn', opStatus: 'down' });
    const uSvc = mkUnit({ id: 'u-sv', opStatus: 'staged', currentHours: 500, serviceDueHours: 400 });
    const uShopDown = mkUnit({ id: 'u-sd', opStatus: 'down', locationType: 'fleet', locationId: null });
    app.setState({ shows: baseShows(), units: [uDown, uSvc, uShopDown], reports: [], issues: [], movements: [] });
    t.eq(app.fn.isHardDown(uDown), true, 'down on a closed show still alerts');
    t.eq(app.fn.needsService(uSvc), true, 'over service on a closed show still alerts');
    t.eq(app.fn.needsAttention(uDown), true, 'down unit stays on the badge');
    t.eq(app.fn.needsAttention(uShopDown), true, 'unassigned down unit untouched by any of this');
    const alerts = app.fn.renderAlerts();
    t.includes(alerts, 'Hard down', 'alerts screen keeps the down section');
    t.excludes(alerts, 'Overdue for a check', 'no stale section when the only stale units sit on closed shows');
  }

  /* ---------------------------------------------------------------- */
  t.group('close-out lives in Settings only — no affordance on working surfaces');
  {
    const u = mkUnit({ id: 'u-s1', locationId: 'sh-open' });
    app.setState({ shows: baseShows(), units: [u], reports: [], issues: [], movements: [] });
    app.fn.openSettings();
    const settings = app.document.querySelector('#sheet').innerHTML;
    t.includes(settings, 'CLOSE OUT A JOB', 'Settings has the close-out section');
    t.includes(settings, 'closeOutSheet', 'Settings wires the close-out flow');
    t.includes(settings, 'Reopen', 'Reopen lives in the same place');
    t.excludes(app.fn.renderJobDetail('sh-open'), 'closeOutSheet', 'job detail has NO close-out affordance');
    t.excludes(app.fn.unitCard(u, 'sh-open'), 'closeOutSheet', 'unit card has NO close-out affordance');
    t.excludes(app.fn.renderJobsList(), 'closeOutSheet', 'jobs list has NO close-out affordance');
  }

  t.group('confirm requires typing the job name; closing writes archivedAt and nothing else');
  {
    const u1 = mkUnit({ id: 'u-c1', locationId: 'sh-open' });
    app.setState({ shows: baseShows(), units: [u1], reports: [], issues: [], movements: [] });
    const unitsBefore = JSON.stringify(app.S.units);
    app.fn.closeOutSheet('sh-open');
    const conf = app.document.querySelector('#sheet').innerHTML;
    t.includes(conf, 'co_name', 'confirm sheet asks for the typed name');
    t.includes(conf, 'moves nothing', 'confirm copy states closing moves nothing');
    app.document.querySelector('#co_name').value = 'Coachella';
    app.fn.doCloseOut('sh-open');
    t.eq(app.S.shows.find(s => s.id === 'sh-open').archivedAt, null, 'wrong name refuses to close');
    app.document.querySelector('#co_name').value = '  portola  ';
    app.fn.doCloseOut('sh-open');
    t.ok(app.S.shows.find(s => s.id === 'sh-open').archivedAt != null, 'trimmed case-insensitive match closes');
    t.eq(JSON.stringify(app.S.units), unitsBefore, 'closing edits NO unit rows');
    t.eq(app.S.movements.length, 0, 'closing moves nothing — no movement rows');
  }

  t.group('reopen clears archivedAt and the nag comes back');
  {
    const u = mkUnit({ id: 'u-r1' });
    app.setState({ shows: baseShows(), units: [u], reports: [], issues: [], movements: [] });
    t.eq(app.fn.isStale(u), false, 'closed: silent');
    app.fn.doReopen('sh-closed');
    t.eq(app.S.shows.find(s => s.id === 'sh-closed').archivedAt, null, 'reopen writes null');
    t.eq(app.fn.isStale(u), true, 'reopened: the staleness clock is honest again');
  }

  /* ---------------------------------------------------------------- */
  t.group('jobs list: closed jobs collapse into a Closed group');
  {
    app.setState({ shows: baseShows(), units: [], reports: [], issues: [], movements: [] });
    app.live.jobsSearch = '';
    const html = app.fn.renderJobsList();
    t.includes(html, 'Portola', 'open job renders in the working list');
    t.includes(html, 'Closed (1)', 'closed group header carries the count');
    t.excludes(html, 'Lollapalooza', 'closed job hidden while the group is collapsed');
    app.fn.closedToggle();
    const html2 = app.fn.renderJobsList();
    t.includes(html2, 'Lollapalooza', 'expanding the group reveals the closed job');
    app.fn.closedToggle(); /* back to collapsed for later groups */
    app.live.jobsSearch = 'lolla';
    const html3 = app.fn.renderJobsList();
    t.includes(html3, 'Lollapalooza', 'search reaches closed jobs even while collapsed');
    app.live.jobsSearch = '';
  }

  t.group('archived stays readable — hidden from nags, never from people');
  {
    const u = mkUnit({ id: 'u-v1', serial: 'READBACK1' });
    app.setState({ shows: baseShows(), units: [u],
      reports: [{ id: 'r-v1', unitId: 'u-v1', showId: 'sh-closed', timestamp: NOW - 2 * DAY, engineHours: 1234 }],
      issues: [], movements: [] });
    const detail = app.fn.renderJobDetail('sh-closed');
    t.includes(detail, 'READBACK1', 'closed job detail still renders its units');
    t.includes(detail, 'Closed', 'closed job detail says so — information, not an action');
    t.noThrow(() => app.fn.openJobLog('sh-closed'), 'activity log still opens on a closed job');
    const log = app.document.querySelector('#sheet').innerHTML;
    t.includes(log, 'READBACK1', 'closed job log still shows its history');
    t.eq(app.fn.reportsFor('u-v1').length, 1, 'checks stay readable — nothing filtered from history');
  }

  t.group('archivedAt round-trips ms <-> ISO through the sync layer (we depend on it now)');
  {
    const s = { id: 'sh-rt', name: 'RT', archivedAt: 1758500000000, createdAt: 1758400000000 };
    const row = app.fn.toRow('shows', s);
    t.ok(String(row.archived_at).includes('T'), 'archived_at serializes as ISO');
    const back = app.fn.fromRow('shows', row);
    t.eq(back.archivedAt, 1758500000000, 'archivedAt survives the round trip in ms');
  }
};
