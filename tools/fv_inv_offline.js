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

  t.group('interim guard: a failed write is never marked as synced (§8.12)');
  // The 2026-08-01 movements incident: warn-and-resnapshot converted a missing
  // column into 14 hours of permanent invisible loss. Failure now stays dirty,
  // retries, and lights a chip the user can see.
  app.setState({ units: [mkUnit({ id: 'u-g1', serial: 'GUARD1' })], shows: [{ id: 'show-A', name: 'A' }] });
  app.SYNC_READY = true;
  app.S.units[0].notes = 'edit that must not vanish';
  app.opts.writeError = (t2) => (t2 === 'units' ? { message: 'column units.ghost does not exist' } : null);
  await app.fn.flush();
  app.opts.writeError = null;
  const snapRow = app.live.SNAP.units && app.live.SNAP.units['u-g1'];
  t.excludes(String(snapRow), 'edit that must not vanish', 'failed table did NOT re-baseline — rows stay dirty');
  t.ok(app.live.SYNC_FAILS.units === 1, 'failure counted (got ' + JSON.stringify(app.live.SYNC_FAILS) + ')');
  app.fn.updateSyncChip();
  const chip = app.document.querySelector('#syncChip');
  t.ok(chip.style.display !== 'none', 'chip visible — a console nobody reads is not surfacing');
  t.includes(chip.textContent, '1 unsaved', 'chip counts the unsaved changes');
  t.ok(app.timers.some((x) => x.ms === 30000), 'retry scheduled');
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  t.ok(app.supabaseCalls.some((c) => c.table === 'units' && c.op === 'upsert' &&
    JSON.stringify(c.payload).includes('edit that must not vanish')), 'retry re-sends the same dirty row');
  t.includes(String(app.live.SNAP.units['u-g1']), 'edit that must not vanish', 'ack advances SNAP');
  t.deep(app.live.SYNC_FAILS, {}, 'fails cleared on success');
  app.fn.updateSyncChip();
  t.eq(chip.style.display, 'none', 'chip hidden when everything saved');

  t.group('interim guard: one bad table does not poison the others');
  app.setState({ units: [mkUnit({ id: 'u-g2' })], shows: [{ id: 'show-A', name: 'A' }] });
  app.SYNC_READY = true;
  app.S.units[0].notes = 'unit edit';
  app.S.reports.push(mkReport('u-g2', { id: 'r-g2' }));
  app.opts.writeError = (t2) => (t2 === 'units' ? { message: 'boom' } : null);
  await app.fn.flush();
  app.opts.writeError = null;
  t.ok(app.live.SNAP.reports && app.live.SNAP.reports['r-g2'], 'healthy table acked and re-baselined');
  t.excludes(String(app.live.SNAP.units['u-g2'] || ''), 'unit edit', 'failing table alone stays dirty');

  t.group('interim guard: failed deletes are retried too');
  app.setState({ shops: [{ id: 'shop-g', name: 'Yard' }] });
  app.SYNC_READY = true;
  app.S.shops = [];
  app.opts.writeError = (t2, op) => (t2 === 'shops' && op === 'delete' ? { message: 'boom' } : null);
  await app.fn.flush();
  app.opts.writeError = null;
  t.ok(app.live.SNAP.shops && app.live.SNAP.shops['shop-g'], 'failed delete keeps its SNAP entry (still owed)');
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  t.ok(app.supabaseCalls.some((c) => c.table === 'shops' && c.op === 'delete'), 'delete re-attempted');
  t.ok(!app.live.SNAP.shops['shop-g'], 'acked delete clears the SNAP entry');
};
