/**
 * fv_inv_placementphotos.js — standing invariants for placement photos.
 *
 * A placement photo documents how a unit sat on THIS job. It attaches to the
 * MOVEMENT record — born with it, never edited in (movements stay append-only)
 * — so it can't be overwritten, can't travel to the next show, and can't crowd
 * out the condition photos that live on the unit and DO travel. Uploads reuse
 * the Storage path (no base64 in rows — that debt is closed and stays closed),
 * under movements/<id>/<ms>-<uuid>.jpg so photos are timestamp-matchable.
 */
'use strict';
module.exports = async (app, t) => {
  const D = 'data:image/jpeg;base64,U1RVQg==';
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    opStatus: 'running', locationType: 'show', locationId: 'show-A', photos: ['https://x/condition.jpg'],
    jobMeta: {}, updatedAt: 1 }, o);

  t.group('placement photos: born on the movement, unit photos untouched');
  app.setState({ units: [mkUnit({ id: 'u-pl' })], shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  const before = app.S.movements.length;
  app.fn.capturePlacement('u-pl', D);
  t.eq(app.S.movements.length, before + 1, 'capture creates a NEW movement (append-only intact)');
  const mv = app.S.movements[app.S.movements.length - 1];
  t.deep(mv.photos, [D], 'photo rides on the movement record');
  t.eq(mv.unitId, 'u-pl', 'attached to the right unit movement');
  t.ok(mv.gps, 'GPS captured as before');
  t.deep(app.S.units[0].photos, ['https://x/condition.jpg'], 'condition photos on the unit untouched');
  app.fn.capturePlacement('u-pl');
  t.ok(app.S.movements[app.S.movements.length - 1].photos == null, 'photo is optional — plain capture unchanged');

  t.group('placement photos: flush uploads to movements/ path, timestamped, URL swapped');
  app.live.SNAP = {}; app.SYNC_READY = true;
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  const up = app.supabaseCalls.find((c) => c.op === 'upload' && String(c.payload.path).indexOf('movements/') === 0);
  t.ok(up, 'uploaded under movements/<id>/');
  t.ok(up && /^movements\/[^/]+\/\d{13}-/.test(up.payload.path), 'filename carries ms timestamp for later matching');
  t.excludes(JSON.stringify(app.supabaseCalls.filter((c) => c.table === 'movements' && c.op === 'upsert')),
    'data:image', 'no base64 persisted on movement rows');
  t.includes(mv.photos[0], 'storage/v1/object/public/unit-photos/movements/', 'row now holds the URL');

  t.group('placement photos: round-trip and display');
  t.eq(app.fn.toRow('movements', mv).photos, mv.photos, 'photos mapped in MAPS (persists)');
  t.deep(app.fn.fromRow('movements', app.fn.toRow('movements', mv)).photos, mv.photos, 'round-trips');
  const pane = app.fn.paneMoves(app.S.units[0], 'A');
  t.includes(pane, 'bigMovePhoto', 'placement pane history shows the photo');
  t.includes(pane, 'Capture placement + photo', 'capture-with-photo entry point present');
  t.includes(pane, 'not the asset', 'the stays-with-this-placement rule is stated on the surface');
  app.fn.openJobLog('show-A');
  t.includes(app.document.querySelector('#sheet').innerHTML, 'bigMovePhoto', 'job log shows movement photos');
};
