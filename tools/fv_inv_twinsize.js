/**
 * fv_inv_twinsize.js — twin-size-kw build (2026-09-22).
 *
 * Big iron speaks per-engine kW ("500 kW", "Twin 400 kW") matching the NES;
 * small iron stays kVA; storage stays kVA (units.kw + engines[e].kvaEach hold
 * kVA — kW exists ONLY at render, kW = kVA × 0.8); twin status comes from
 * isTwin() alone — the free-text config field is NEVER twin evidence.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    make: 'CAT', model: '', kw: 625, engines: null, opStatus: 'staged',
    locationType: 'fleet', locationId: null, jobMeta: {}, photos: [], updatedAt: 1 }, o);
  const twin = (per, o = {}) => mkUnit(Object.assign(
    { kw: per * 2, engines: { A: { kvaEach: per }, B: { kvaEach: per } } }, o));

  t.group('size labels: big iron speaks kW, per engine on twins');
  t.eq(app.fn.sizeText(mkUnit()), '500 kW', 'big single 625 kVA -> 500 kW');
  t.eq(app.fn.sizeText(twin(500)), 'Twin 400 kW', 'twin kvaEach 500 -> Twin 400 kW');
  t.eq(app.fn.sizeText(twin(375)), 'Twin 300 kW', 'twin kvaEach 375 -> Twin 300 kW');
  t.eq(app.fn.sizeText(mkUnit({ kw: 1000, engines: { A: {}, B: {} } })), 'Twin 400 kW',
    'kvaEach unset -> per-engine from kw/2 (binding-pass stragglers still read right)');
  t.eq(app.fn.sizeText(mkUnit({ klass: 'small', kw: 150 })), '150 kVA', 'small iron stays kVA');
  t.eq(app.fn.sizeText(mkUnit({ config: 'TwinPak', kw: 625 })), '500 kW',
    'config string is NEVER twin evidence (X5M stragglers read as singles)');
  t.eq(app.fn.sizeText(mkUnit({ kw: null })), null, 'no rating -> null, never "0 kW"/"NaN"');
  t.eq(app.fn.sizeText(mkUnit({ klass: 'small', kw: null })), null, 'small no rating -> null');
  t.eq(app.fn.sizeLabel(mkUnit({ kw: null, make: 'CAT', model: 'XQ-500' })), 'CAT XQ-500',
    'sizeLabel falls back to make/model when no rating');
  t.eq(app.fn.sizeText(mkUnit({ kw: 1257 })), '1006 kW',
    'odd stored value renders honestly (integer kW), never crashes');
  t.includes(app.fn.sizeText(twin(250)), 'Twin 200 kW', 'the two new 9NR 200 kW Twins');
  t.eq(app.fn.sizeText(mkUnit({ kw: '437.5' })), '350 kW',
    'string kw routes through parseFloat (PostgREST returns numerics as strings)');
  t.eq(app.fn.sizeText(mkUnit({ kw: '1000', engines: { A: { kvaEach: '500' }, B: { kvaEach: '500' } } })),
    'Twin 400 kW', 'string kvaEach + string kw still read as a matched twin');

  t.group('rendered cards: fleet list speaks the new labels');
  {
    app.setState({ units: [
      mkUnit({ id: 'ts-big', serial: 'S-TSB', kw: 625 }),
      twin(500, { id: 'ts-twin', serial: 'S-TST' }),
      mkUnit({ id: 'ts-small', serial: 'S-TSS', klass: 'small', make: 'MQ', model: 'DCA150', kw: 150 }),
      mkUnit({ id: 'ts-none', serial: 'S-TSN', kw: null }),
    ], shows: [], issues: [], reports: [], movements: [] });
    app.live.TAB = 'fleet'; app.live.fleetSearch = ''; app.live.fleetFilter = 'all'; app.live.fleetMake = 'all';
    const h = app.fn.renderFleet();
    t.includes(h, '500 kW', 'big single card shows 500 kW');
    t.includes(h, 'Twin 400 kW', 'twin card shows Twin 400 kW');
    t.includes(h, '150 kVA', 'small iron card stays kVA');
    t.excludes(h, '625 kVA', 'the combined kVA never renders on big iron');
    t.excludes(h, '1000 kVA', 'nor the twin combined kVA');
    const noneCard = (h.split('S-TSN')[1] || '').slice(0, 400);
    t.excludes(noneCard, ' kW', 'no-rating card carries no size text');
    t.excludes(h, 'null', 'no rating -> no null artifact');
    t.excludes(h, 'NaN', 'no rating -> no NaN artifact');
  }

  t.group('rendered cards: unit-card title is size-locked in kW');
  {
    const SID = 'show-TS';
    app.setState({ units: [], shows: [{ id: SID, name: 'Desert Sound' }], issues: [], reports: [], movements: [] });
    const labeled = twin(500, { locationType: 'show', locationId: SID, jobMeta: { [SID]: { area: 'Main Stage' } } });
    const bare = twin(500, { locationType: 'show', locationId: SID });
    app.S.units = [labeled, bare];
    t.includes(app.fn.unitCard(labeled, SID), '<span class="tag">Twin 400 kW · Main Stage</span>',
      'labeled twin title: per-engine kW leads, label follows');
    t.includes(app.fn.unitCard(bare, SID), '<span class="tag">Twin 400 kW</span>',
      'unlabeled twin title is the bare Twin size');
    const down = twin(500, { locationType: 'show', locationId: SID, opStatus: 'down',
      jobMeta: { [SID]: { area: 'Main Stage' } } });
    app.S.units = [down];
    app.S.issues = [{ id: id('i'), unitId: down.id, showId: SID, severity: 'down', title: 'Coolant leak',
      techName: 'Mike R.', timestamp: 1758400000000, resolved: false, photos: [] }];
    const hd = app.fn.unitCard(down, SID);
    t.includes(hd, '<span class="tag">Twin 400 kW · Main Stage</span>',
      'hard-DOWN twin: title still leads with the size — the issue never replaces it');
    t.includes(hd, 'Coolant leak', 'the issue shows on its own line');
    app.S.issues = [];
  }

  t.group('sort: NES order — per-engine size asc, single before twin');
  {
    /* Deliberately shuffled; serials chosen so the expected order is deterministic
       and so S-AA-TW400 (serial sorts FIRST) can only land after the 500 singles
       if the single-before-twin rule — not the serial tiebreak — put it there. */
    const list = [
      twin(500,  { serial: 'S-AA-TW400' }),               // Twin 400 -> 500 kVA/engine
      mkUnit({ serial: 'S-SG700',  kw: 700 }),
      mkUnit({ serial: 'S-NR2',    kw: null }),
      mkUnit({ serial: 'S-DOWN',   klass: 'small', kw: 25, opStatus: 'down' }),
      mkUnit({ serial: 'S-SG500B', kw: 500 }),
      twin(375,  { serial: 'S-TW300' }),                  // Twin 300 -> 375 kVA/engine
      mkUnit({ serial: 'S-SG437',  kw: '437.5' }),        // string kw must parse, not compare as text
      mkUnit({ serial: 'S-SM150',  klass: 'small', kw: 150 }),
      twin(625,  { serial: 'S-TW500' }),                  // Twin 500 -> 625 kVA/engine
      mkUnit({ serial: 'S-NR1',    kw: '' }),
      mkUnit({ serial: 'S-SG625',  kw: 625 }),
      twin(437.5,{ serial: 'S-TW350' }),                  // Twin 350 -> 437.5 kVA/engine
      mkUnit({ serial: 'S-SG500A', kw: 500 }),
    ];
    app.setState({ units: list, shows: [], issues: [], reports: [], movements: [] });
    const got = app.fn.sortUnits(list.slice()).map((u) => u.serial);
    t.eq(got.join(','),
      ['S-SM150', 'S-TW300', 'S-SG437', 'S-TW350', 'S-SG500A', 'S-SG500B', 'S-AA-TW400',
        'S-SG625', 'S-TW500', 'S-SG700', 'S-NR1', 'S-NR2', 'S-DOWN'].join(','),
      'FULL order: 150 small, Twin 300, 437.5, Twin 350, 500×2, Twin 400, 625, Twin 500, 700, no-rating, down');
    t.ok(got.indexOf('S-NR1') > got.indexOf('S-SG700') && got.indexOf('S-NR2') > got.indexOf('S-SG700'),
      'kw:\'\' and kw:null sink below every rated unit — Number(null)===0 never reads as smallest');
    t.eq(got[got.length - 1], 'S-DOWN', 'hard-down lands at the very bottom, after even the no-rating units');
    t.ok(got.indexOf('S-SG500A') < got.indexOf('S-SG500B'),
      'same-size same-type still tiebreaks by serial');
    t.ok(got.indexOf('S-AA-TW400') > got.indexOf('S-SG500B'),
      'same-size single/twin: single first even though the twin\'s serial sorts earlier');
  }

  t.group('search: kW and twin find big iron on every surface');
  {
    /* Serials/makes/models deliberately contain none of the query strings
       ('twin', '400', '1000', '150') so the absence assertions mean something. */
    const SID = 'show-Q';
    app.setState({ units: [
      twin(500, { id: 'q-twin', serial: 'S-QT', locationType: 'show', locationId: SID }),
      mkUnit({ id: 'q-big', serial: 'S-QB', kw: 625, locationType: 'show', locationId: SID }),
      mkUnit({ id: 'q-small', serial: 'S-QS', klass: 'small', make: 'MQ', model: '', kw: 150,
        locationType: 'show', locationId: SID }),
    ], shows: [{ id: SID, name: 'Quarry Fest' }], issues: [], reports: [], movements: [] });

    app.live.jobFilter = 'all';
    const job = (q) => { app.live.jobSearch = q; const h = app.fn.renderJobDetail(SID); app.live.jobSearch = ''; return h; };
    let h = job('twin');
    t.includes(h, 'S-QT', 'job search "twin" finds the twin');
    t.excludes(h, 'S-QB', 'job search "twin": big single absent');
    t.excludes(h, 'S-QS', 'job search "twin": small iron absent');
    t.includes(job('400'), 'S-QT', 'job search "400" finds the Twin 400');
    t.includes(job('400 kw'), 'S-QT', 'job search "400 kw" finds it too');
    t.includes(job('1000'), 'S-QT', 'job search "1000" — a month of kVA muscle memory still lands');
    t.includes(job('150'), 'S-QS', 'job search "150" still finds small iron');

    app.live.TAB = 'fleet'; app.live.fleetFilter = 'all'; app.live.fleetMake = 'all';
    const fleet = (q) => { app.live.fleetSearch = q; const h = app.fn.renderFleet(); app.live.fleetSearch = ''; return h; };
    h = fleet('twin');
    t.includes(h, 'S-QT', 'fleet search "twin" finds the twin');
    t.excludes(h, 'S-QB', 'fleet search "twin": big single absent');
    t.excludes(h, 'S-QS', 'fleet search "twin": small iron absent');
    t.includes(fleet('400'), 'S-QT', 'fleet search "400" finds the Twin 400');
    t.includes(fleet('400 kw'), 'S-QT', 'fleet search "400 kw" finds it too');
    t.includes(fleet('1000'), 'S-QT', 'fleet search "1000" — legacy kVA token now on the fleet surface too');
    t.includes(fleet('150'), 'S-QS', 'fleet search "150" finds small iron');

    app.fn.openScan('fleet');
    const add = (q) => { app.fn.searchFleet(q); return app.document.querySelector('#searchResults').innerHTML; };
    h = add('twin');
    t.includes(h, 'S-QT', 'add-sheet search "twin" finds the twin');
    t.excludes(h, 'S-QB', 'add-sheet search "twin": big single absent');
    t.excludes(h, 'S-QS', 'add-sheet search "twin": small iron absent');
    t.includes(add('400'), 'S-QT', 'add-sheet "400" finds the Twin 400');
    t.includes(add('400 kw'), 'S-QT', 'add-sheet "400 kw" finds it too');
    t.includes(add('1000'), 'S-QT', 'add-sheet "1000" — legacy kVA token unchanged');
    t.includes(add('150'), 'S-QS', 'add-sheet "150" finds small iron');
    app.fn.searchFleet('');
  }

  t.group('edit form: kVA input with live kW echo');
  {
    /* Input stays kVA (techs type what the nameplate says); a muted echo line
       translates to the crew's kW vocabulary as they type. Text-only readback:
       never a control, never prefills, and the save path stays kVA untouched. */
    const doc = app.document;
    const el = (i) => doc.getElementById(i);
    const FORM = ['f_serial', 'f_tag', 'f_weight', 'f_make', 'f_model', 'f_kw', 'f_breaker',
      'f_trailer', 'f_fuel', 'f_tank', 'f_hours', 'f_svc', 'f_area', 'f_notes',
      'f_kvaA', 'f_kvaB', 'f_hrsA', 'f_hrsB'];
    const stage = (unit) => {
      app.setState({ settings: Object.assign(app.fn.blankState().settings, { techName: 'Mike R.' }),
        shows: [{ id: 's1', name: 'Fest' }], currentShowId: 's1',
        units: [unit], reports: [], movements: [], issues: [] });
      FORM.forEach((i) => { el(i).value = ''; });
    };
    const openForm = (unit) => {
      stage(unit);
      app.fn.editUnit(unit.id);
      return doc.getElementById('sheet').innerHTML;
    };
    const bigOnShow = (o) => mkUnit(Object.assign({ locationType: 'show', locationId: 's1' }, o));

    let sh = openForm(bigOnShow({ id: 'e-sg', serial: 'S-ESG', kw: 625 }));
    t.includes(sh, 'id="f_kwEcho"', 'big single: kW echo line rendered in the form markup');
    t.includes(sh, 'oninput="kwEcho()"', 'the rating input drives the echo live');
    el('f_kw').value = '625'; app.fn.kwEcho();
    t.eq(el('f_kwEcho').textContent, '= 500 kW', 'typing 625 kVA echoes = 500 kW');
    t.eq(el('f_kwEcho').style.display, 'block', 'and the echo is visible');
    t.excludes(el('f_kwEcho').textContent + (el('f_kwEcho').innerHTML || ''), 'onclick',
      'echo is text, never a control');
    el('f_kw').value = ''; app.fn.kwEcho();
    t.eq(el('f_kwEcho').textContent, '', 'blank echoes nothing — the echo never suggests a value');
    t.eq(el('f_kwEcho').style.display, 'none', 'and the empty echo takes no space');
    el('f_kw').value = 'abc'; app.fn.kwEcho();
    t.eq(el('f_kwEcho').style.display, 'none', 'garbage hides it too');
    el('f_kw').value = '0'; app.fn.kwEcho();
    t.eq(el('f_kwEcho').style.display, 'none', 'zero is not a rating — hidden');

    sh = openForm(bigOnShow({ id: 'e-sm', serial: 'S-ESM', klass: 'small', kw: 150 }));
    t.excludes(sh, 'f_kwEcho', 'SMALL iron edit sheet contains NO kW echo element at all');

    sh = openForm(twin(500, { id: 'e-tw', serial: 'S-ETW', locationType: 'show', locationId: 's1' }));
    t.includes(sh, 'id="f_kvaEcho"', 'twin: per-engine echo line rendered under the nameplate pair');
    t.excludes(sh, 'f_kwEcho',
      'twin sheet has NO combined-kW echo — "= 800 kW" is a number no surface may show');
    t.eq((sh.match(/oninput="kvaEcho\(\)"/g) || []).length, 2, 'BOTH nameplate inputs drive it live');
    el('f_kvaA').value = '500'; el('f_kvaB').value = '500'; app.fn.kvaEcho();
    t.eq(el('f_kvaEcho').textContent, '= Twin 400 kW', 'matched nameplates echo the Twin size');
    t.eq(el('f_kvaEcho').style.display, 'block', 'and it shows');
    el('f_kvaB').value = '375'; app.fn.kvaEcho();
    t.eq(el('f_kvaEcho').textContent, '= 400 kW + 300 kW',
      'mismatched nameplates echo per engine — never a fake Twin label');
    el('f_kvaB').value = ''; app.fn.kvaEcho();
    t.eq(el('f_kvaEcho').textContent, '', 'either blank echoes nothing');
    t.eq(el('f_kvaEcho').style.display, 'none', 'and hides');

    /* on-open: an existing rating echoes immediately, before any keystroke.
       The harness DOM keeps element .value across re-renders, so pre-setting it
       stands in for the browser populating value="..." from the markup. */
    const pre = bigOnShow({ id: 'e-pre', serial: 'S-EPRE', kw: 625 });
    stage(pre);
    el('f_kw').value = '625';
    app.fn.editUnit('e-pre');
    t.eq(el('f_kwEcho').textContent, '= 500 kW', 'big single opens with the echo ALREADY lit');
    const ptw = twin(500, { id: 'e-ptw', serial: 'S-EPTW', locationType: 'show', locationId: 's1' });
    stage(ptw);
    el('f_kvaA').value = '500'; el('f_kvaB').value = '500';
    app.fn.editUnit('e-ptw');
    t.eq(el('f_kvaEcho').textContent, '= Twin 400 kW', 'twin opens with the per-engine echo lit');

    /* round-trip guard: the echo is display-only — an untouched save must
       round-trip the stored kVA EXACTLY, no ×0.8 drift into storage. */
    const rt = twin(500, { id: 'e-rt', serial: 'S-ERT', locationType: 'show', locationId: 's1' });
    openForm(rt);
    el('f_serial').value = rt.serial;
    el('f_kw').value = '1000';
    el('f_kvaA').value = '500'; el('f_kvaB').value = '500';
    app.fn.saveUnit('e-rt');
    const saved = app.S.units[0];
    t.eq(saved.kw, 1000, 'untouched save round-trips kw EXACTLY 1000 kVA — never 800');
    t.eq(saved.engines.A.kvaEach, 500, 'kvaEach A intact at 500');
    t.eq(saved.engines.B.kvaEach, 500, 'kvaEach B intact at 500');
  }

  t.group('info tab: rated specs derived, big iron only');
  {
    /* Rated amps = kVA×1000/(√3×V), derived at render from the stored nameplate
       rating — never stored, never an input. The Info tab is the machine-property
       surface (has_def precedent). "Combined (when paralleled)" is Andy's exact
       wording and the ONE surface a combined figure may appear, because it is
       explicitly conditional. */
    const pane = (u) => app.fn.paneInfo(u, 'Fleet yard');
    const block = (h) => {
      const i = h.indexOf('RATED SPECS');
      return i < 0 ? '' : h.slice(i, h.indexOf('PHOTOS'));
    };

    let h = pane(mkUnit({ id: 'i-sg', serial: 'S-ISG', kw: 625 }));
    t.includes(h, 'RATED SPECS', 'big single gets the rated specs block');
    t.includes(h, '0.8 PF', 'the kVA figure is labeled as the 0.8 PF rating');
    t.includes(h, '500 kW · 625 kVA · 1,735 A @208V · 752 A @480V',
      'the full derived line: kW, kVA, amps at both field voltages');
    t.includes(h, '<div class="k">Rating</div><div>500 kW</div>',
      'the Rating kv row now speaks kW like every other big-iron surface');
    t.excludes(h, '<div class="k">Rating</div><div>625 kVA</div>',
      'the old kVA-format Rating row is gone (625 kVA lives ONLY in the spec line)');
    t.excludes(block(h), '<input', 'the spec block renders zero inputs — derived, never entered');

    h = pane(twin(500, { id: 'i-tw', serial: 'S-ITW' }));
    t.includes(h, 'Per engine', 'twin block leads with the per-engine line');
    t.includes(h, '400 kW · 500 kVA · 1,388 A @208V · 601 A @480V',
      'per-engine figures from kvaEach');
    t.includes(h, 'Combined (when paralleled)',
      'combined line carries Andy\'s exact conditional wording');
    t.includes(h, '800 kW · 1,000 kVA · 2,776 A @208V · 1,203 A @480V',
      'combined figures are exactly 2× per engine');
    t.includes(h, '<div class="k">Rating</div><div>Twin 400 kW</div>',
      'twin Rating row reads Twin 400 kW');
    t.excludes(block(h), '<input', 'twin spec block renders zero inputs too');

    h = pane(mkUnit({ id: 'i-sm', serial: 'S-ISM', klass: 'small', kw: 150 }));
    t.excludes(h, 'RATED SPECS', 'small iron gets NO spec block');
    t.excludes(h, '@208V', 'and no amp figure anywhere on the pane');
    t.includes(h, '<div class="k">Rating</div><div>150 kVA</div>',
      'small-iron Rating row stays kVA, unchanged');

    h = pane(mkUnit({ id: 'i-nr', serial: 'S-INR', kw: null }));
    t.excludes(h, 'RATED SPECS', 'big iron with no rating: no spec block');
    t.excludes(h, 'NaN', 'and no NaN artifact');
    t.includes(h, '<div class="k">Rating</div><div>—</div>', 'no-rating Rating row is the em dash');

    h = pane(mkUnit({ id: 'i-kw2', serial: 'S-IK2', kw: 1000, engines: { A: {}, B: {} } }));
    t.includes(h, '400 kW · 500 kVA · 1,388 A @208V · 601 A @480V',
      'twin with no kvaEach: per-engine line still derives from kw/2 (binding-pass stragglers)');
    t.includes(h, 'Combined (when paralleled)', 'and the combined line still renders');
  }
};
