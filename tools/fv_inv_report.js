/**
 * fv_inv_report.js — end-of-show status report reads for people who have
 * never heard of FleetView (2026-09-28, `report-readability`).
 *
 * Field incident: a tech sent the report to operations; it read as a wall of
 * text, sections ran together, and cosmetic items sat inside the hard-down
 * entry so they looked like part of the failure. Contracts:
 *
 *  1. Header block: title, ONE plain sentence for outside readers, then
 *     Job / Date / Filed by / Units — and a blank line before the first
 *     section.
 *  2. Four sections, always present, blank-line separated, in priority
 *     order: HARD DOWN → NEEDS / OVER SERVICE → COSMETIC / NON-BLOCKING →
 *     RUNNING OK. Empty sections say so ("none") instead of vanishing —
 *     "HARD DOWN (0)" is the headline an ops reader needs.
 *  3. Unit line speaks the card vocabulary: size · job label · #serial
 *     (sizeText first, make/model only as the no-rating fallback, never
 *     an "Asset" placeholder). Status + hours + service on the line below.
 *  4. Cosmetic issues NEVER render inside a hard-down or needs-service
 *     entry — they move to COSMETIC / NON-BLOCKING under their own unit
 *     identity line. A cosmetic-only unit still counts as RUNNING OK
 *     (cosmetic is non-blocking by definition; sections partition).
 *  5. Photos: never a URL (Andy, 2026-09-28 — the Storage links are
 *     permanent and public; he sends photos himself on request). An issue
 *     with photos says "(N photos on file)" so ops knows to ask.
 *  6. Twins: flat currentHours is Engine A's pre-split seed (§4) and is
 *     never printed; the service call-out names the engine.
 *  7. Share plumbing unchanged: Copy = clipboard, Email = mailto:. No Web
 *     Share, no HTML body (killed by Andy, 2026-09-28).
 */
'use strict';
const fs = require('fs');
const path = require('path');
module.exports = (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const URL1 = 'https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/issues/x/1.jpg';
  const mkUnit = (o = {}) => Object.assign({
    id: id('u'), serial: 'SER' + (++seq), tagId: '', klass: 'small', make: '',
    model: '', kw: null, opStatus: 'running', locationType: 'show',
    locationId: 'sh-1', currentHours: null, serviceDueHours: null,
    photos: [], jobMeta: {}, updatedAt: 1 }, o);
  const mkIssue = (unitId, o = {}) => Object.assign({
    id: id('i'), unitId, severity: 'maintenance', title: '', text: '',
    photos: [], resolved: false, timestamp: 1000 }, o);
  const mkRep = (unitId, o = {}) => Object.assign({
    id: id('r'), unitId, timestamp: 1000, gps: null }, o);

  const setup = (units, issues = [], reports = []) => {
    app.setState({
      shows: [{ id: 'sh-1', name: 'Bourbon & Beyond', location: 'Louisville, KY' }],
      units, issues, reports, movements: [],
    });
    app.S.settings.techName = 'Andy P.';
    return app.fn.buildReportText('sh-1');
  };
  // Section slice: from one header up to the next (or end).
  const sec = (txt, name, next) => {
    const a = txt.indexOf('== ' + name);
    const b = next ? txt.indexOf('== ' + next) : txt.length;
    return a >= 0 ? txt.slice(a, b) : '';
  };

  /* The standing five-unit scenario:
   *  - down big single, labeled, with a down issue (2 photos) AND a
   *    cosmetic issue (1 photo)
   *  - over-service twin (Gen B over by 120 h), flat hours must not print
   *  - cosmetic-only small unit
   *  - two clean units (one running, one staged, one with an asset photo) */
  const down = mkUnit({ serial: 'U041866X', klass: 'big', make: 'CAT', model: 'XQ-500',
    kw: 625, opStatus: 'down', currentHours: 3200, serviceDueHours: 3080,
    jobMeta: { 'sh-1': { area: 'Main Stage', note: '' } } });
  const twin = mkUnit({ serial: 'TGD62501', klass: 'big', make: 'Technogen', kw: 1000,
    currentHours: 3243,
    engines: { style: 'AB',
      A: { kvaEach: 500, serviceDueHours: 3493, opStatus: 'running' },
      B: { kvaEach: 500, serviceDueHours: 200, opStatus: 'running' } } });
  const cosm = mkUnit({ serial: '28B10705', make: 'MMD', kw: 150 });
  const okA = mkUnit({ serial: 'A25019', kw: 25, photos: [URL1] });
  const okB = mkUnit({ serial: 'B1', opStatus: 'staged' });
  const issues = [
    mkIssue(down.id, { severity: 'down', title: 'Coolant leak', text: 'pouring from weep hole', photos: [URL1, URL1] }),
    mkIssue(down.id, { severity: 'cosmetic', title: 'Door dent', text: 'left door', photos: [URL1] }),
    mkIssue(cosm.id, { severity: 'cosmetic', title: 'Decal peeling', text: '' }),
  ];
  const reports = [
    mkRep(twin.id, { engineHours: 3243 }),                 // untagged -> Gen A: 250 h left, ok
    mkRep(twin.id, { engine: 'B', engineHours: 320 }),     // Gen B: 120 h OVER
  ];
  const R = setup([down, twin, cosm, okA, okB], issues, reports);

  t.group('report: header block for readers who don\'t know the app');
  {
    t.includes(R, 'GENERATOR STATUS REPORT', 'title kept');
    t.includes(R, 'Field status report from the on-site power crew', 'one plain sentence of context leads');
    t.includes(R, 'Job: Bourbon & Beyond — Louisville, KY', 'job name and site on one line');
    t.includes(R, 'Date: ', 'date line');
    t.includes(R, 'Filed by: Andy P.', 'who filed it, by name');
    t.includes(R, 'Units: 5', 'unit count');
    t.includes(R, '\n\n== HARD DOWN', 'blank line separates header from the first section');
  }

  t.group('report: four sections, priority order, real spacing, none vanish');
  {
    const a = R.indexOf('== HARD DOWN (1) ==');
    const b = R.indexOf('== NEEDS / OVER SERVICE (1) ==');
    const c = R.indexOf('== COSMETIC / NON-BLOCKING (2) ==');
    const d = R.indexOf('== RUNNING OK (3) ==');
    t.ok(a >= 0, 'HARD DOWN header with count', R.slice(0, 400));
    t.ok(b > a, 'NEEDS / OVER SERVICE follows HARD DOWN');
    t.ok(c > b, 'COSMETIC / NON-BLOCKING follows NEEDS');
    t.ok(d > c, 'RUNNING OK is last');
    t.includes(R, '\n\n== NEEDS', 'blank line before NEEDS section');
    t.includes(R, '\n\n== COSMETIC', 'blank line before COSMETIC section');
    t.includes(R, '\n\n== RUNNING OK', 'blank line before RUNNING OK section');
    const empty = setup([mkUnit({ serial: 'Z1', kw: 25 })]);
    t.includes(empty, '== HARD DOWN (0) ==', 'empty hard-down section still renders');
    t.includes(sec(empty, 'HARD DOWN', 'NEEDS'), 'none', 'empty section says none, not silence');
    t.includes(empty, '== NEEDS / OVER SERVICE (0) ==', 'empty needs section still renders');
    t.includes(empty, '== COSMETIC / NON-BLOCKING (0) ==', 'empty cosmetic section still renders');
    t.includes(empty, '== RUNNING OK (1) ==', 'ok section renders with count');
  }
  const R2 = setup([down, twin, cosm, okA, okB], issues, reports); // restore standing scenario

  t.group('report: unit line speaks size · job label · serial');
  {
    const hd = sec(R2, 'HARD DOWN', 'NEEDS');
    t.includes(hd, '• 500 kW · Main Stage · #U041866X', 'big single: kW + label + serial, card vocabulary');
    t.includes(hd, 'DOWN', 'status word on the detail line');
    t.includes(hd, '3200 h', 'hours on the detail line');
    t.includes(hd, 'OVER 120 h past service', 'service overrun stated in words');
    const ns = sec(R2, 'NEEDS', 'COSMETIC');
    t.includes(ns, '• Twin 400 kW · #TGD62501', 'twin speaks per-engine kW, no label = no label segment');
    t.includes(ns, 'Gen B OVER 120 h past service', 'twin service call-out names the engine');
    t.excludes(ns, '3243', 'flat currentHours (pre-split seed) never prints on a twin');
    const noRating = setup([mkUnit({ serial: 'X9', make: 'Airman', model: 'SdG1508', opStatus: 'down' })],
      [mkIssue('u-none', { severity: 'down' })]);
    t.includes(noRating, '• Airman SdG1508 · #X9', 'no rating: make/model fallback');
    t.excludes(noRating, 'Asset', 'no "Asset" placeholder ever');
  }
  const R3 = setup([down, twin, cosm, okA, okB], issues, reports);

  t.group('report: cosmetic items never sit inside a hard-down entry');
  {
    const hd = sec(R3, 'HARD DOWN', 'NEEDS');
    t.includes(hd, 'Coolant leak: pouring from weep hole', 'the down issue stays with the down unit');
    t.excludes(hd, 'Door dent', 'the cosmetic issue is OUT of the hard-down entry');
    const cs = sec(R3, 'COSMETIC', 'RUNNING OK');
    t.includes(cs, 'Door dent', 'cosmetic issue lands in the cosmetic section');
    t.includes(cs, '#U041866X', 'under its own unit identity line');
    t.includes(cs, 'Decal peeling', 'cosmetic-only unit\'s item is here too');
    t.includes(cs, '• 150 kVA · #28B10705', 'cosmetic-only unit gets the same identity line format');
    t.excludes(cs, 'DOWN', 'no status words inside the non-blocking section');
  }

  t.group('report: cosmetic-only unit still counts as running');
  {
    const ok = sec(R3, 'RUNNING OK');
    t.includes(ok, '#28B10705', 'cosmetic is non-blocking — the unit runs, so it lists as OK');
    t.includes(ok, '#A25019', 'running unit listed');
    t.includes(ok, '#B1', 'staged unit listed');
    t.excludes(ok, '#U041866X', 'the down unit is not OK');
    t.excludes(ok, '#TGD62501', 'the over-service twin is not OK');
    t.ok(/#A25019, #/.test(ok), 'compact comma-joined list, not one card per line');
  }

  t.group('report: photos are a count on file, never a link');
  {
    t.includes(R3, '(2 photos on file)', 'multi-photo issue says how many');
    const single = sec(R3, 'COSMETIC', 'RUNNING OK');
    t.includes(single, '(1 photo on file)', 'singular reads as English');
    t.excludes(R3, 'http', 'no URL of any kind in the report — the bucket links are permanent and public');
    t.excludes(sec(R3, 'RUNNING OK'), 'photo', 'unit/asset photos are never mentioned');
  }

  t.group('report: share plumbing is Copy + mailto only');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const slice = src.slice(src.indexOf('function buildReportText'), src.indexOf('/* ===== SCAN'));
    t.ok(slice.includes("location.href='mailto:'"), 'Email stays a plain mailto:');
    t.ok(slice.includes('navigator.clipboard.writeText'), 'Copy stays the clipboard');
    t.excludes(slice, 'navigator.share', 'no Web Share in the report flow (killed 2026-09-28)');
    t.excludes(slice, 'text/html', 'no HTML report body (killed 2026-09-28)');
  }

  t.group('report: no job selected still degrades honestly');
  {
    app.setState({ shows: [], units: [], issues: [], reports: [], movements: [] });
    app.S.currentShowId = null;
    t.eq(app.fn.buildReportText(null), 'No job selected.', 'no show: unchanged message');
  }
};
