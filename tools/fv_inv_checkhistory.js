/**
 * fv_inv_checkhistory.js — standing invariants for the unit history surface.
 *
 * General history access (2026-08-11): the Vitals tab answers "what has this
 * unit been doing lately" for anyone — a 30-day summary card that is always
 * visible, and a collapsed day-grouped history that replaces the flat 25-row
 * check log. Contracts: the summary math is corruption-resistant (meter typos
 * and backwards readings never poison runtime); everything reads through the
 * reportsFor() choke point so a VOIDED check can never reach the runtime walk
 * or the load pool; derived load stays visibly marked; collapsed by default.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'small',
    opStatus: 'running', locationType: 'show', locationId: 'show-A', photos: [], jobMeta: {}, updatedAt: 1 }, o);
  const H = 3600e3, D = 24 * H;
  const T = Date.now();
  const rpt = (o) => Object.assign({ id: id('r'), unitId: 'u-h', techName: 'Mike R.' }, o);

  t.group('history summary math: corruption-resistant runtime walk');
  const sum = app.fn.summarizeChecks;
  // newest-first input, like reportsFor returns
  const clean = [4, 3, 2, 1, 0].map((d) => rpt({ timestamp: T - d * D, engineHours: 100 + (4 - d) * 2.5 }));
  let s = sum(clean.slice().reverse());
  t.eq(s.runHrs, 10, 'clean meters: 100->110 over 4 days -> 10 h run');
  t.eq(s.dutyPct, 10, 'duty = run over span of accepted readings (10/96h -> 10%)');
  s = sum([rpt({ timestamp: T, engineHours: 110 }), rpt({ timestamp: T - 1 * D, engineHours: 9999 }), rpt({ timestamp: T - 2 * D, engineHours: 100 })]);
  t.eq(s.runHrs, 10, 'a 9999 typo spike is skipped, not summed — the walk reconciles past it');
  s = sum([rpt({ timestamp: T, engineHours: 12 }), rpt({ timestamp: T - 1 * D, engineHours: 5 }), rpt({ timestamp: T - 2 * D, engineHours: 110 }), rpt({ timestamp: T - 3 * D, engineHours: 100 })]);
  t.eq(s.runHrs, 10, 'backwards readings (meter swap) never subtract — runtime is 10, not negative');
  s = sum([rpt({ timestamp: T, engineHours: 200 }), rpt({ timestamp: T - 2 * H, engineHours: 100 })]);
  t.ok(s.runHrs === null, 'faster-than-wall-clock pair rejected -> too little evidence, null (got ' + s.runHrs + ')');
  s = sum([rpt({ timestamp: T, engineHours: 100 })]);
  t.ok(s.runHrs === null && s.dutyPct === null, 'a single reading proves nothing');
  s = sum([rpt({ timestamp: T, engineHours: 105 }), rpt({ timestamp: T - 12 * H, engineHours: 100 })]);
  t.ok(s.runHrs === 5 && s.dutyPct === null, 'span under 24h: run counts, duty stays null (got ' + s.dutyPct + ')');

  t.group('history summary math: load pool and vitals');
  s = sum([rpt({ timestamp: T, loadPct: 40 }), rpt({ timestamp: T - D, loadPct: 60 })]);
  t.ok(s.medLoad === 50 && s.medLoadEst === false && s.peakLoad === 60, 'metered median 50, peak 60, unmarked');
  s = sum([rpt({ timestamp: T, loadPct: 40 }), rpt({ timestamp: T - D, voltageLL: 480, ampsL1: 60, ampsL2: 60, ampsL3: 60, ratingKva: 100 })]);
  t.ok(s.medLoad === 45 && s.medLoadEst === true, 'derived readings pool in and mark the median est (got ' + s.medLoad + '/' + s.medLoadEst + ')');
  s = sum([rpt({ timestamp: T, coolantTemp: 180 }), rpt({ timestamp: T - D, coolantTemp: 212 }), rpt({ timestamp: T - 2 * D })]);
  t.eq(s.maxCool, 212, 'max coolant across the window');

  t.group('history: voided checks never reach the math — the choke point holds');
  app.setState({ units: [mkUnit({ id: 'u-h' })], shows: [{ id: 'show-A', name: 'Lollapalooza' }], issues: [] });
  app.S.settings.techName = 'Mike R.';
  app.S.reports = [
    rpt({ id: 'h-good2', timestamp: T - 1 * D, engineHours: 110, loadPct: 20 }),
    rpt({ id: 'h-good1', timestamp: T - 3 * D, engineHours: 100, loadPct: 10 }),
    rpt({ id: 'h-void', timestamp: T - 2 * D, engineHours: 99999, loadPct: 95, coolantTemp: 400, voidedAt: T - 2 * D + 60e3, voidedBy: 'Mike R.' }),
  ];
  const uH = app.S.units.find((x) => x.id === 'u-h');
  const sv = app.fn.summarizeChecks(app.fn.reportsFor('u-h'));
  t.eq(sv.runHrs, 10, 'voided corrupt meter reading never enters the runtime walk');
  t.eq(sv.peakLoad, 20, 'voided load value never enters the pool');
  t.ok(sv.maxCool == null, 'voided coolant never enters the vitals');
  const pv0 = app.fn.paneVitals(uH);
  t.excludes(pv0, '99999', 'and the rendered card never shows it');

  t.group('history render: summary card always visible, general answers');
  app.S.issues = [
    { id: 'hi1', unitId: 'u-h', timestamp: T - 1 * D, severity: 'maintenance', title: 'Belt', resolved: false },
    { id: 'hi2', unitId: 'u-h', timestamp: T - 40 * D, severity: 'cosmetic', title: 'Old paint', resolved: true },
  ];
  const pv = app.fn.paneVitals(uH);
  t.includes(pv, 'Last 30 days', 'summary card renders without any tap');
  t.includes(pv, '10 h', 'run time on the card');
  t.includes(pv, 'peak 20%', 'load line carries median and peak');
  t.includes(pv, '1 opened · 1 open', 'issues line: opened in window, still open overall');
  app.S.reports = [rpt({ id: 'only', timestamp: T - D, loadPct: 15 })];
  t.excludes(app.fn.paneVitals(uH), 'Last 30 days', 'a single check earns no summary — the Latest card already says it');

  t.group('history render: collapsed by default, day-grouped when opened');
  app.setState({ units: [mkUnit({ id: 'u-h' })],
    shows: [{ id: 'show-A', name: 'Lollapalooza' }, { id: 'show-B', name: 'Hinterland' }], issues: [] });
  app.S.settings.techName = 'Mike R.';
  app.S.reports = [
    rpt({ id: 'hh-new', timestamp: T - 1 * D, showId: 'show-A', loadPct: 22, notes: 'humming along' }),
    rpt({ id: 'hh-mid', timestamp: T - 2 * D, showId: 'show-A', loadPct: 18, notes: 'second day note' }),
    rpt({ id: 'hh-old', timestamp: T - 40 * D, showId: 'show-B', loadPct: 55, notes: 'ancient history marker' }),
  ];
  app.fn.openUnit('u-h');
  let sheetHtml = app.document.querySelector('#sheet').innerHTML;
  t.includes(sheetHtml, 'History', 'collapsed header present');
  t.includes(sheetHtml, '2 in 30 days', 'window count in the header');
  t.includes(sheetHtml, '3 total', 'lifetime count in the header');
  t.excludes(sheetHtml, 'second day note', 'collapsed: no history rows render (latest card may still show the newest note)');
  app.fn.toggleHist('u-h');
  sheetHtml = app.document.querySelector('#sheet').innerHTML;
  t.includes(sheetHtml, 'evday', 'expanded: day headers render');
  t.includes(sheetHtml, 'Lollapalooza', 'the day header names the show');
  t.includes(sheetHtml, 'second day note', 'check rows render under their day');
  t.excludes(sheetHtml, 'ancient history marker', '40-day-old check stays outside the window');
  t.includes(sheetHtml, 'Show all 3 checks', 'the tail offers everything');
  app.fn.histShowAll('u-h');
  sheetHtml = app.document.querySelector('#sheet').innerHTML;
  t.includes(sheetHtml, 'ancient history marker', 'Show all reveals the full record');
  t.includes(sheetHtml, 'Hinterland', 'and the older show gets its own day-header name');
  app.fn.openUnit('u-h');
  t.excludes(app.document.querySelector('#sheet').innerHTML, 'second day note', 'reopening the unit re-collapses history');

  t.group('history render: row fidelity survives the extraction');
  app.S.issues = [{ id: 'hi3', unitId: 'u-h', timestamp: T, severity: 'maintenance', title: 'x', resolved: false, fromReportId: 'hh-new' }];
  app.S.reports.push(rpt({ id: 'hh-est', timestamp: T - 3 * D, showId: 'show-A', voltageLL: 480, ampsL1: 60, ampsL2: 60, ampsL3: 60, ratingKva: 100, notes: '<img src=x>' }));
  app.fn.openUnit('u-h'); app.fn.toggleHist('u-h');
  sheetHtml = app.document.querySelector('#sheet').innerHTML;
  t.includes(sheetHtml, 'filed as issue', 'promoted-note chip survives in history rows');
  t.includes(sheetHtml, 'load ~50% est', 'derived load stays marked in history rows');
  t.excludes(sheetHtml, '<img src=x>', 'hostile note strings stay escaped');

  t.group('history render: twin engine scoping');
  app.setState({ units: [mkUnit({ id: 'u-tw2', klass: 'big', kw: 1000, engines: { A: { kvaEach: 500 }, B: { kvaEach: 500 } } })],
    shows: [{ id: 'show-A', name: 'A' }], issues: [] });
  app.S.reports = [
    { id: 'twA', unitId: 'u-tw2', techName: 'Mike R.', engine: 'A', timestamp: T - D, engineHours: 500, notes: 'alpha engine note' },
    { id: 'twB', unitId: 'u-tw2', techName: 'Mike R.', engine: 'B', timestamp: T - D, engineHours: 900, notes: 'bravo engine note' },
  ];
  app.fn.openUnit('u-tw2');
  app.fn.setVitalsEng('u-tw2', 'B');
  app.fn.toggleHist('u-tw2');
  sheetHtml = app.document.querySelector('#sheet').innerHTML;
  t.includes(sheetHtml, 'bravo engine note', 'engine B history shows B');
  t.excludes(sheetHtml, 'alpha engine note', 'and never A — history inherits the chip scoping');
};
