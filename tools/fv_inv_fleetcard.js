/**
 * fv_inv_fleetcard.js — standing invariants for the Fleet-list card.
 *
 * The Fleet list is the 153-unit scanning surface. Contract: the headline is
 * make + model (make always, model appended when known) so identical
 * manufacturers read identically regardless of which fields are filled; the
 * kVA rating renders on its own right-aligned line (a unit with no job still
 * shows its size); empty-string and null are the same absence (the TGD
 * hand-entry lesson — coalesce, don't null-check).
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    make: 'CAT', model: 'XQ-500', kw: 625, opStatus: 'running',
    locationType: 'fleet', locationId: null, photos: [], jobMeta: {}, updatedAt: 1 }, o);
  const fleetHtml = () => { app.live.TAB = 'fleet'; return app.fn.renderFleet(); };

  t.group('fleet card: headline is make + model, consistently');
  app.setState({ units: [
    mkUnit({ id: 'u-both', serial: 'S-BOTH', make: 'CAT', model: 'XQ-500' }),
    mkUnit({ id: 'u-makeonly', serial: 'S-MAKE', make: 'CAT', model: null }),
    mkUnit({ id: 'u-emptymodel', serial: 'S-EMPTY', make: 'Technogen', model: '' }),
    mkUnit({ id: 'u-neither', serial: 'S-NONE', make: '', model: null }),
  ] });
  const h = fleetHtml();
  t.includes(h, 'CAT XQ-500 · #S-BOTH', 'both set -> make model');
  t.includes(h, 'CAT · #S-MAKE', 'model missing -> make alone, same shape');
  t.includes(h, 'Technogen · #S-EMPTY', "empty-string model treated as absent — no trailing space, no ''-vs-null split");
  t.includes(h, 'GEN · #S-NONE', 'neither -> GEN fallback');
  t.excludes(h, 'CAT  ·', 'no double-space artifacts');

  t.group('fleet card: kVA renders on its own — no job placement required');
  app.setState({ units: [
    mkUnit({ id: 'u-rated', serial: 'S-R', kw: 625, locationType: 'fleet', locationId: null }),
    mkUnit({ id: 'u-norating', serial: 'S-N', kw: null }),
  ] });
  const h2 = fleetHtml();
  t.includes(h2, '625 kVA', 'unassigned unit still shows its size');
  t.excludes(h2, 'null kVA', 'no rating -> no artifact');
  t.excludes(h2, '>0 kVA', 'zero/blank never renders a fake rating');

  t.group('fleet card: TwinPak chip on the scanning surface');
  app.setState({ units: [
    mkUnit({ id: 'u-twin', serial: 'S-TW', engines: { style: '12', A: { kvaEach: 438 }, B: { kvaEach: 438 } } }),
    mkUnit({ id: 'u-single', serial: 'S-SG' }),   // X5M case: single 500, correctly no chip
  ] });
  const h3 = fleetHtml();
  t.includes(h3, 'TWINPAK · 1/2', 'twin shows the chip with its housing label style');
  t.includes(h3, 'needs a meter reading', 'binding-pass gap visible from the Fleet list (per HANDOFF §10 1b)');
  const singleCard = h3.split('S-SG')[1] || '';
  t.excludes(singleCard.slice(0, 400), 'TWINPAK', 'single-engine unit shows no chip');

  t.group('fleet card: make filter chips, one tap narrows the list');
  app.setState({ units: [
    mkUnit({ id: 'u-c1', serial: 'S-C1', make: 'CAT' }), mkUnit({ id: 'u-c2', serial: 'S-C2', make: 'CAT' }),
    mkUnit({ id: 'u-h1', serial: 'S-H1', make: 'HiPower' }),
    mkUnit({ id: 'u-b1', serial: 'S-B1', make: '' }),      // empty string
    mkUnit({ id: 'u-b2', serial: 'S-B2', make: null }),    // and null — same absence
  ] });
  app.live.fleetMake = 'all';
  const bar = app.fn.fleetMakeBar();
  t.includes(bar, 'CAT · 2', 'make chip carries its count');
  t.includes(bar, 'HiPower · 1', 'every make present gets a chip');
  t.includes(bar, 'No make · 2', "blank chip counts '' AND null together (coalesce, not null-check)");
  app.fn.setFleetMake('CAT');
  const hc = app.fn.renderFleet();
  t.includes(hc, 'S-C1', 'CAT filter keeps CAT');
  t.excludes(hc, 'S-H1', 'CAT filter drops HiPower');
  app.fn.setFleetMake('(none)');
  const hn = app.fn.renderFleet();
  t.includes(hn, 'S-B1', 'no-make filter catches empty string');
  t.includes(hn, 'S-B2', 'no-make filter catches null');
  t.excludes(hn, 'S-C1', 'and drops everything with a make');
  app.fn.setFleetMake('all');
};
