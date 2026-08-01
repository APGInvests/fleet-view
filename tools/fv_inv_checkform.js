/**
 * fv_inv_checkform.js — standing invariants for the log-check form surface.
 *
 * Fuel pressure (psi) is big-iron only: it's the clogging-filter diagnostic per
 * the CAT XQ-500 data plate ("If changing racor filters does not correct fuel
 * pressure, try changing spin-on filters"). Small iron has no field, and the
 * Recent-checks table only grows the row when a value exists — with the same
 * neutral trend arrows as every other metric.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    opStatus: 'running', locationType: 'show', locationId: 'show-A', photos: [], jobMeta: {}, updatedAt: 1 }, o);

  t.group('check form: fuel psi is big iron only');
  app.setState({ units: [mkUnit({ id: 'u-big', klass: 'big' }), mkUnit({ id: 'u-small', klass: 'small' })],
                 shows: [{ id: 'show-A', name: 'A' }] });
  app.S.settings.techName = 'Mike R.';
  app.fn.logVitals('u-big');
  const bigForm = app.document.querySelector('#sheet').innerHTML;
  t.includes(bigForm, 'Fuel psi', 'big iron form has the field');
  t.includes(bigForm, 'v_fp', 'field wired to v_fp');
  t.excludes(bigForm, 'Stamped with', 'stamped-with copy stays gone');
  t.excludes(bigForm, "Leave blank what you didn", 'leave-blank copy stays gone');
  app.fn.logVitals('u-small');
  const smallForm = app.document.querySelector('#sheet').innerHTML;
  t.excludes(smallForm, 'Fuel psi', 'small iron form unchanged');

  t.group('check form: fuel psi saves and round-trips');
  app.fn.logVitals('u-big');
  app.document.querySelector('#v_fp').value = '101';
  app.document.querySelector('#v_notes').value = '';
  app.fn.saveVitals('u-big');
  const r = app.S.reports.find((x) => x.unitId === 'u-big');
  t.ok(r && r.fuelPsi === 101, 'typed 101 stored as fuelPsi (got ' + (r && r.fuelPsi) + ')');
  const row = app.fn.toRow('reports', r);
  t.eq(row.fuel_psi, 101, 'persists as fuel_psi');
  t.eq(app.fn.fromRow('reports', row).fuelPsi, 101, 'round-trips back');
  app.document.querySelector('#v_fp').value = '';
  app.fn.logVitals('u-small');
  app.fn.saveVitals('u-small');
  const rs = app.S.reports.find((x) => x.unitId === 'u-small');
  t.ok(rs && rs.fuelPsi == null, 'small iron check stores null, never a value');

  t.group('check form: fuel psi in the Recent-checks table, neutral arrows');
  const now = Date.now();
  app.S.reports = [
    { id: 'r1', unitId: 'u-big', techName: 'Mike R.', timestamp: now, fuelPsi: 96 },
    { id: 'r2', unitId: 'u-big', techName: 'Dana', timestamp: now - 3600e3, fuelPsi: 104 },
  ];
  const tbl = app.fn.recentChecksTable(app.fn.reportsFor('u-big'));
  t.includes(tbl, 'Fuel psi', 'row appears when values exist');
  t.includes(tbl, '▼', 'trend arrow rendered (96 vs 104)');
  t.excludes(tbl, 'var(--red)', 'arrow is neutral, not colour-judged');
  app.S.reports.forEach((x) => { delete x.fuelPsi; });
  const tbl2 = app.fn.recentChecksTable(app.fn.reportsFor('u-big'));
  t.excludes(tbl2, 'Fuel psi', 'row absent when no unit ever recorded it');
};
