/**
 * fv_inv_receipt.js — the add-loop receipt banner (add-receipt).
 *
 * Field incident 2026-10-07 (Head Trip): a big-iron move's only confirmation
 * was a 2.2s toast fired while the phone's first-ever location-permission
 * dialog was being dismissed — invisible. The tech backed out of everything
 * to verify the unit landed. Contracts:
 *   1. After a batch move, the reopened add sheet carries a PERSISTENT banner:
 *      size-first identity (size-locked doctrine), destination, pin state, and
 *      the session count. Tapping it opens the unit.
 *   2. A brand-new asset added FROM the add sheet loops back to the add sheet
 *      (batch rhythm) with the same banner — and the unit + its birth movement
 *      exist regardless of anything the banner does.
 *   3. HONESTY: the ✓ claims "recorded on this phone" only. receiptBanner
 *      reads NO sync state — it renders identically whether the flush later
 *      succeeds or fails (the ⚠ chip owns server truth).
 *   4. Session-only: boots to no banner. Receiving never depends on it.
 *   5. No "scanner" vocabulary on these surfaces — everything is typed.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'small',
    make: 'Airman', model: '', kw: 150, opStatus: 'staged',
    locationType: 'fleet', locationId: null, photos: [], jobMeta: {}, updatedAt: 1 }, o);
  const sheetHTML = () => String(app.document.querySelector('#sheet').innerHTML);

  t.group('receipt: fresh session has no banner — the add sheet opens clean');
  {
    app.live.lastReceipt = null; app.live.receiptCount = 0;
    app.setState({ units: [], shows: [{ id: 'show-A', name: 'Head Trip' }] });
    app.S.currentShowId = 'show-A'; app.S.settings.techName = 'Mike R.';
    app.live.TAB = 'jobs';
    app.fn.openScan('job');
    t.excludes(sheetHTML(), 'receiptBanner', 'no banner before anything is received');
    t.eq(!!app.live.lastReceipt, false, 'boot state: no receipt');
  }

  t.group('receipt: a batch move puts a persistent banner on the reopened sheet');
  {
    const u = mkUnit({ id: 'u-rc1', serial: 'TGD62508', klass: 'big', kw: 625, make: 'Technogen', locationType: 'show', locationId: 'show-B' });
    app.setState({ units: [u], shows: [{ id: 'show-A', name: 'Head Trip' }, { id: 'show-B', name: 'B' }] });
    app.S.currentShowId = 'show-A'; app.S.settings.techName = 'Mike R.';
    app.live.lastReceipt = null; app.live.receiptCount = 0; app.live.scanAskHours = false;
    app.fn.doMoveScan('u-rc1', 'show', 'show-A'); app.flushTimers();
    const h = sheetHTML();
    t.includes(h, 'receiptBanner', 'banner present on the reopened add sheet');
    t.includes(h, '✓', 'it is a visible confirmation');
    t.includes(h, '#TGD62508', 'names the machine');
    t.includes(h, 'Head Trip', 'names the destination — the thing the tech backed out to verify');
    t.ok(h.indexOf('500 kW') !== -1 && h.indexOf('500 kW') < h.indexOf('#TGD62508'),
      'size leads the identity (size-locked doctrine; big iron speaks kW)');
    t.includes(h, '1 received this session', 'session counter — the number a tech wants on a 30-unit truck');
    t.includes(h, 'pinned', 'pin state shown (harness GPS succeeds)');
    t.includes(h, "openUnit('u-rc1')", 'tapping the banner opens that unit');
    const mv = app.S.movements.filter((m) => m.unitId === 'u-rc1');
    t.eq(mv.length, 1, 'the move itself recorded exactly as before');
  }

  t.group('receipt: counter increments across the loop; banner shows the latest unit');
  {
    const u2 = mkUnit({ id: 'u-rc2', serial: 'A25019', kw: 25 });
    app.S.units.push(u2);
    app.fn.doMoveScan('u-rc2', 'show', 'show-A'); app.flushTimers();
    const h = sheetHTML();
    t.includes(h, '2 received this session', 'second move counts');
    t.includes(h, '#A25019', 'banner is the LATEST receipt');
    t.excludes(h, '#TGD62508', 'one banner, not a feed');
  }

  t.group('receipt: no-pin variant when GPS yields nothing');
  {
    app.fn.setReceipt(app.S.units[0], 'show', 'show-A', null);
    app.fn.openScan('job');
    t.includes(sheetHTML(), 'no pin', 'a null GPS reads "no pin" — the first-permission timeout race is visible');
  }

  t.group('receipt: honesty — banner reads no sync state, renders identically when the flush fails');
  {
    const before = app.fn.receiptBanner();
    app.live.SYNC_READY = true;
    app.opts.writeError = () => ({ message: 'TypeError: Failed to fetch' });
    await app.fn.flush();
    app.opts.writeError = null;
    t.eq(app.fn.receiptBanner(), before, 'a failed flush changes NOTHING on the banner (chip owns server truth)');
    const src = String(app.fn.receiptBanner);
    ['DEAD', 'SYNC_LOST', 'SYNC_FAILS', 'SYNC_SHORT', 'NET_DOWN'].forEach((k) =>
      t.excludes(src, k, 'receiptBanner never reads ' + k));
    t.excludes(String(app.fn.setReceipt), 'DEAD', 'setReceipt never reads sync state either');
  }

  t.group('receipt: new asset from the add sheet loops back with a banner — and the write never depends on it');
  {
    app.setState({ units: [], shows: [{ id: 'show-A', name: 'Head Trip' }] });
    app.S.currentShowId = 'show-A'; app.S.settings.techName = 'Mike R.';
    app.live.lastReceipt = null; app.live.receiptCount = 0; app.live.TAB = 'jobs';
    app.fn.openScan('job');
    app.document.querySelector('#assetSearch').value = 'NEWSER99';
    app.fn.addNewFromSearch();
    t.eq(!!app.live.addViaSearch, true, 'origin flag set by the add-sheet path');
    app.document.querySelector('#f_serial').value = 'NEWSER99';
    app.fn.saveUnit(''); app.flushTimers();
    const created = app.S.units.find((x) => x.serial === 'NEWSER99');
    t.ok(created, 'unit created');
    const birth = app.S.movements.find((m) => m.unitId === (created && created.id) && m.fromType === null);
    t.ok(birth, 'birth movement recorded (receipt never gates the write)');
    const h = sheetHTML();
    t.includes(h, 'assetSearch', 'landed BACK on the add sheet — batch rhythm holds for mixed trucks');
    t.includes(h, 'receiptBanner', 'with the receipt banner');
    t.includes(h, '#NEWSER99', 'naming the new asset');
    t.eq(!!app.live.addViaSearch, false, 'origin flag consumed');
    /* direct editUnit(null) (no add-sheet origin) keeps the old landing */
    app.fn.editUnit(null, 'DIRECT77');
    app.document.querySelector('#f_serial').value = 'DIRECT77';
    app.fn.saveUnit(''); app.flushTimers();
    t.includes(sheetHTML(), 'DIRECT77', 'direct add still lands on the unit detail sheet');
    t.excludes(sheetHTML(), 'assetSearch', 'and not on the add sheet');
  }

  t.group('receipt: hostile strings escape; typed-serial vocabulary on loop surfaces');
  {
    const u = mkUnit({ id: 'u-rc9', serial: 'EVIL"><img src=x onerror=alert(1)>', kw: null });
    app.setState({ units: [u], shows: [{ id: 'show-A', name: '<b>Job & "Co"</b>' }] });
    app.S.currentShowId = 'show-A'; app.S.settings.techName = 'Mike R.';
    app.fn.setReceipt(u, 'show', 'show-A', { lat: 1, lng: 2 });
    const b = app.fn.receiptBanner();
    t.excludes(b, '<img', 'hostile serial cannot inject markup');
    t.includes(b, '&lt;img', 'it renders as inert escaped text');
    t.excludes(b, '<b>Job', 'destination escaped');
    app.live.scanAskHours = true;
    app.fn.scanHoursSheet('u-rc9', 'show', 'show-A');
    const hs = sheetHTML();
    t.includes(hs, 'next serial', 'hours sheet speaks typed serials');
    t.excludes(hs, 'next scan', 'no scanner vocabulary — there is no scanner, everything is typed');
    app.live.scanAskHours = false;
    app.fn.moveMenu('u-rc9');
    t.excludes(sheetHTML(), 'scan into', 'move menu title dropped the scan wording');
    app.live.lastReceipt = null; app.live.receiptCount = 0;   /* leave no state behind */
  }
};
