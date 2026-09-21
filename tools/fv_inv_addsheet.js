/**
 * fv_inv_addsheet.js — add-sheet field feedback (2026-09-21, `add-sheet-steps`).
 *
 * Contracts: the intro is THREE numbered steps a tech absorbs in seconds,
 * sun-readable (full-size ink, never muted). "+ Add new asset" is hidden until
 * a search exists and goes loud (primary) only on a miss — exactly when the
 * locked searchFleet copy points at it; while there are matches it's a ghost
 * escape hatch, because a loud add button before searching is how duplicates
 * happen. The hours toggle reads as an optional QUESTION with the receipt-first
 * rule stated in-UI, and the choice sticks PER JOB (fleetview_scanhours_v1,
 * self-pruning: only ON stored, so unset jobs default OFF by construction).
 * Receiving never depends on hours: move records first, Skip always works.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'small',
    make: 'MQ', model: 'DCA25', kw: 25, opStatus: 'staged',
    locationType: 'fleet', locationId: null, photos: [], jobMeta: {}, updatedAt: 1 }, o);
  const SK = 'fleetview_scanhours_v1';
  const sheetHtml = () => app.document.querySelector('#sheet').innerHTML;
  const smap = () => JSON.parse(app.localStorage.getItem(SK) || '{}');
  const btn = () => app.document.querySelector('#addNewBtn');

  app.localStorage.removeItem(SK);
  app.setState({ units: [mkUnit({ id: 'u-as-1', serial: 'UVC700618' }), mkUnit({ id: 'u-as-2', serial: 'D1410657' })],
    shows: [{ id: 'show-AS-A', name: 'Alpha Fest' }, { id: 'show-AS-B', name: 'Bravo Fair' }], movements: [], reports: [] });
  app.S.settings.techName = 'Mike R.';
  app.live.TAB = 'jobs'; app.S.currentShowId = 'show-AS-A';

  t.group('add sheet: three-step intro, sun-readable');
  {
    app.fn.openScan();
    const h = sheetHtml();
    t.includes(h, '1 · Type the serial', 'step 1 leads');
    t.includes(h, '2 · Already in the fleet? Tap it', 'step 2 explains the tap');
    t.includes(h, 'Alpha Fest', 'job variant names the show in step 2');
    t.includes(h, 'No duplicates', 'the dedup promise stays');
    t.includes(h, '3 · Not found? Add it as a new asset.', 'step 3 names the fallback');
    t.ok(h.indexOf('1 · Type the serial') < h.indexOf('2 · Already') && h.indexOf('2 · Already') < h.indexOf('3 · Not found'), 'steps render in order');
    t.includes(h, 'id="scanSteps" style="font-size:16px', 'steps are full body size — readable in direct sun');
    const at = h.indexOf('id="scanSteps"');
    t.excludes(h.slice(Math.max(0, at - 60), at + 20), 'muted', 'steps are normal ink, never muted');
    app.live.TAB = 'fleet';
    app.fn.openScan('fleet');
    t.includes(sheetHtml(), 'just opens', 'fleet variant: step 2 says it just opens');
    app.live.TAB = 'jobs';
  }

  t.group('add sheet: + Add new asset earns its loudness');
  {
    app.fn.openScan();
    t.includes(sheetHtml(), 'id="addNewBtn"', 'button exists in the sheet');
    t.includes(sheetHtml(), 'id="addNewBtn" class="btn primary block" style="margin-top:6px;display:none"', 'and starts hidden — nothing invites a duplicate before a search');
    app.fn.searchFleet('UVC700618');
    t.eq(btn().style.display, '', 'a search reveals it');
    t.includes(btn().className, 'ghost', 'with matches on screen it is a ghost — the cards are the suggestion');
    app.fn.searchFleet('UCV700618');
    t.includes(btn().className, 'primary', 'near-miss ("Did you mean") promotes it — the copy points at it');
    app.fn.searchFleet('ZZZZZZ');
    t.eq(btn().style.display, '', 'no match: visible');
    t.includes(btn().className, 'primary', 'no match: primary — now it IS the next action');
    app.fn.searchFleet('');
    t.eq(btn().style.display, 'none', 'cleared field hides it again');
  }

  t.group('add sheet: hours toggle is an optional question');
  {
    app.fn.openScan();
    const h = sheetHtml();
    t.includes(h, '⏱ Log hours too?', 'OFF label asks, never instructs');
    t.includes(h, 'Optional — the unit is received either way. Skip anytime.', 'the receipt-first rule is stated in the UI');
    t.includes(h, 'scanHrsTgl', 'contract id intact');
    app.fn.scanAskHoursT();
    t.eq(!!app.live.scanAskHours, true, 'toggle flips on');
    t.includes(app.document.querySelector('#scanHrsTgl').textContent, 'Logging hours after each unit · ON', 'ON label patched in place');
    t.includes(sheetHtml(), '⏱ Log hours too?', 'sheet was NOT rebuilt (markup string untouched — typed state would survive)');
    app.fn.scanAskHoursT();
  }

  t.group('add sheet: hours choice sticks per job, defaults OFF on unset jobs');
  {
    app.localStorage.removeItem(SK);
    app.S.currentShowId = 'show-AS-A';
    app.fn.openScan();
    t.eq(!!app.live.scanAskHours, false, 'Alpha, never set: OFF');
    app.fn.scanAskHoursT();
    t.eq(smap()['show-AS-A'], 1, 'toggling ON on Alpha persists under Alpha\'s id');
    app.fn.openScan();
    t.eq(!!app.live.scanAskHours, true, 'reopening the sheet on Alpha remembers ON');
    t.includes(sheetHtml(), 'Logging hours after each unit · ON', 'and renders ON');
    app.S.currentShowId = 'show-AS-B';
    app.fn.openScan();
    t.eq(!!app.live.scanAskHours, false, 'Bravo, never set: OFF — the choice never leaks across jobs');
    app.S.currentShowId = 'show-AS-A';
    app.fn.openScan();
    t.eq(!!app.live.scanAskHours, true, 'back on Alpha: still ON');
    app.fn.scanAskHoursT();
    t.ok(!('show-AS-A' in smap()), 'toggling OFF deletes the key — the map self-prunes, OFF is never stored');
    const before = JSON.stringify(smap());
    app.live.TAB = 'fleet';
    app.fn.openScan('fleet');
    app.fn.scanAskHoursT();
    t.eq(JSON.stringify(smap()), before, 'fleet-mode toggling never touches the per-job map');
    app.fn.scanAskHoursT();
    app.live.TAB = 'jobs';
  }

  t.group('add sheet: receiving never depends on hours, even with the job remembered ON');
  {
    app.localStorage.removeItem(SK);
    app.S.currentShowId = 'show-AS-A';
    app.fn.openScan();
    app.fn.scanAskHoursT();                       // persist ON for Alpha
    const mvBefore = app.S.movements.length, rpBefore = app.S.reports.length;
    app.fn.doMoveScan('u-as-2', 'show', 'show-AS-A');
    if (app.flushTimers) app.flushTimers();
    t.eq(app.S.movements.length, mvBefore + 1, 'move recorded BEFORE the hours ask — receipt never gated');
    t.includes(sheetHtml(), 'sh_hrs', 'then the hours sheet appears (mode remembered ON)');
    app.fn.skipScanHours();
    t.eq(app.S.reports.length, rpBefore, 'Skip writes nothing');
    t.includes(sheetHtml(), 'assetSearch', 'and the loop re-arms on the scan sheet');
    t.eq(!!app.live.scanAskHours, true, 'mode still ON for the next unit — but each unit can Skip');
  }

  /* cleanup: never let this suite's state poison addflow's boot-default pin */
  while (app.live.scanAskHours) app.fn.scanAskHoursT();
  app.localStorage.removeItem(SK);
};
