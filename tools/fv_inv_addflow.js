/**
 * fv_inv_addflow.js — standing invariants for near-match candidates in the add flow.
 *
 * HANDOFF §10 1c: 59% of the fleet's serials are within one Damerau edit of another
 * serial. When there is no exact match, close serials are OFFERED before "+ Add new
 * asset" — which is never blocked. Nothing is validated, rejected, corrected or
 * format-checked (§8 rule 4). Damerau, not Levenshtein: the real UCV/UVC duplicate
 * is a transposition — distance 2 plain, distance 1 with adjacent-swap counted once.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    opStatus: 'running', locationType: 'show', locationId: 'show-A', photos: [], jobMeta: {}, updatedAt: 1 }, o);

  t.group('near-match: Damerau distance, alphanumerics only');
  t.eq(app.fn.dlDist('UCV700618', 'UVC700618', 1), 1, 'transposition scores 1 (Levenshtein would say 2)');
  t.eq(app.fn.dlDist('X5M0038', 'X5M00382', 1), 1, 'one missing character scores 1');
  t.eq(app.fn.nrmCode('d19701.'), 'D19701', 'normalization strips separators and uppercases');
  t.eq(app.fn.dlDist(app.fn.nrmCode('D19701.'), app.fn.nrmCode('D19701'), 1), 0, 'trailing-period duplicate is distance 0 after normalization');

  t.group('near-match: candidates offered, capped, add never blocked');
  app.setState({
    units: [
      mkUnit({ id: 'u-382', serial: 'X5M00382' }), mkUnit({ id: 'u-384', serial: 'X5M00384' }),
      mkUnit({ id: 'u-387', serial: 'X5M00387' }), mkUnit({ id: 'u-388', serial: 'X5M00388' }),
      mkUnit({ id: 'u-389', serial: 'X5M00389' }),
      mkUnit({ id: 'u-uvc', serial: 'UVC700618' }),
      mkUnit({ id: 'u-d', serial: 'D19701' }),
    ],
    shows: [{ id: 'show-A', name: 'A' }],
  });
  const near = app.fn.nearMatches('X5M0038', 4);
  t.eq(near.length, 4, 'capped at 4 even with 5 in range');
  t.ok(near.every((u) => u.serial.indexOf('X5M0038') === 0), 'all candidates from the dense family');
  t.eq(app.fn.nearMatches('UCV700618', 4)[0] && app.fn.nearMatches('UCV700618', 4)[0].serial, 'UVC700618',
    'the real transposed duplicate is found');
  t.eq(app.fn.nearMatches('D19701.', 4)[0] && app.fn.nearMatches('D19701.', 4)[0].serial, 'D19701',
    'the real trailing-period duplicate is found');
  t.eq(app.fn.nearMatches('ZZZZZZ', 4).length, 0, 'nothing close -> no candidates, no guess');

  t.group('near-match: typed path renders candidates in searchResults');
  app.fn.searchFleet('UCV700618');
  const box = app.document.querySelector('#searchResults').innerHTML;
  t.includes(box, 'Did you mean', 'candidate framing shown when substring search misses');
  t.includes(box, 'UVC700618', 'transposed serial offered');
  t.includes(box, 'adds it exactly as typed', 'add-as-typed stays available, never blocked');
  app.fn.searchFleet('ZZZZZZ');
  t.includes(app.document.querySelector('#searchResults').innerHTML, 'No match in the fleet',
    'no candidates -> unchanged empty-state copy');

  t.group('near-match: scan path gets the same protection');
  app.fn.handleCode('UCV700618');
  const sh = app.document.querySelector('#sheet').innerHTML;
  t.includes(sh, 'Did you mean', 'misread barcode shows candidates');
  t.includes(sh, 'UVC700618', 'candidate listed');
  t.includes(sh, 'anyway', 'add-anyway button present — offering, not rejecting');
  app.fn.handleCode('ZZZZZZ');
  t.includes(app.document.querySelector('#sheet').innerHTML, 'Add asset',
    'no candidates -> straight to the add form as before');
};
