/**
 * fv_inv_writepath.js — standing invariants for write-path correctness
 * (2026-08-02 build): show stamps come from the unit, hours get a sanity
 * warning that never blocks, make is a pick-list with a free-text escape.
 *
 * The show stamped on a row about a unit is the UNIT's location, never
 * S.currentShowId — a tech with the wrong job open in the top bar must not
 * mis-attribute rows. Off-show units stamp null; a guess is worse than a gap.
 */
'use strict';
module.exports = async (app, t) => {
  const HOUR = 3600e3;
  const mkUnit = (o = {}) => Object.assign({ id: 'u-' + Math.random().toString(36).slice(2, 8),
    serial: 'SER' + Math.random().toString(36).slice(2, 6).toUpperCase(), tagId: '', klass: 'big',
    opStatus: 'running', locationType: 'show', locationId: 'show-A', photos: [], jobMeta: {}, updatedAt: 1 }, o);
  const lastReport = (uid) => app.S.reports.filter((x) => x.unitId === uid).slice(-1)[0];
  /* The DOM stub doesn't ingest rendered markup, so mirror what the real form
     shows: the serial input is prefilled with the unit's serial. Without this,
     saveUnit generates same-ms GEN- serials that trip the dedup guard. */
  const openEdit = (id) => { app.fn.editUnit(id);
    app.document.querySelector('#f_serial').value = app.fn.unitById(id).serial;
    app.document.querySelector('#f_tag').value = ''; };

  t.group('write path: unitShowId is the only show source for unit rows');
  t.eq(app.fn.unitShowId({ locationType: 'show', locationId: 'show-X' }), 'show-X', 'on a show -> that show');
  t.eq(app.fn.unitShowId({ locationType: 'shop', locationId: 'shop-1' }), null, 'at a shop -> null');
  t.eq(app.fn.unitShowId({ locationType: 'transit', locationId: null, inTransitToShowId: 'show-X' }), null, 'in transit -> null, never the destination');
  t.eq(app.fn.unitShowId({ locationType: 'fleet', locationId: null }), null, 'unassigned -> null');

  t.group('write path: checks and issues stamp the unit\'s show, not the open tab');
  app.setState({
    units: [mkUnit({ id: 'u-on-a', locationType: 'show', locationId: 'show-A' }),
            mkUnit({ id: 'u-free', locationType: 'fleet', locationId: null })],
    shows: [{ id: 'show-A', name: 'Alpha Fest' }, { id: 'show-B', name: 'Bravo Fest' }],
  });
  app.S.settings.techName = 'Mike R.';
  app.S.currentShowId = 'show-B';                       // wrong job open in the top bar
  app.fn.logVitals('u-on-a');
  app.fn.saveVitals('u-on-a');
  t.eq(lastReport('u-on-a').showId, 'show-A', 'check stamps the unit\'s own show while show-B is selected');
  app.fn.logVitals('u-free');
  app.fn.saveVitals('u-free');
  t.eq(lastReport('u-free').showId, null, 'unassigned unit stamps null, never the open tab');
  app.fn.flagIssue('u-on-a');
  app.document.querySelector('#i_title').value = 'Coolant leak';
  app.document.querySelector('#i_text').value = '';
  app.fn.saveIssue('u-on-a');
  t.eq(app.S.issues.slice(-1)[0].showId, 'show-A', 'issue stamps the unit\'s own show');
  app.fn.flagIssue('u-free');
  app.document.querySelector('#i_title').value = 'Dent';
  app.document.querySelector('#i_text').value = '';
  app.fn.saveIssue('u-free');
  t.eq(app.S.issues.slice(-1)[0].showId, null, 'issue on unassigned unit stamps null');

  t.group('write path: jobMeta keys to the unit\'s own show (edit form)');
  app.S.currentShowId = 'show-B';
  openEdit('u-on-a');
  let areaEl = app.document.querySelector('#f_area');
  t.ok(!!areaEl, 'placement field renders for a unit on a show');
  if (areaEl) {
    areaEl.value = 'VIP South';
    app.fn.saveUnit('u-on-a');
    const u = app.fn.unitById('u-on-a');
    t.eq(u.jobMeta['show-A'] && u.jobMeta['show-A'].area, 'VIP South', 'placement saved under the unit\'s show');
    t.ok(!u.jobMeta['show-B'], 'nothing keyed to the merely-open show');
  }
  openEdit('u-free');
  const offForm = app.document.querySelector('#sheet').innerHTML;
  t.excludes(offForm, 'f_area', 'off-show unit gets no placement field (nowhere honest to save it)');
  app.fn.saveUnit('u-free');
  t.eq(Object.keys(app.fn.unitById('u-free').jobMeta || {}).length, 0, 'saving an off-show unit writes no jobMeta key');

  t.group('hours sanity: pure rules');
  const T0 = app.fn.now(), ago7 = T0 - 7 * HOUR;
  t.eq(app.fn.hoursSanity(2645, 2640, ago7, T0), null, 'plausible advance (5h in 7h) passes');
  t.eq(app.fn.hoursSanity(2640, 2640, ago7, T0), null, 'unchanged meter passes');
  t.ok(app.fn.hoursSanity(1000, 2640, ago7, T0) && app.fn.hoursSanity(1000, 2640, ago7, T0).kind === 'back', 'backward reading flags');
  t.ok(app.fn.hoursSanity(12641, 2640, ago7, T0) && app.fn.hoursSanity(12641, 2640, ago7, T0).kind === 'fast', 'impossible rate flags (10,001h in 7h)');
  t.eq(app.fn.hoursSanity(2650, 2640, T0 - 10 * HOUR, T0), null, '10h in 10h passes inside the 1.1 band');
  t.eq(app.fn.hoursSanity(50, null, null, T0), null, 'no prior reading -> nothing to compare');
  t.eq(app.fn.hoursSuggest('12641', 2640, ago7, T0), 2641, 'drop-a-digit suggestion lands on 2641');
  t.eq(app.fn.hoursSuggest('99999', 2640, ago7, T0), null, 'no plausible candidate -> no suggestion');

  t.group('hours sanity: inline warning on the check form, never a gate');
  app.setState({
    units: [mkUnit({ id: 'u-hrs', klass: 'big', kw: 500 }),
            mkUnit({ id: 'u-fresh', klass: 'big', kw: 500 }),
            mkUnit({ id: 'u-tw', klass: 'big', kw: 1250, engines: { style: 'AB', A: { kvaEach: 625 }, B: { kvaEach: 625 } } })],
    shows: [{ id: 'show-A', name: 'Alpha Fest' }],
    reports: [
      { id: 'r-old', unitId: 'u-hrs', techName: 'Dana', timestamp: app.fn.now() - 7 * HOUR, engineHours: 2640 },
      { id: 'r-twA', unitId: 'u-tw', techName: 'Dana', timestamp: app.fn.now() - 100 * HOUR, engineHours: 5000 }, // untagged = pre-split = A lineage
      { id: 'r-twB', unitId: 'u-tw', engine: 'B', techName: 'Dana', timestamp: app.fn.now() - 7 * HOUR, engineHours: 100 },
    ],
  });
  app.S.settings.techName = 'Mike R.';
  const warn = () => app.document.querySelector('#v_hrsWarn').innerHTML;
  const type = (v) => { app.document.querySelector('#v_hrs').value = v; app.fn.hoursFlag(); };

  app.fn.logVitals('u-hrs');
  type('12641');
  t.includes(warn(), '2,640', 'warning states the last reading');
  t.includes(warn(), '10,001', 'warning states the implied hours run');
  t.includes(warn(), 'Did you mean 2,641', 'one-tap likely correction offered');
  app.fn.applyHoursSuggest(2641);
  t.eq(String(app.document.querySelector('#v_hrs').value), '2641', 'tapping the suggestion fills the field');
  t.eq(warn(), '', 'corrected value clears the warning');
  type('1000');
  t.includes(warn(), 'run backward', 'backward reading warns');
  type('2645');
  t.eq(warn(), '', 'plausible reading stays silent');
  type('12641');
  app.fn.saveVitals('u-hrs');
  t.eq(lastReport('u-hrs').engineHours, 12641, 'WARN NEVER BLOCKS: the typed value saves untouched');

  app.fn.logVitals('u-fresh');
  type('50');
  t.eq(warn(), '', 'no prior recorded reading -> no warning');

  app.fn.logVitals('u-tw', 'B');
  type('105');
  t.eq(warn(), '', 'twin engine B compares against B history (105 vs 100), not A\'s 5,000');
  type('90');
  t.includes(warn(), 'run backward', 'B going backward vs its own meter warns');
  app.fn.logVitals('u-tw', 'A');
  type('5001');
  t.eq(warn(), '', 'engine A compares against its own (pre-split) lineage');

  t.group('make pick-list: case-normalized, fleet-derived, Other never blocked');
  app.setState({
    units: [mkUnit({ id: 'u-m1', make: 'CAT' }), mkUnit({ id: 'u-m2', make: 'CAT' }),
            mkUnit({ id: 'u-m3', make: 'Cat', locationType: 'fleet', locationId: null }),
            mkUnit({ id: 'u-m4', make: 'shindaiwa' }), mkUnit({ id: 'u-m5', make: 'Shindaiwa' }),
            mkUnit({ id: 'u-m6', make: 'Shindaiwa' }), mkUnit({ id: 'u-m7', make: '' }), mkUnit({ id: 'u-m8', make: null })],
    shows: [{ id: 'show-A', name: 'Alpha Fest' }],
  });
  app.S.settings.techName = 'Mike R.';
  t.eq(JSON.stringify(app.fn.makeOptions()), JSON.stringify(['CAT', 'Shindaiwa']),
    'one canonical spelling per make, most common wins, blanks excluded (got ' + JSON.stringify(app.fn.makeOptions()) + ')');
  openEdit('u-m3');                                     // stored as 'Cat'
  const mform = app.document.querySelector('#sheet').innerHTML;
  t.includes(mform, '— No make —', 'blank stays choosable (every field optional)');
  t.includes(mform, 'value="CAT" selected', "case variant 'Cat' preselects the canonical 'CAT'");
  t.includes(mform, 'Other…', 'free-text escape present');
  app.document.querySelector('#f_make').value = '__other';
  app.document.querySelector('#f_make_other').value = 'Generac';
  app.fn.saveUnit('u-m3');
  t.eq(app.fn.unitById('u-m3').make, 'Generac', 'Other accepts a genuinely new manufacturer');
  openEdit('u-m1');
  app.document.querySelector('#f_make').value = '';
  app.fn.saveUnit('u-m1');
  t.eq(app.fn.unitById('u-m1').make, '', 'clearing make is allowed — nothing is required');
};
