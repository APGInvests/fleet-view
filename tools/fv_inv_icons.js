/**
 * fv_inv_icons.js — no unsized icon markup may render, anywhere
 * (2026-10-09, `card-icon-size`).
 *
 * Field incident: the stale ⚠ (IC.warn) inside .fresh had no CSS svg rule and
 * no intrinsic size, so it rendered at the 300x150 replaced-element default and
 * wrapped the card's timestamp/tech line (X5M00213, X5M00375). Same class as
 * the unsized empty-state glyph killed in add-flow-clarity. Contracts:
 *
 *  1. SOURCE-LEVEL (kills the class): every IC.* svg string carries explicit
 *     width= and height= attributes. CSS still overrides where a context wants
 *     a different size; the attribute is the floor that makes "unstyled
 *     context" mean 16px, never 300x150.
 *  2. RENDER-LEVEL: a stale unit's card contains no <svg without width=.
 *  3. The .fresh context has its own CSS svg sizing rule (the icon rides an
 *     11px mono line; even the 16px intrinsic floor is too big there).
 */
'use strict';
const fs = require('fs');
const path = require('path');
module.exports = (app, t) => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  t.group('icons: every IC glyph carries an intrinsic size');
  {
    // The IC literal + the IC.plus append both live before the BACKEND banner.
    const lo = src.indexOf('const IC={');
    const hi = src.indexOf('/* ===== BACKEND');
    t.ok(lo > 0 && hi > lo, 'found the IC icon zone');
    const zone = src.slice(lo, hi);
    const svgs = zone.match(/<svg[^>]*>/g) || [];
    t.ok(svgs.length >= 15, 'found the IC glyph set (' + svgs.length + ')');
    svgs.forEach((s) => {
      t.ok(/\bwidth="\d+"/.test(s) && /\bheight="\d+"/.test(s),
        'IC glyph has explicit width+height: ' + s.slice(0, 60));
    });
  }

  t.group('icons: stale card renders no unsized svg; .fresh is CSS-sized');
  {
    app.setState({
      shows: [{ id: 's1', name: 'Show' }],
      units: [{ id: 'u1', serial: 'X5M00213', klass: 'big', kw: 625,
        opStatus: 'running', locationType: 'show', locationId: 's1',
        currentHours: 3200, serviceDueHours: 3022, jobMeta: {}, photos: [] }],
      reports: [{ id: 'r1', unitId: 'u1', engine: null, engineHours: 3200,
        techName: 'Edwin M.', timestamp: Date.now() - 48 * 3600e3 }],
      issues: [], movements: [], status_events: [] });
    const u = app.S.units[0];
    t.eq(app.fn.isStale(u), true, 'fixture is stale (control — the warn icon renders)');
    const card = app.fn.unitCard(u, 's1');
    t.includes(card, 'fresh stale', 'control: the stale fresh-chip is on the card');
    const tags = card.match(/<svg[^>]*>/g) || [];
    t.ok(tags.length >= 1, 'card renders at least one svg (the warn icon)');
    tags.forEach((s) =>
      t.ok(/\bwidth="\d+"/.test(s), 'card svg is sized: ' + s.slice(0, 60)));
    t.ok(/\.fresh svg\{[^}]*width/.test(src), '.fresh has its own svg sizing rule');
  }
};
