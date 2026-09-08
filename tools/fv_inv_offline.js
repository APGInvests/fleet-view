/**
 * fv_inv_offline.js — standing invariants for the offline write path.
 *
 * This file accretes group-by-group as Phase 3 of
 * docs/plans/2026-07-29-offline-write-path.md lands (durable cache, clock
 * drift, ack-correct flush, dead-letter, merge, reconnect).
 *
 * First group, landed ahead of Phase 3 because everything else leans on it:
 * units conflict resolution is last-write-wins by `updatedAt`, so EVERY code
 * path that mutates a S.units row must bump `updatedAt`. A mutator that
 * forgets makes its edits lose every merge conflict they should win.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    opStatus: 'staged', locationType: 'show', locationId: 'show-A', photos: [], jobMeta: {}, updatedAt: 1000 }, o);
  const mkReport = (unitId, o = {}) => Object.assign({ id: id('r'), unitId, showId: 'show-A',
    techName: 'Mike R.', timestamp: 5000, gps: null }, o);
  void mkReport; // used by later Phase 3 groups

  t.group('LWW precondition: every S.units mutator bumps updatedAt');
  const drive = (name, setup, invoke) => {
    app.setState({ units: [mkUnit({ id: 'u-mut', updatedAt: 1 })],
                   shows: [{ id: 'show-A', name: 'A' }], shops: [] });
    app.S.settings.techName = 'Mike R.';
    if (setup) setup();
    try { invoke(); } catch (e) { t.ok(false, name + ' bumps updatedAt', 'threw: ' + e.message); return; }
    app.flushTimers();
    const u = app.S.units.find((x) => x.id === 'u-mut');
    t.ok(u && u.updatedAt > 1, name + ' bumps updatedAt (got ' + (u && u.updatedAt) + ')');
  };
  const $v = (sel, v) => { app.document.querySelector(sel).value = v; };

  drive('saveVitals',       () => $v('#v_notes', 'ok'),                                   () => app.fn.saveVitals('u-mut'));
  drive('saveIssue',        () => $v('#i_title', 'leak'),                                 () => app.fn.saveIssue('u-mut'));
  drive('saveService',      () => { $v('#s_cur', '10'); $v('#s_due', '250'); },           () => app.fn.saveService('u-mut'));
  drive('doServiced',       () => { $v('#ms_at', '10'); $v('#ms_int', '250'); },          () => app.fn.doServiced('u-mut'));
  drive('saveJobMeta',      () => { $v('#jm_name', 'Stage'); $v('#jm_area', ''); $v('#jm_note', ''); }, () => app.fn.saveJobMeta('u-mut', 'show-A'));
  drive('doMove',           null,                                                          () => app.fn.doMove('u-mut', 'shop', null));
  drive('doShip',           () => $v('#shipTo', 'show-A'),                                 () => app.fn.doShip('u-mut'));
  drive('mapSetLoc',        null,                                                          () => app.fn.mapSetLoc('u-mut'));
  drive('capturePlacement', null,                                                          () => app.fn.capturePlacement('u-mut'));
  drive('rmUnitPhoto',      () => { app.S.units[0].photos = ['https://x/p.jpg']; },        () => app.fn.rmUnitPhoto('u-mut', 0));

  t.group('ack flush: retryable failure stays dirty, retries, chip counts (§8.12)');
  app.setState({ units: [mkUnit({ id: 'u-g1', serial: 'GUARD1' })], shows: [{ id: 'show-A', name: 'A' }] });
  app.SYNC_READY = true; app.live.DEAD = {}; app.live.SYNC_LOST = [];
  app.S.units[0].notes = 'edit that must not vanish';
  app.opts.writeError = (t2) => (t2 === 'units' ? { message: 'TypeError: Failed to fetch' } : null);
  await app.fn.flush();
  app.opts.writeError = null;
  t.excludes(String(app.live.SNAP.units && app.live.SNAP.units['u-g1']), 'edit that must not vanish', 'failed row did NOT re-baseline');
  t.ok((app.live.SYNC_FAILS['(pending)'] || 0) >= 1, 'pending count surfaced (got ' + JSON.stringify(app.live.SYNC_FAILS) + ')');
  app.fn.updateSyncChip();
  const chip = app.document.querySelector('#syncChip');
  t.includes(chip.textContent, 'unsaved', 'chip shows unsaved');
  t.ok(app.timers.some((x) => x.ms === 30000), 'retry scheduled');
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  t.includes(String(app.live.SNAP.units['u-g1']), 'edit that must not vanish', 'ack advances SNAP after recovery');
  t.deep(app.live.SYNC_FAILS, {}, 'fails cleared on success');

  t.group('ack flush: the mid-flight race is closed — diff captured at entry, acks from captured rows');
  app.setState({ units: [mkUnit({ id: 'u-race' })], shows: [{ id: 'show-A', name: 'A' }] });
  app.SYNC_READY = true;
  app.S.units[0].notes = 'first edit';
  const p1 = app.fn.flush();                                  // captures diff synchronously
  app.S.reports.push(mkReport('u-race', { id: 'r-race' }));   // lands mid-flight
  await p1;
  t.ok(!(app.live.SNAP.reports && app.live.SNAP.reports['r-race']), 'mid-flight report NOT absorbed as synced');
  t.ok(app.fn.dirtyCount() >= 1, 'still queued');
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  t.ok(app.supabaseCalls.some((c) => c.table === 'reports' && c.op === 'upsert'), 'tail-drain sent it');

  t.group('ack flush: ordered replay — children never outrun a failed parent');
  app.setState({ shows: [{ id: 's-o', name: 'O' }], units: [mkUnit({ id: 'u-o', locationId: 's-o' })], reports: [] });
  app.SYNC_READY = true; app.live.SNAP = {};
  app.S.reports.push(mkReport('u-o', { id: 'r-o' }));
  app.opts.writeError = (t2) => (t2 === 'units' ? { message: 'network down' } : null);
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  app.opts.writeError = null;
  t.ok(app.live.SNAP.shows && app.live.SNAP.shows['s-o'], 'parent table before the failure acked');
  t.ok(!app.supabaseCalls.some((c) => c.table === 'reports' && c.op === 'upsert'), 'tables after the failed one were NOT attempted');

  t.group('ack flush: poison quarantined per-row, visible, and RECOVERABLE (transient-config case)');
  // The incident class: 'column ... does not exist' is non-retryable at the moment
  // but transient config — the column can arrive later. Retry must exist.
  app.setState({ units: [mkUnit({ id: 'u-ok1' }), mkUnit({ id: 'u-poison', serial: 'BAD' }), mkUnit({ id: 'u-ok2' })], shows: [{ id: 'show-A', name: 'A' }] });
  app.SYNC_READY = true; app.live.SNAP = {}; app.live.DEAD = {};
  app.opts.writeError = (t2, op, rows) => (t2 === 'units' && JSON.stringify(rows).includes('BAD') ? { message: 'column units.ghost does not exist' } : null);
  await app.fn.flush();
  app.opts.writeError = null;
  t.eq(Object.keys(app.live.DEAD).length, 1, 'exactly the poison row quarantined');
  t.ok(app.live.DEAD['units:u-poison'], 'keyed by table:id');
  t.ok(app.S.units.some((u) => u.id === 'u-poison'), 'row data still present locally');
  t.eq(app.fn.dirtyCount(), 0, 'healthy rows in the same batch isolated and acked');
  app.fn.updateSyncChip();
  t.includes(app.document.querySelector('#syncChip').textContent, 'stuck', 'chip shows stuck');
  app.fn.openSyncStatus();
  const sh = app.document.querySelector('#sheet').innerHTML;
  t.includes(sh, 'retryDead', 'Retry path exists — quarantine is recoverable, not just visible');
  t.includes(sh, 'copyDead', 'Copy JSON escape hatch');
  t.includes(sh, 'does not exist', 'server error shown to the human');
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  t.ok(!app.supabaseCalls.some((c) => c.op === 'upsert'), 'quarantined row does not spam the queue');
  app.fn.retryDead('units:u-poison');                          // config fixed -> human retries
  await app.fn.flush();
  t.eq(Object.keys(app.live.DEAD).length, 0, 'retry clears quarantine');
  t.ok(app.live.SNAP.units && String(app.live.SNAP.units['u-poison'] || '').includes('BAD'), 'retried row flushed and acked');

  t.group('ack flush: deletes — retryable stays owed; quarantined delete recoverable via retryDead');
  app.setState({ shops: [{ id: 'shop-g', name: 'Yard' }] });
  app.SYNC_READY = true; app.live.DEAD = {};
  app.S.shops = [];
  app.opts.writeError = (t2, op) => (t2 === 'shops' && op === 'delete' ? { message: 'network down' } : null);
  await app.fn.flush();
  t.ok(app.live.SNAP.shops && app.live.SNAP.shops['shop-g'], 'retryable failed delete keeps its SNAP entry (still owed)');
  app.opts.writeError = (t2, op) => (t2 === 'shops' && op === 'delete' ? { message: 'permission denied for table shops' } : null);
  await app.fn.flush();
  app.opts.writeError = null;
  t.ok(app.live.DEAD['shops:shop-g'], 'non-retryable delete quarantined');
  t.ok(!app.live.SNAP.shops['shop-g'], 'and no longer re-sent blindly');
  app.fn.retryDead('shops:shop-g');
  t.ok(app.live.SNAP.shops['shop-g'], 'retryDead restores the owed delete');
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  t.ok(app.supabaseCalls.some((c) => c.table === 'shops' && c.op === 'delete'), 'delete re-attempted after human retry');
  t.ok(!app.live.SNAP.shops['shop-g'], 'acked delete clears the SNAP entry');

  t.group('durable cache: queue and quarantine survive an app kill');
  app.setState({ units: [mkUnit({ id: 'u-cache', serial: 'CACHE1' })], shows: [{ id: 'show-A', name: 'A' }] });
  app.SYNC_READY = true;
  app.S.units[0].notes = 'unsaved edit';                       // dirty vs snapshot
  app.live.DEAD = { 'units:u-dead': { table: 'units', op: 'upsert', rowId: 'u-dead', row: { id: 'u-dead' }, error: 'x', ts: 1 } };
  app.live.SYNC_LOST = [{ table: 'units', serial: 'LOSTX', row: {}, ts: 1 }];
  app.timers.length = 0;                       // drop stale captured timers from earlier
  app.fn.persistCache(); app.flushTimers();    // groups (an old scheduled flush would ack the row)
  await Promise.resolve();
  const c = await app.live.KV.get('cache');
  t.ok(c && c.v === 1, 'cache written');
  t.includes(JSON.stringify(c.tables.units), 'unsaved edit', 'dirty S rows persisted');
  t.ok(c.dead['units:u-dead'], 'quarantine persisted');
  t.eq(c.lost.length, 1, 'overwritten list persisted');
  t.excludes(JSON.stringify(c.snap.units || {}), 'unsaved edit', 'old SNAP persisted too — dirt is still dirt after restart');
  app.setState({}); app.live.DEAD = {}; app.live.SYNC_LOST = [];
  const hyd = await app.fn.hydrateFromCache();
  t.ok(hyd, 'hydrate reports success');
  t.eq(app.S.units[0].serial, 'CACHE1', 'cold boot is not an empty fleet');
  t.ok(app.fn.dirtyCount() >= 1, 'the queued edit is STILL QUEUED after restart (rule 12 across restarts)');
  t.ok(app.live.DEAD['units:u-dead'], 'quarantine restored');
  t.eq(app.live.SYNC_LOST.length, 1, 'overwritten list restored');

  t.group('reconnect: registered once, read-merge strictly before write');
  app.setState({ units: [mkUnit({ id: 'u-net', updatedAt: 9000 })], shows: [{ id: 'show-A', name: 'A' }] });
  app.SYNC_READY = true; app.live.DEAD = {}; app.live.SYNC_LOST = [];
  app.S.units[0].notes = 'queued offline'; app.S.units[0].updatedAt = 9500;
  app.opts.tableData = { units: [] };
  app.fn.initNetTriggers();
  app.fn.initNetTriggers();                                    // deliberate double call
  t.eq((app.windowListeners['online'] || []).length, 1, 'online listener registered exactly once');
  t.eq((app.windowListeners['doc:visibilitychange'] || []).length, 1, 'visibility listener registered exactly once');
  app.supabaseCalls.length = 0;
  app.timers.length = 0;
  app.fireWindow('online');
  await new Promise((r) => setTimeout(r, 5)); app.flushTimers(); await new Promise((r) => setTimeout(r, 5));
  const firstSelect = app.supabaseCalls.findIndex((c) => c.op === 'select');
  const firstUpsert = app.supabaseCalls.findIndex((c) => c.op === 'upsert');
  t.ok(firstSelect !== -1 && firstUpsert !== -1, 'reconnect both reloads and flushes');
  t.ok(firstSelect < firstUpsert, 'merge (read) strictly precedes flush (write) on reconnect');
  app.opts.tableData = null;

  t.group('offline cold-start: dead-zone contracts (incident 2026-08-04)');
  /* An expired token on queued offline work must RETRY (netBack refreshes it),
   * never quarantine — a 401 here is field data eaten for a self-healing cause. */
  const R = app.live.RETRYABLE;
  t.ok(typeof R === 'function', 'RETRYABLE reachable via live binding');
  t.ok(R({ message: 'JWT expired' }), 'expired JWT is retryable');
  t.ok(R({ message: 'signal timed out', name: 'AbortError' }) || R({ message: 'AbortError: aborted' }), 'aborted (timed-out) select/upsert is retryable');
  t.ok(R({ code: '401', message: 'Unauthorized' }), '401 is retryable');
  t.ok(!R({ message: 'permission denied for table units', code: '42501' }), 'a real RLS denial still quarantines (not retryable)');
  t.ok(!R({ message: 'column shows.nope does not exist', code: '42703' }), 'schema drift still quarantines (not retryable)');

  // stored-session fallback: previously-signed-in device boots offline
  app.context.localStorage.setItem('sb-eujgglfcpdfgskyqfggg-auth-token',
    JSON.stringify({ currentSession: { access_token: 't', user: { id: 'u-off', email: 'tech@ces.com' } } }));
  const ss = app.fn.storedSession();
  t.ok(ss && ss.user && ss.user.email === 'tech@ces.com', 'storedSession recovers the persisted session (wrapped form)');
  app.context.localStorage.setItem('sb-eujgglfcpdfgskyqfggg-auth-token',
    JSON.stringify({ access_token: 't', user: { id: 'u-off2' } }));
  t.ok(app.fn.storedSession().user.id === 'u-off2', 'storedSession recovers the persisted session (flat form)');
  app.context.localStorage.removeItem('sb-eujgglfcpdfgskyqfggg-auth-token');
  t.eq(app.fn.storedSession(), null, 'no persisted session -> null (auth screen is then correct)');

  // offline empty state: never "create your first show" when the truth is "no signal"
  app.setState({ shows: [], units: [] });
  app.live.NET_DOWN = true;
  const emptyOffline = app.fn.renderJobsList();
  t.includes(emptyOffline, 'No signal', 'offline empty jobs list says no-signal, not no-jobs');
  t.excludes(emptyOffline, 'Create your first show', 'offline empty state never invites creating a duplicate fleet');
  app.live.NET_DOWN = false;
  t.includes(app.fn.renderJobsList(), 'Create your first show', 'online empty state keeps the create path');

  // the chip tells the truth about offline and about a broken durable cache
  app.live.NET_DOWN = true; app.live.CACHE_AGE = 1000; app.fn.updateSyncChip();
  t.includes(app.document.querySelector('#syncChip').textContent, 'offline', 'chip shows offline state');
  app.live.NET_DOWN = false; app.live.CACHE_BROKEN = true; app.fn.updateSyncChip();
  t.includes(app.document.querySelector('#syncChip').textContent, 'no offline backup', 'a broken durable cache is LOUD (audit A2)');
  app.live.CACHE_BROKEN = false; app.fn.updateSyncChip();

  t.group('cache restore: schema growth never manufactures conflicts (mass false-overwritten, 2026-08-13)');
  /* The incident: adding units.has_def to MAPS changed toRow's serialization,
   * so every pre-upgrade cached SNAP string mismatched — 274 untouched rows
   * read "dirty", tied on updatedAt (>= parks the tie), and the whole fleet
   * parked in SYNC_LOST at one page-load. On restore, SNAP strings must be
   * normalized through the CURRENT schema: key growth/removal/order washes
   * out; real value differences stay dirty. Dirt is never laundered. */
  const doctorCache = async (mutate) => {
    app.setState({ units: [
      mkUnit({ id: 'u-n1', serial: 'N1', updatedAt: 7000, hasDef: null }),
      mkUnit({ id: 'u-n2', serial: 'N2', updatedAt: 7000, hasDef: null }),
      mkUnit({ id: 'u-n3', serial: 'N3', updatedAt: 7000, hasDef: null }),
    ], shows: [{ id: 'show-A', name: 'A' }] });
    app.SYNC_READY = true; app.live.DEAD = {}; app.live.SYNC_LOST = [];
    const clean = app.S.units.map((o) => app.fn.fromRow('units', app.fn.toRow('units', o)));
    app.timers.length = 0; app.fn.persistCache(); app.flushTimers(); await Promise.resolve();
    const cc = await app.live.KV.get('cache');
    for (const uid2 in cc.snap.units) {                    /* pre-has_def vintage */
      const row = JSON.parse(cc.snap.units[uid2]); delete row.has_def;
      cc.snap.units[uid2] = JSON.stringify(row);
    }
    cc.tables.units.forEach((u) => { delete u.hasDef; });
    if (mutate) mutate(cc);
    await app.live.KV.set('cache', cc);
    app.setState({ units: [], shows: [] }); app.live.SYNC_LOST = [];
    const ok2 = await app.fn.hydrateFromCache();
    return { clean, hydrated: ok2 };
  };

  const { clean } = await doctorCache();
  app.fn.mergeServerState('units', clean.map((o) => Object.assign({}, o)));
  t.eq(app.live.SYNC_LOST.length, 0, 'identical server rows + grown schema parks NOTHING');
  t.eq(app.S.units.length, 3, 'all rows survive the merge');
  t.ok(app.fn.dirtyCount() === 0, 'and nothing reads dirty (got ' + app.fn.dirtyCount() + ')');

  const edited = await doctorCache((cc) => {
    const u3 = cc.tables.units.find((x) => x.id === 'u-n3');
    u3.notes = 'FIELD EDIT'; u3.updatedAt = 8000;         /* real unsaved edit, locally newer */
  });
  app.fn.mergeServerState('units', edited.clean.map((o) => Object.assign({}, o)));
  t.eq(app.live.SYNC_LOST.length, 0, 'locally-newer real edit parks nothing');
  const u3m = app.S.units.find((x) => x.id === 'u-n3');
  t.ok(u3m && u3m.notes === 'FIELD EDIT', 'the real edit WINS the merge (normalization never launders dirt)');
  const newer = edited.clean.map((o) => Object.assign({}, o, o.id === 'u-n3' ? { updatedAt: 9000 } : {}));
  app.fn.mergeServerState('units', newer);
  t.eq(app.live.SYNC_LOST.length, 1, 'server-newer real conflict still parks — exactly the one row');
  t.eq(app.live.SYNC_LOST[0] && app.live.SYNC_LOST[0].serial, 'N3', 'and it is the edited row, by serial');

  const bad2 = await doctorCache((cc) => { cc.snap.units['u-n1'] = '{corrupt'; });
  t.ok(bad2.hydrated, 'a malformed SNAP string never breaks hydrate');
  t.eq(app.S.units.length, 3, 'rows all restored despite the bad string');

  t.group('sync sheet: overwritten list has dismiss-all, and dismissals persist');
  app.setState({ shows: [], units: [] });
  app.live.SYNC_LOST = [
    { table: 'units', serial: 'A1', row: { notes: 'x' }, ts: 1 },
    { table: 'units', serial: 'A2', row: {}, ts: 1 },
    { table: 'units', serial: 'A3', row: {}, ts: 1 }];
  app.fn.openSyncStatus();
  const shL = app.document.querySelector('#sheet').innerHTML;
  t.includes(shL, 'dismissAllLost', 'dismiss-all control exists (274 taps is not a workflow)');
  t.ok(typeof app.fn.dismissAllLost === 'function', 'dismissAllLost is wired');
  app.timers.length = 0;
  if (typeof app.fn.dismissAllLost === 'function') app.fn.dismissAllLost();
  t.eq(app.live.SYNC_LOST.length, 0, 'one tap clears the whole list');
  t.excludes(app.document.querySelector('#sheet').innerHTML, 'Overwritten while unsaved', 'sheet re-renders without the section');
  app.flushTimers(); await Promise.resolve();
  const cAfter = await app.live.KV.get('cache');
  t.eq((cAfter && cAfter.lost || []).length, 0, 'dismiss-all persists — the list must not resurrect on reload');
  app.live.SYNC_LOST = [{ table: 'units', serial: 'B1', row: {}, ts: 1 }, { table: 'units', serial: 'B2', row: {}, ts: 1 }];
  app.timers.length = 0; app.fn.dismissLost(0); app.flushTimers(); await Promise.resolve();
  const cOne = await app.live.KV.get('cache');
  t.eq((cOne && cOne.lost || []).length, 1, 'single dismiss persists too');
  app.live.SYNC_LOST = []; app.fn.updateSyncChip();          /* leave no state for the next group */

  t.group('storage persist: requested at boot, denial surfaces in sheet only (never the chip)');
  t.includes(String(app.fn.boot), 'requestPersist()', 'boot requests persistent storage for the write queue');
  try { app.fn.requestPersist(); t.ok(true, 'requestPersist tolerates a navigator without storage'); }
  catch (e) { t.ok(false, 'requestPersist tolerates a navigator without storage', 'threw: ' + e.message); }
  app.setState({ shows: [], units: [] });
  app.live.STORAGE_PERSISTED = false;
  app.fn.openSyncStatus();
  t.includes(app.document.querySelector('#sheet').innerHTML, 'best-effort',
    'denied persistence shows the best-effort warning in the sync sheet');
  app.fn.updateSyncChip();
  t.ok(app.document.querySelector('#syncChip').style.display === 'none',
    'denied persistence alone never lights the chip (denial is normal in a browser tab)');
  app.live.STORAGE_PERSISTED = true;
  app.fn.openSyncStatus();
  t.excludes(app.document.querySelector('#sheet').innerHTML, 'best-effort',
    'granted persistence shows no warning');
  app.live.STORAGE_PERSISTED = null;
};
