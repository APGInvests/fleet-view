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
};