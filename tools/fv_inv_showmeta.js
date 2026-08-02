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
    pmName: 'Andy P.', cesJobNumber: '26-1042', tz: 'America/Chicago',
    site: { lat: 41.87, lng: -87.62, zoom: 16 }, createdAt: 1753000000000, archivedAt: null };
  const row = app.fn.toRow('shows', full);
  t.deep(row.show_days, ['2026-07-30', '2026-07-31', '2026-08-01'], 'show_days serializes as the date array');
  t.eq(row.pm_name, 'Andy P.', 'pm_name maps');
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
  app.document.querySelector('#sh_pm').value = ' Andy P. ';
  app.document.querySelector('#sh_job').value = '26-1042';
  app.document.querySelector('#sh_tz').value = 'America/Chicago';
  app.fn.saveShow(sh.id);
  t.eq(sh.pmName, 'Andy P.', 'PM name trims and saves');
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

  t.group('tzGuess: known venue -> known zone, unknown -> null');
  t.eq(app.fn.tzGuess({ lng: -87.62 }), 'America/Chicago', 'Grant Park -> Central');
  t.eq(app.fn.tzGuess({ lng: -116.24 }), 'America/Los_Angeles', 'Indio -> Pacific');
  t.eq(app.fn.tzGuess({ lng: -104.99 }), 'America/Denver', 'Denver -> Mountain');
  t.eq(app.fn.tzGuess({ lng: -73.97 }), 'America/New_York', 'NYC -> Eastern');
  t.eq(app.fn.tzGuess(null), null, 'no venue pin -> null, never a default zone');
};
