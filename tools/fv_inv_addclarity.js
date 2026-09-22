/**
 * fv_inv_addclarity.js — empty-state guidance + serial-first add sheet + Day N.
 *
 * Doctrine pinned here: an empty list must say WHY it's empty — zero-added,
 * search miss, and filter miss are three different situations with three
 * different next actions, and the zero state names its action with a real
 * button (the Jobs-list pattern). The add sheet is serial-first: typing is the
 * proven field path (Bourbon 25/11min, every dup incident a typo); the camera
 * entry point is OFF the sheet entirely since add-sheet-trim (zero production
 * scans ever), with the scanner code parked dormant for the QR-label plan.
 * Day N parses
 * start_date as a LOCAL calendar date — date-only strings parse as UTC
 * midnight, which is yesterday west of UTC, so a job starting today read
 * "Day 2" in Pacific. RUN THIS SUITE WITH TZ=America/Los_Angeles — the Day N
 * regression only reproduces west of UTC.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    make: 'CAT', model: 'XQ-500', kw: 625, opStatus: 'running',
    locationType: 'show', locationId: 'show-A', photos: [], jobMeta: {}, updatedAt: 1 }, o);
  const localISO = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  t.group('day N: start_date is a LOCAL calendar date (run under TZ=America/Los_Angeles)');
  {
    const today = localISO(new Date());
    const yesterday = localISO(new Date(Date.now() - 864e5));
    const tomorrow = localISO(new Date(Date.now() + 864e5));
    t.eq(app.fn.dayOfShow({ startDate: today }), 1, 'a job starting today is Day 1 — not Day 2 (the UTC-midnight bug)');
    t.eq(app.fn.dayOfShow({ startDate: yesterday }), 2, 'started yesterday -> Day 2');
    t.eq(app.fn.dayOfShow({ startDate: tomorrow }), null, 'starts tomorrow -> no day counter yet');
    t.eq(app.fn.dayOfShow({ startDate: null }), null, 'no start date -> null');
    t.eq(app.fn.dayOfShow(null), null, 'no show -> null');
  }

  t.group('empty job: zero-added state teaches, with a real button, above the chrome');
  {
    app.setState({ units: [], shows: [{ id: 'show-A', name: 'Desert Sound' }] });
    app.live.jobSearch = ''; app.live.jobFilter = 'all';
    const html = app.fn.renderJobDetail('show-A');
    t.includes(html, 'No generators on this job yet', 'zero state says what is missing, in the crew word');
    t.includes(html, 'Add the first generator', 'and names the next action on a real button');
    t.includes(html, 'openScan()', 'the button actually opens the add sheet — not an inert glyph');
    t.excludes(html, 'searchbar', 'no search bar on a job with nothing to search');
    t.excludes(html, 'filterbar', 'no filter chips on a job with nothing to filter');
    t.excludes(html, 'No units match', 'the filter-language copy is gone from the zero state');
    t.excludes(html, 'class="em"', 'no oversized empty-state glyph');
    t.excludes(html, app.live.IC.plus, 'the inert plus SVG is gone');

    app.live.TAB = 'jobs'; app.live.S.currentShowId = 'show-A';
    app.fn.openScan();
    t.includes(app.document.querySelector('#sheet').innerHTML, 'Add to Desert Sound', 'zero-state button path lands on the add-to-job sheet');
  }

  t.group('empty job: search miss and filter miss are distinct, escaped, and recoverable');
  {
    const u = mkUnit();
    app.setState({ units: [u], shows: [{ id: 'show-A', name: 'Desert Sound' }] });
    app.live.jobSearch = '<b>x'; app.live.jobFilter = 'all';
    let html = app.fn.renderJobDetail('show-A');
    t.includes(html, 'No units match', 'search miss keeps the match language');
    t.includes(html, '&lt;b&gt;x', 'the query is escaped like the Jobs list does');
    t.excludes(html, '<b>x', 'raw query markup never reaches the DOM');
    t.includes(html, 'searchbar', 'search bar stays — there IS something to search');

    app.live.jobSearch = ''; app.live.jobFilter = 'down';
    html = app.fn.renderJobDetail('show-A');
    t.includes(html, 'No units down on this job', 'filter miss names the filter, not a mystery');
    t.includes(html, 'Show all', 'and offers the way back');
    t.includes(html, "setJobFilter('all')", 'Show all resets the filter');

    app.live.jobFilter = 'all';
    html = app.fn.renderJobDetail('show-A');
    t.includes(html, 'searchbar', 'populated job: search present');
    t.includes(html, 'filterbar', 'populated job: filters present');
    t.includes(html, 'Swipe a unit left', 'populated job: swipe hint present');
    t.excludes(html, 'No generators', 'populated job: no zero-state copy');
  }

  t.group('fleet registry: same three-state doctrine');
  {
    app.setState({ units: [], shows: [] });
    app.live.fleetSearch = ''; app.live.fleetFilter = 'all'; app.live.fleetMake = 'all';
    let html = app.fn.renderFleet();
    t.includes(html, 'No assets yet', 'zero state');
    t.includes(html, 'Add the first asset', 'with its action on a button');
    t.excludes(html, 'class="em"', 'no oversized glyph here either');
    t.excludes(html, 'scan units in', 'the old scan-first instruction is gone');

    app.setState({ units: [mkUnit()], shows: [] });
    app.live.fleetSearch = 'zzz-none';
    html = app.fn.renderFleet();
    t.includes(html, 'No assets match', 'search miss distinct from zero');
    app.live.fleetSearch = ''; app.live.fleetFilter = 'down';
    html = app.fn.renderFleet();
    t.includes(html, 'Show all', 'filter miss offers the way back');
    t.includes(html, 'fleetShowAll()', 'and the reset clears filter AND make chip');
    app.live.fleetFilter = 'all';
  }

  t.group('add sheet: serial-only — camera OFF the sheet, scanner code parked dormant (2026-09-21, add-sheet-trim)');
  {
    /* Supersedes the collapsed-camera contract (add-flow-clarity): zero scans
       were ever recorded in production, so the entry point comes off the sheet
       entirely. The scanner CODE stays — the parked QR-label plan revives it —
       so these pins assert dormant-but-present, never deleted. */
    app.setState({ units: [], shows: [{ id: 'show-A', name: 'Desert Sound' }] });
    app.live.TAB = 'jobs'; app.live.S.currentShowId = 'show-A';
    const sheetHtml = () => app.document.querySelector('#sheet').innerHTML;

    app.fn.openScan();
    const h = sheetHtml();
    t.includes(h, 'Type the serial', 'intro leads with the real path');
    t.excludes(h, 'Scan the sticker', 'the sticker lead is gone — the stickers do not exist in the field');
    t.excludes(h, 'Scan a barcode instead', 'the barcode entry point is gone from the sheet');
    t.excludes(h, 'id="camWrap"', 'no camera container renders');
    t.excludes(h, 'id="reader"', 'no scanner viewport renders');
    t.excludes(h, 'scanCamBtn', 'no camera button renders');
    t.includes(h, 'scanHrsTgl', 'hours toggle still on the sheet (contract)');
    ['autocapitalize="characters"', 'autocorrect="off"', 'spellcheck="false"', 'autocomplete="off"'].forEach((a) =>
      t.includes(h, a, 'serial input keeps ' + a + ' — keyboards caused the dup typos'));

    t.eq(typeof app.fn.startScanner, 'function', 'scanner code kept dormant — the parked QR-label plan revives it');
    t.eq(typeof app.fn.scanCamT, 'function', 'camera-open path kept dormant too');
    const src = String(app.fn.startScanner);
    t.includes(src, 'Type the serial above', 'camera-failure copy still points at a control that exists');
    t.excludes(src, 'Add manually', 'the phantom "Add manually" button reference stays gone');
  }
};
