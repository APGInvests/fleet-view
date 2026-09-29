/**
 * fv_inv_mappopup.js — map pin popup speaks size, like every other surface
 * (2026-09-28, `pin-popup-size`).
 *
 * The popup's second line was raw make/model — free text, blank on 49 of 205
 * pinned units, size-junk on 9 more ("150kva" typed into model). Contracts:
 *
 *  1. pinPopupHtml(u, sid) is a named, testable builder; drawMap calls it.
 *  2. Line 2 = sizeLabel-style: sizeText first ("25 kVA", "500 kW",
 *     "Twin 400 kW"), make/model fallback only when no rating, then #serial.
 *     Nothing a tech typed into model can replace or duplicate the size.
 *  3. Line 3 = make/model as a muted FIELD CUE, only when a rating exists
 *     (no duplication of line 2) and only the non-junk fields: each of
 *     make/model is dropped independently if it reads like a size
 *     ("150kva", "25kw"). Blank -> no line, no placeholder.
 *  4. Title (jobLabel / "Unplaced"), status line, and the Open/Move/Set
 *     buttons are unchanged.
 *  5. User text is escaped.
 */
'use strict';
const fs = require('fs');
const path = require('path');
module.exports = (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({
    id: id('u'), serial: 'SER' + (++seq), tagId: '', klass: 'small', make: '',
    model: '', kw: null, opStatus: 'running', locationType: 'show',
    locationId: 'sh-1', photos: [], jobMeta: {}, updatedAt: 1 }, o);
  const setup = (u) => { app.setState({ shows: [{ id: 'sh-1', name: 'Show' }], units: [u], reports: [], issues: [], movements: [] }); return u; };

  t.group('pin popup: line 2 is size-first, same string as the cards');
  {
    const u = setup(mkUnit({ serial: 'A25019', make: 'Technogen', model: '', kw: 25 }));
    const h = app.fn.pinPopupHtml(u, 'sh-1');
    t.includes(h, '25 kVA · #A25019', 'small iron: rating + serial, card vocabulary');
    const big = setup(mkUnit({ serial: 'U041866X', klass: 'big', make: 'CAT', model: 'XQ-500', kw: 625 }));
    t.includes(app.fn.pinPopupHtml(big, 'sh-1'), '500 kW · #U041866X', 'big single speaks kW');
    const twin = setup(mkUnit({ serial: 'TGD62501', klass: 'big', make: 'Technogen', kw: 1000,
      engines: { style: 'AB', A: { kvaEach: 500 }, B: { kvaEach: 500 } } }));
    t.includes(app.fn.pinPopupHtml(twin, 'sh-1'), 'Twin 400 kW · #TGD62501', 'twin speaks per-engine kW');
  }

  t.group('pin popup: size-in-model junk can neither replace nor duplicate the rating');
  {
    const u = setup(mkUnit({ serial: '28B10705', make: '', model: '150kva', kw: 150 }));
    const h = app.fn.pinPopupHtml(u, 'sh-1');
    t.includes(h, '150 kVA · #28B10705', 'size comes from the rating, not the model field');
    t.eq((h.match(/150\s*kva/gi) || []).length, 1, 'the size appears exactly once — junk model text dropped');
    const mixed = setup(mkUnit({ serial: '28B10830', make: 'MMD', model: '150kva', kw: 150 }));
    const h2 = app.fn.pinPopupHtml(mixed, 'sh-1');
    t.includes(h2, '150 kVA · #28B10830', 'rating line intact');
    t.includes(h2, 'MMD', 'per-field filter: the real make survives as the field cue');
    t.eq((h2.match(/150\s*kva/gi) || []).length, 1, 'junk model dropped, size still exactly once');
  }

  t.group('pin popup: make/model is a muted third line only when it adds information');
  {
    const u = setup(mkUnit({ serial: 'X1', klass: 'big', make: 'CAT', model: 'XQ-500', kw: 625 }));
    const h = app.fn.pinPopupHtml(u, 'sh-1');
    t.includes(h, 'CAT XQ-500', 'real make/model renders as the field cue');
    t.ok(h.indexOf('500 kW · #X1') < h.indexOf('CAT XQ-500'), 'field cue sits BELOW the size line');
    const noRating = setup(mkUnit({ serial: '1728B10076', make: 'Airman', model: 'SdG1508', kw: null }));
    const h2 = app.fn.pinPopupHtml(noRating, 'sh-1');
    t.includes(h2, 'Airman SdG1508 · #1728B10076', 'no rating: make/model IS line 2, as today');
    t.eq((h2.match(/Airman SdG1508/g) || []).length, 1, 'no rating: no duplicated third line');
    t.excludes(h2, 'Asset', 'no "Asset" placeholder ever leaks into the popup');
    const bare = setup(mkUnit({ serial: 'B1', kw: null }));
    t.includes(app.fn.pinPopupHtml(bare, 'sh-1'), '#B1', 'nothing known: serial alone, no placeholders');
  }

  t.group('pin popup: title, status and actions unchanged');
  {
    const u = setup(mkUnit({ serial: 'P1', kw: 25, jobMeta: { 'sh-1': { area: 'Main Medical 480v', note: '' } } }));
    const h = app.fn.pinPopupHtml(u, 'sh-1');
    t.includes(h, 'Main Medical 480v', 'title stays jobLabel');
    t.includes(h, 'RUNNING', 'status line stays');
    t.includes(h, 'openUnit', 'Open action stays');
    t.includes(h, 'openPinEditor', 'Move action stays');
    t.includes(h, 'mapSetLoc', 'Set-to-my-location stays');
    const unplaced = setup(mkUnit({ serial: 'P2', kw: 25 }));
    t.includes(app.fn.pinPopupHtml(unplaced, 'sh-1'), 'Unplaced', 'no label reads Unplaced, as before');
  }

  t.group('pin popup: user text is escaped');
  {
    const u = setup(mkUnit({ serial: 'E1', make: '<img src=x>', model: 'M<script>', kw: 25,
      jobMeta: { 'sh-1': { area: '<b>xss</b>', note: '' } } }));
    const h = app.fn.pinPopupHtml(u, 'sh-1');
    t.excludes(h, '<img src=x>', 'make escaped');
    t.excludes(h, '<script>', 'model escaped');
    t.excludes(h, '<b>xss</b>', 'label escaped');
  }

  t.group('pin popup: drawMap routes through the named builder');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    t.ok(/bindPopup\(pinPopupHtml\(/.test(src), 'drawMap binds popups via pinPopupHtml — no inline duplicate');
  }
};
