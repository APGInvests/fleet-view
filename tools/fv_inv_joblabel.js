/**
 * fv_inv_joblabel.js — one-field per-job labeling (2026-09-21, `job-label-one-field`).
 *
 * The data called it: across 189 job-meta entries, Name was NEVER used alone
 * (0), Placement alone 167, both 4 (2.3%). One field. Contracts: the card
 * title ALWAYS leads with size — `150 kVA · Main Stage` — and nothing a tech
 * types can replace the size; the label appears exactly once per card (no
 * title+pin duplication); legacy `name` keys display forever via the merge
 * rule (containing string wins, else `name — area`) and die naturally on the
 * next edit; the sacred assetLabel/placeOf helpers are UNTOUCHED (fv_smoke
 * pins them — this suite proves the new layer, fv_smoke proves the old one
 * still stands). Job-only labeling: nothing about the unit itself changes.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'small',
    make: 'MQ', model: 'DCA150', kw: 150, opStatus: 'running',
    locationType: 'show', locationId: 'show-JL', photos: [], jobMeta: {}, updatedAt: 1 }, o);
  const SID = 'show-JL';
  const meta = (m) => ({ [SID]: m });

  t.group('job label: merge rule — every label ever entered still shows');
  {
    const jl = (m, extra) => app.fn.jobLabel(mkUnit(Object.assign({ jobMeta: meta(m) }, extra || {})), SID);
    t.eq(jl({ name: 'Coca-Cola' }), 'Coca-Cola', 'legacy name-only shows as-is');
    t.eq(jl({ area: 'Main Stage' }), 'Main Stage', 'placement-only shows as-is (167 of 171 real labels)');
    t.eq(jl({ name: 'Main Medical 480v', area: 'Grove' }), 'Main Medical 480v — Grove',
      'both distinct -> joined (the real C12516 Lolla entry)');
    t.eq(jl({ name: 'Twin 400kVA Despacio Tent', area: 'Despacio Tent' }), 'Twin 400kVA Despacio Tent',
      'containing string wins (the real Portola entry — case-insensitive)');
    t.eq(jl({ name: 'Twin 300kVA Pier Stage Guest LX services', area: 'Pier Stage guest LX services' }),
      'Twin 300kVA Pier Stage Guest LX services', 'containment is case-insensitive (second Portola entry)');
    t.eq(jl({ name: 'Grove', area: 'Grove East' }), 'Grove East', 'reverse containment: the longer string wins');
    t.eq(jl({}), '', 'no label -> empty');
    t.eq(jl({ note: 'just a note' }), '', 'note alone is not a label');
    t.eq(jl({}, { area: 'Yard row 3' }), 'Yard row 3', 'asset-level area fallback preserved (placeOf parity)');
  }

  t.group('job label: size is locked as the first part of every title');
  {
    t.eq(app.fn.sizeLabel(mkUnit()), '150 kVA', 'size label from kVA');
    t.eq(app.fn.sizeLabel(mkUnit({ kw: null })), 'MQ DCA150', 'kw-less falls back to make/model');
    t.eq(app.fn.sizeLabel(mkUnit({ kw: null, make: '', model: '' })), 'Asset', 'last-resort literal');
    app.setState({ units: [], shows: [{ id: SID, name: 'Desert Sound' }], issues: [], reports: [], movements: [] });
    const labeled = mkUnit({ jobMeta: meta({ area: 'Main Stage' }) });
    const named = mkUnit({ jobMeta: meta({ name: 'Coca-Cola' }) });
    const bare = mkUnit();
    app.S.units = [labeled, named, bare];
    t.includes(app.fn.unitCard(labeled, SID), '<span class="tag">150 kVA · Main Stage</span>', 'labeled title: size leads, label follows');
    t.includes(app.fn.unitCard(named, SID), '<span class="tag">150 kVA · Coca-Cola</span>', 'a typed name can no longer replace the size');
    t.includes(app.fn.unitCard(bare, SID), '<span class="tag">150 kVA</span>', 'unlabeled title is the bare size');
  }

  t.group('job label: the label appears exactly once per card');
  {
    app.setState({ units: [], shows: [{ id: SID, name: 'Desert Sound' }], issues: [], reports: [], movements: [] });
    const labeled = mkUnit({ jobMeta: meta({ area: 'Main Stage' }) });
    const bare = mkUnit();
    app.S.units = [labeled, bare];
    const h = app.fn.unitCard(labeled, SID);
    t.eq(h.split('Main Stage').length - 1, 1, 'labeled card: label rendered exactly once (title only)');
    t.excludes(h, 'class="uloc"', 'labeled healthy card: no pin line — the title carries it');
    const hb = app.fn.unitCard(bare, SID);
    t.includes(hb, 'class="uloc"', 'unlabeled card keeps the location line');
    t.includes(hb, 'Desert Sound', 'and it shows the location as today');
  }

  t.group('job label: issue and transit variants keep the size-locked title');
  {
    app.setState({ units: [], shows: [{ id: SID, name: 'Desert Sound' }], reports: [], movements: [] });
    const down = mkUnit({ jobMeta: meta({ area: 'Main Stage' }), opStatus: 'down' });
    app.S.units = [down];
    app.S.issues = [{ id: id('i'), unitId: down.id, showId: SID, severity: 'down', title: 'Coolant leak',
      techName: 'Mike R.', timestamp: 1758400000000, resolved: false, photos: [] }];
    const h = app.fn.unitCard(down, SID);
    t.includes(h, '<span class="tag">150 kVA · Main Stage</span>', 'down unit: title still leads with size — issue never replaces it');
    t.includes(h, 'Coolant leak', 'the issue shows on its own line');
    t.includes(h, 'uloc bad', 'in the issue style');
    t.eq(h.split('Main Stage').length - 1, 1, 'and the label still appears exactly once');
    app.S.issues = [];
    const transit = mkUnit({ jobMeta: {}, locationType: 'transit', locationId: null, inTransitToShowId: SID, opStatus: 'staged' });
    app.S.units = [transit];
    const ht = app.fn.unitCard(transit, SID);
    t.includes(ht, 'In transit', 'transit line unchanged');
    t.includes(ht, '<span class="tag">150 kVA</span>', 'transit title is still the size');
  }

  t.group('job label: sort — size first always, label only breaks same-size ties');
  {
    app.setState({ units: [], shows: [{ id: SID, name: 'Desert Sound' }], issues: [], reports: [], movements: [] });
    const small = mkUnit({ id: 'jl-sm', kw: 25, jobMeta: meta({ area: 'Zulu tent' }) });
    const big = mkUnit({ id: 'jl-bg', kw: 500, jobMeta: meta({ area: 'Alpha stage' }) });
    app.S.units = [big, small];
    t.eq(app.fn.sortUnits([big, small]).map((x) => x.id).join(','), 'jl-sm,jl-bg',
      '25 kVA "Zulu" sorts before 500 kVA "Alpha" — size beats label, smallest first');
    const a = mkUnit({ id: 'jl-a', kw: 500, serial: 'ZZZ900', jobMeta: meta({ area: 'Alpha stage' }) });
    const m = mkUnit({ id: 'jl-m', kw: 500, serial: 'MMM001', jobMeta: {} });
    const z = mkUnit({ id: 'jl-z', kw: 500, serial: 'AAA001', jobMeta: meta({ area: 'Zulu tent' }) });
    app.S.units = [z, m, a];
    t.eq(app.fn.sortUnits([z, m, a]).map((x) => x.id).join(','), 'jl-a,jl-m,jl-z',
      'same-size tiebreak now works for placement-labeled units (98% of real labels)');
  }

  t.group('job label: one field on the Placement tab, legacy name dies on edit');
  {
    app.setState({ units: [], shows: [{ id: SID, name: 'Desert Sound' }], issues: [], reports: [], movements: [] });
    const u = mkUnit({ id: 'jl-form', jobMeta: meta({ name: 'Main Medical 480v', area: 'Grove', note: 'keep fueled' }) });
    app.S.units = [u];
    const form = app.fn.paneMoves(u, 'Desert Sound');
    t.includes(form, "What it's powering", 'the one field says what it is for');
    t.includes(form, 'e.g. Main Stage, Vendor Island, Coca-Cola', 'placeholder teaches by example');
    t.excludes(form, 'jm_name', 'the Name field is gone');
    t.excludes(form, '>Placement</span>', 'the old Placement label is gone');
    t.includes(form, 'value="Main Medical 480v — Grove"', 'a both-entry prefills its MERGED text — nothing typed is ever lost');
    t.includes(form, 'Stays on this job only', 'the per-job wording stays');
    t.includes(form, 'Save job label', 'button unchanged');

    app.document.querySelector('#jm_area').value = 'Vendor Island';
    app.document.querySelector('#jm_note').value = 'keep fueled';
    app.fn.saveJobMeta('jl-form', SID);
    t.eq(u.jobMeta[SID].area, 'Vendor Island', 'save writes the one field to area');
    t.eq(u.jobMeta[SID].note, 'keep fueled', 'note preserved');
    t.ok(!('name' in u.jobMeta[SID]), 'the legacy name key is dropped on save — merged prefill already showed it');
    t.eq(app.fn.jobLabel(u, SID), 'Vendor Island', 'and the label reads back clean');
  }

  t.group('job label: search finds by label, legacy name, and size');
  {
    app.setState({ units: [], shows: [{ id: SID, name: 'Desert Sound' }], issues: [], reports: [], movements: [] });
    const byArea = mkUnit({ serial: 'SRCH01', jobMeta: meta({ area: 'Vendor Island' }) });
    const byName = mkUnit({ serial: 'SRCH02', jobMeta: meta({ name: 'Coca-Cola' }) });
    app.S.units = [byArea, byName];
    app.live.jobFilter = 'all';
    const hits = (q) => { app.live.jobSearch = q; const h = app.fn.renderJobDetail(SID); app.live.jobSearch = ''; return h; };
    t.includes(hits('vendor isl'), 'SRCH01', 'search by current label');
    t.includes(hits('coca'), 'SRCH02', 'search by legacy name — the merge keeps it findable');
    t.includes(hits('150 kva'), 'SRCH01', 'search by size still works');
  }
};
