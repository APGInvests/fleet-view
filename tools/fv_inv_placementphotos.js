/**
 * fv_inv_placementphotos.js — standing invariants for placement photos.
 *
 * Shape (2026-08-01, v2): the movements table is a placement-EVENT log
 * (capturePlacement/mapSetLoc/savePin already write rows where nothing moved).
 * A placement photo is its own typed event — kind:'photo', gps:null, born with
 * its photo, referencing the job through toType/toId like every other event.
 * Two taps, two acts, each attributed to whoever actually did it.
 *
 * THE RULE (same family as "status is not placement"): a kind:'photo' row must
 * never satisfy anything that means "the unit was observed here" — not
 * unitGps, not recentDests, not freshness/staleness. The exclusion is by
 * EXPLICIT kind guard, not by the gps:null field shape — coincidence standing
 * in for a rule is the config==='TwinPak' trap. The adversarial tests below
 * hand a photo event a GPS and a destination and require both to be ignored.
 */
'use strict';
module.exports = async (app, t) => {
  const D = 'data:image/jpeg;base64,U1RVQg==';
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    opStatus: 'running', locationType: 'show', locationId: 'show-A', photos: ['https://x/condition.jpg'],
    jobMeta: {}, updatedAt: 1 }, o);

  t.group('placement photo: its own typed event, nothing else changes');
  app.setState({ units: [mkUnit({ id: 'u-pl' })], shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  const before = app.S.movements.length;
  app.fn.addPlacementPhoto('u-pl', D);
  t.eq(app.S.movements.length, before + 1, 'new row appended — movement rows never edited');
  const mv = app.S.movements[app.S.movements.length - 1];
  t.eq(mv.kind, 'photo', "typed kind:'photo', a stated rule not a field shape");
  t.deep(mv.photos, [D], 'born with its photo');
  t.ok(mv.gps === null, 'claims no position');
  t.eq(mv.toId, 'show-A', 'job-scoped through toId like every event');
  const u = app.S.units[0];
  t.eq(u.updatedAt, 1, 'unit row untouched — a photo mutates nothing about the asset');
  t.deep(u.photos, ['https://x/condition.jpg'], 'condition photos untouched');
  t.group('placement photo: capture stays a single instant act');
  app.fn.capturePlacement('u-pl');
  const cap = app.S.movements[app.S.movements.length - 1];
  t.ok(cap.gps && cap.kind == null && cap.photos == null, 'plain capture: gps yes, no kind, no photo');

  t.group('placement photo: never "observed here" — adversarial, guards must be explicit');
  app.setState({ units: [mkUnit({ id: 'u-adv' })],   // on show-A, running: owes checks
                 shows: [{ id: 'show-A', name: 'A' }], shops: [] });
  // hand the photo event everything the guards are supposed to ignore:
  app.S.movements.push({ id: 'mv-adv', unitId: 'u-adv', fromType: 'show', fromId: 'show-A',
    toType: 'show', toId: 'show-A', techName: 'Mike R.', timestamp: 9999999,
    gps: { lat: 33.6, lng: -116.2, acc: 5 }, photos: [D], kind: 'photo' });
  t.eq(app.fn.unitGps(app.S.units[0]), null, 'unitGps ignores a photo event even when it carries gps');
  t.eq(app.fn.recentDests().length, 0, 'recentDests ignores a photo event even with a valid show destination');
  t.eq(app.fn.lastCheckTs(app.S.units[0]), null, 'freshness: photo is not a check — last check stays never');
  t.ok(app.fn.isStale(app.S.units[0]), 'staleness clock unmoved by a photo event');

  t.group('placement photo: flush, round-trip, display');
  app.setState({ units: [mkUnit({ id: 'u-fl' })], shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  app.fn.addPlacementPhoto('u-fl', D);
  app.live.SNAP = {}; app.SYNC_READY = true;
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  const fmv = app.S.movements[app.S.movements.length - 1];
  t.includes(fmv.photos[0], 'storage/v1/object/public/unit-photos/movements/', 'uploads via the Storage path, URL in the row');
  t.excludes(JSON.stringify(app.supabaseCalls.filter((c) => c.table === 'movements' && c.op === 'upsert')),
    'data:image', 'no base64 persisted');
  t.eq(app.fn.fromRow('movements', app.fn.toRow('movements', fmv)).kind, 'photo', 'kind round-trips (MAPS)');
  const pane = app.fn.paneMoves(app.S.units[0], 'A');
  t.includes(pane, '📷 Placement photo', 'history renders the event as a photo');
  t.excludes(pane.split('📷 Placement photo')[1].split('</div>')[0], '→', 'never renders as a move');
  t.includes(pane, 'Not a location update', 'the rule is stated on the capture surface');
  t.includes(pane, 'btn ghost block" style="margin-top:8px" onclick="document.getElementById(\'plPhotoIn\')',
    'photo action is visually distinct (ghost), not a twin of the primary capture');
  app.fn.openJobLog('show-A');
  t.includes(app.document.querySelector('#sheet').innerHTML, '📷 Placement photo', 'job log labels it honestly');

  t.group('condition photos: empty fleet-wide is EXPECTED, the path is not broken');
  // 2026-08-01 reclassification (docs/photo-reclass.sql): owner confirmed no
  // condition photos existed — every historical shot documented placement, so
  // units.photos was emptied fleet-wide. Condition history starts from zero.
  // If you're reading this because units.photos is empty everywhere: that is
  // the correct state, not a bug. This group proves the capture path works.
  app.setState({ units: [mkUnit({ id: 'u-cond', photos: [] })], shows: [{ id: 'show-A', name: 'A' }] });
  app.fn.handleUnitPhoto({ files: [{ name: 'p.jpg' }], value: '' }, 'u-cond');
  // the harness Image stub's onload fires on Node's real event loop (module-scope
  // setTimeout), not the captured sandbox timers — await a tick, don't flushTimers
  await new Promise((r) => setTimeout(r, 10));
  const cu = app.S.units[0];
  t.eq((cu.photos || []).length, 1, 'condition capture still lands on the unit');
  t.ok(String(cu.photos[0]).slice(0, 5) === 'data:', 'as a data URI awaiting the Storage flush');
  app.live.SNAP = {}; app.supabaseCalls.length = 0;
  await app.fn.flush();
  t.ok(app.supabaseCalls.some((c) => c.op === 'upload' && String(c.payload.path).indexOf('units/') === 0),
    'and still uploads under units/ — asset-level, travels with the machine');
};
