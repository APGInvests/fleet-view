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
};
