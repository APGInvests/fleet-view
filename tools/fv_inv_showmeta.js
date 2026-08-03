/**
 * fv_inv_showmeta.js — standing invariants for show/job metadata
 * (2026-08-02 build): show_days / pm_name / ces_job_number / tz / archived_at.
 *
 * show_days is a sorted, deduped ISO-date array and null when empty — NEVER [].
 * Text fields save null, never '' (7c64b38 convention). Every mapped column
 * must round-trip toRow→fromRow unchanged: these columns exist in Postgres
 * (migration run 2026-08-02) and a mapped-but-missing column is the
 * movements.photos incident, so the map and the schema move together.
 */
'use strict';
module.exports = async (app, t) => {
  const lastShow = () => app.S.shows.slice(-1)[0];

  t.group('shows map: new columns serialize and round-trip');
  const full = { id: 'show-rt', name: 'Roundtrip Fest', location: 'Chicago, Grant Park',
    startDate: '2026-07-15', showDays: ['2026-07-30', '2026-07-31', '2026-08-01'],
    pmName: 'Sam R.', cesJobNumber: '26-1042', tz: 'America/Chicago',
    site: { lat: 41.87, lng: -87.62, zoom: 16 }, createdAt: 1753000000000, archivedAt: null };
  const row = app.fn.toRow('shows', full);
  t.deep(row.show_days, ['2026-07-30', '2026-07-31', '2026-08-01'], 'show_days serializes as the date array');
  t.eq(row.pm_name, 'Sam R.', 'pm_name maps');
  t.eq(row.ces_job_number, '26-1042', 'ces_job_number maps');
  t.eq(row.tz, 'America/Chicago', 'tz maps');
  t.ok('archived_at' in row, 'archived_at column is always present in the payload');
  t.eq(row.archived_at, null, 'archived_at serializes null, not undefined');
  const back = app.fn.fromRow('shows', row);
  t.deep(back, full, 'toRow→fromRow round-trips every field unchanged');

  t.group('saveShow: sorted dedup, null-not-[], null-not-empty-string');
  app.setState({ shows: [] });
  app.fn.editShow();
  /* The DOM stub doesn't ingest rendered markup — set the form values the way
     a user would have. Toggle order is deliberately unsorted with a re-toggle. */
  app.document.querySelector('#sh_name').value = 'Roundtrip Fest';
  app.document.querySelector('#sh_loc').value = '';
  app.document.querySelector('#sh_start').value = '';
  app.document.querySelector('#sh_pm').value = '   ';
  app.document.querySelector('#sh_job').value = '';
  app.document.querySelector('#sh_tz').value = '';
  app.fn.calTog('2026-09-06');
  app.fn.calTog('2026-09-05');
  app.fn.calTog('2026-09-06');   // deselect
  app.fn.calTog('2026-09-06');   // reselect
  app.fn.saveShow('');
  const sh = lastShow();
  t.deep(sh.showDays, ['2026-09-05', '2026-09-06'], 'days save sorted ascending regardless of tap order');
  t.eq(sh.pmName, null, 'whitespace PM saves null, never ""');
  t.eq(sh.cesJobNumber, null, 'blank job # saves null, never ""');
  t.eq(sh.tz, null, 'no tz chosen and no venue pin -> null, no fabricated zone');

  t.group('saveShow: populated fields survive an edit round-trip');
  app.fn.editShow(sh.id);
  app.document.querySelector('#sh_name').value = 'Roundtrip Fest';
  app.document.querySelector('#sh_start').value = '2026-09-01';
  app.document.querySelector('#sh_pm').value = ' Sam R. ';
  app.document.querySelector('#sh_job').value = '26-1042';
  app.document.querySelector('#sh_tz').value = 'America/Chicago';
  app.fn.saveShow(sh.id);
  t.eq(sh.pmName, 'Sam R.', 'PM name trims and saves');
  t.eq(sh.cesJobNumber, '26-1042', 'job # saves');
  t.eq(sh.tz, 'America/Chicago', 'explicit tz choice wins');
  t.deep(sh.showDays, ['2026-09-05', '2026-09-06'], 'editShow re-seeds the picker from saved days');
  const reloaded = app.fn.fromRow('shows', app.fn.toRow('shows', sh));
  t.deep(reloaded.showDays, sh.showDays, 'show_days survives persistence round-trip');
  t.eq(reloaded.pmName, sh.pmName, 'pm_name survives persistence round-trip');
  t.eq(reloaded.cesJobNumber, sh.cesJobNumber, 'ces_job_number survives persistence round-trip');
  t.eq(reloaded.tz, sh.tz, 'tz survives persistence round-trip');
  t.eq(reloaded.startDate, '2026-09-01', 'start_date survives persistence round-trip');

  t.group('saveShow: clearing every day stores null, never []');
  app.fn.editShow(sh.id);
  app.document.querySelector('#sh_name').value = 'Roundtrip Fest';
  app.fn.calTog('2026-09-05');
  app.fn.calTog('2026-09-06');
  app.fn.saveShow(sh.id);
  t.eq(sh.showDays, null, 'empty selection -> null');
  t.eq(app.fn.toRow('shows', sh).show_days, null, 'and serializes as SQL null');

  t.group('quick-add jobs stay schema-complete');
  app.document.querySelector('#qj_name').value = 'Popup Fest';
  app.document.querySelector('#qj_loc').value = '';
  app.fn.doQuickAddJob('');
  const quick = app.fn.toRow('shows', lastShow());
  t.ok('show_days' in quick && 'pm_name' in quick && 'ces_job_number' in quick && 'tz' in quick, 'quick-add payload carries every shows column');
  t.eq(quick.show_days, null, 'quick-add show_days is null, not undefined');

  t.group('job detail: the Edit entry point exists');
  /* editShow's edit branch was unreachable for the app's whole life — every
   * caller was id-less. Metadata that can only be set at creation is metadata
   * that doesn't exist on live jobs, so the hook is a standing contract. */
  app.fn.openJob(sh.id);
  const detail = app.document.querySelector('#view').innerHTML;
  t.includes(detail, `editShow('${sh.id}')`, 'job detail header carries an Edit hook for this job');

  t.group('show-days calendar: month navigation both ways, with year rollover');
  const monthLabel = (y, m) => new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shownMonth = () => {
    const mm = String(app.document.querySelector('#sh_cal').innerHTML).match(/<b>([^<]+)<\/b>/);
    return mm && mm[1];
  };
  app.fn.calInit({ showDays: ['2026-08-15'] }); app.fn.renderCal();
  t.eq(shownMonth(), monthLabel(2026, 7), 'opens on the anchor month');
  app.fn.calNav(1); t.eq(shownMonth(), monthLabel(2026, 8), 'forward advances one month');
  app.fn.calNav(-1); t.eq(shownMonth(), monthLabel(2026, 7), 'back returns one month');
  app.fn.calInit({ showDays: ['2026-12-15'] }); app.fn.renderCal();
  app.fn.calNav(1); t.eq(shownMonth(), monthLabel(2027, 0), 'December -> January rolls the year forward');
  app.fn.calInit({ showDays: ['2027-01-10'] }); app.fn.renderCal();
  app.fn.calNav(-1); t.eq(shownMonth(), monthLabel(2026, 11), 'January -> December rolls the year back');

  t.group('edit-job sheet: no button may nest inside a label');
  /* The calendar originally lived inside <label class="fld">. A label forwards
   * activation to its FIRST labelable descendant — the back arrow — so on iOS a
   * tap on the forward arrow ran calNav(1) and then the label clicked calNav(-1):
   * net zero, "forward does nothing". The JS was correct; the container was the
   * bug. No harness can reproduce label semantics, but markup can be guarded. */
  app.fn.editShow();
  const sheetHtml = String(app.document.querySelector('#sheet').innerHTML);
  const labels = sheetHtml.match(/<label[\s\S]*?<\/label>/g) || [];
  t.ok(labels.length >= 5, 'edit-job sheet renders its labelled fields');
  t.ok(labels.every((l) => !/<button/i.test(l)), 'no <button> inside any <label> in the edit-job sheet');
  t.excludes(sheetHtml, 'Andy', 'no real person\'s name in the sheet markup');

  t.group('tzGuess: known venue -> known zone, unknown -> null');
  t.eq(app.fn.tzGuess({ lng: -87.62 }), 'America/Chicago', 'Grant Park -> Central');
  t.eq(app.fn.tzGuess({ lng: -116.24 }), 'America/Los_Angeles', 'Indio -> Pacific');
  t.eq(app.fn.tzGuess({ lng: -104.99 }), 'America/Denver', 'Denver -> Mountain');
  t.eq(app.fn.tzGuess({ lng: -73.97 }), 'America/New_York', 'NYC -> Eastern');
  t.eq(app.fn.tzGuess(null), null, 'no venue pin -> null, never a default zone');
};
