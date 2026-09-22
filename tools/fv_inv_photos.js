/**
 * fv_inv_photos.js — standing invariants for the photo storage path.
 *
 * Contract: photo capture writes data URIs into the row (works offline, UX
 * unchanged). flush() swaps them for Storage URLs before serializing, so rows
 * only ever persist URLs when Storage is reachable — and a Storage outage
 * never blocks the save or drops the photo. The upload pass is bounded
 * (PHOTO_FLUSH_CAP per flush, timeout per upload) because it runs inside
 * flush() while `flushing=true`.
 */
'use strict';
module.exports = async (app, t) => {
  const D = 'data:image/jpeg;base64,U1RVQg==';

  t.group('photos: lazy upload at flush');
  app.setState({ units: [{ id: 'u1', serial: 'A1', photos: [D], jobMeta: {} }] });
  app.SYNC_READY = true;
  app.live.SNAP = {}; // a freshly captured photo is always DIRTY — the diff is captured
                      // before upload, and the swap patches the captured row's photos
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  const ups = app.supabaseCalls.filter((c) => c.table === 'units' && c.op === 'upsert');
  t.ok(ups.length === 1, 'unit row upserted after photo swap dirties it');
  const sent = JSON.stringify(ups[0] ? ups[0].payload : '');
  t.excludes(sent, 'data:image', 'no base64 in upsert payload when Storage reachable');
  t.includes(sent, 'storage/v1/object/public/unit-photos', 'photo persisted as public URL');
  t.ok(app.supabaseCalls.some((c) => c.op === 'upload'), 'blob actually uploaded');

  t.group('photos: Storage failure does not block the save');
  app.opts.storageError = () => ({ message: 'Failed to fetch' });
  app.setState({ units: [{ id: 'u2', serial: 'A2', photos: [D], jobMeta: {} }] });
  app.live.SNAP = {}; // row is dirty, as after a real save()
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  app.opts.storageError = null;
  const ups2 = app.supabaseCalls.filter((c) => c.table === 'units' && c.op === 'upsert');
  t.ok(ups2.length === 1, 'row still saves when Storage is down');
  t.eq(app.S.units[0].photos[0], D, 'data URI retained for a later retry, not dropped');

  t.group('photos: upload pass is bounded per flush');
  const many = Array.from({ length: 10 }, () => D);
  app.setState({ units: [{ id: 'u3', serial: 'A3', photos: many, jobMeta: {} }] });
  app.live.SNAP = {};
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  const uploads = app.supabaseCalls.filter((c) => c.op === 'upload').length;
  t.ok(uploads <= 6, 'at most PHOTO_FLUSH_CAP uploads per flush (got ' + uploads + ')');
  t.ok(app.S.units[0].photos.some((p) => String(p).slice(0, 5) === 'data:'),
    'overflow photos remain queued for the next flush');

  t.group('photos: issue photos take the same path');
  app.setState({
    units: [{ id: 'u4', serial: 'A4', photos: [], jobMeta: {} }],
    issues: [{ id: 'i1', unitId: 'u4', severity: 'cosmetic', title: 'ding', photos: [D], timestamp: 1000, resolved: false }],
  });
  app.live.SNAP = {};
  app.supabaseCalls.length = 0;
  await app.fn.flush();
  const iu = app.supabaseCalls.filter((c) => c.table === 'issues' && c.op === 'upsert');
  t.ok(iu.length === 1, 'issue row upserted after swap');
  t.excludes(JSON.stringify(iu[0] ? iu[0].payload : ''), 'data:image', 'issue photos also persist as URLs');

  t.group('asset photos: Info tab is the home, empty state nudges (2026-09-21, add-sheet-trim)');
  {
    /* Two photo kinds, two homes: placement photos live on the job (movement
       kind:'photo'); ASSET photos — size, chassis, forklift pockets, condition —
       live on the unit, shown on the Info tab. The nudge is Info-tab-only and
       muted: photos stay optional (§8 rule 6), and the receipt loop is sacred —
       the add sheet never mentions photos at all. */
    const bare = { id: 'u-ph-1', serial: 'NUDGE1', tagId: '', klass: 'small', make: 'MQ', model: 'DCA25',
      kw: 25, photos: [], jobMeta: {}, opStatus: 'staged', locationType: 'fleet', locationId: null };
    let h = app.fn.paneInfo(bare, 'Unassigned');
    t.includes(h, 'No photos of this asset yet', 'empty state says why the strip is blank');
    t.includes(h, 'forklift pockets', 'and names what a useful shot shows');
    t.includes(h, 'Add photo', 'the add button stays right there');
    const withPhoto = Object.assign({}, bare, { id: 'u-ph-2', photos: ['https://x/unit-photos/units/a/1-p.jpg'] });
    h = app.fn.paneInfo(withPhoto, 'Unassigned');
    t.excludes(h, 'No photos of this asset yet', 'a unit with photos never sees the nudge');

    app.setState({ units: [], shows: [{ id: 'show-PH-A', name: 'Nudge Fest' }], movements: [], reports: [] });
    app.live.TAB = 'jobs'; app.S.currentShowId = 'show-PH-A';
    app.fn.openScan();
    const sh = app.document.querySelector('#sheet').innerHTML.toLowerCase();
    t.excludes(sh, 'photo', 'the add sheet never asks for a photo — receipt loop stays friction-free');
  }
};
