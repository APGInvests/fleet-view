/**
 * fv_inv_moveids.js — empty string is never a UUID (the U041866X incident).
 *
 * 2026-09-21: "Back to fleet (unassign)" passed '' as the destination id;
 * doMove wrote locationId:'' on the unit and toId:'' on the movement, and
 * Postgres refused both ("invalid input syntax for type uuid") — two rows
 * parked in DEAD. Contracts: (1) the move handlers normalize '' -> null at
 * the source, (2) toRow coerces '' -> null on every uuid-mapped column as
 * the data-layer guarantee — which is also the HEAL path: retryDead re-diffs
 * from live state through toRow, so parked rows recover with one Retry after
 * this fix. Non-uuid text fields keep '' untouched.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    make: 'CAT', model: 'XQ-500', kw: 625, opStatus: 'staged',
    locationType: 'show', locationId: 'show-A', photos: [], jobMeta: {}, updatedAt: 1 }, o);

  t.group('move ids: unassign-to-fleet writes null, never empty string');
  {
    const u = mkUnit({ id: 'u-mv-1' });
    app.setState({ units: [u], shows: [{ id: 'show-A', name: 'A' }], movements: [] });
    app.S.settings.techName = 'Mike R.';
    app.fn.doMove('u-mv-1', 'fleet', '');
    t.eq(u.locationType, 'fleet', 'unit went back to fleet');
    t.eq(u.locationId, null, 'locationId is NULL — not the empty string that poisoned the queue');
    const mv = app.S.movements.find((m) => m.unitId === 'u-mv-1');
    t.ok(mv, 'the move was logged');
    t.eq(mv.toId, null, 'movement toId is null');
    t.eq(app.fn.toRow('units', u).location_id, null, 'serialized unit carries location_id null');
    t.eq(app.fn.toRow('movements', mv).to_id, null, 'serialized movement carries to_id null');
  }

  t.group('move ids: scan-path unassign coerces the same way');
  {
    const u = mkUnit({ id: 'u-mv-2' });
    app.setState({ units: [u], shows: [{ id: 'show-A', name: 'A' }], movements: [] });
    app.S.settings.techName = 'Mike R.';
    app.fn.doMoveScan('u-mv-2', 'fleet', '');
    t.eq(u.locationId, null, 'doMoveScan: locationId null');
    const mv = app.S.movements.find((m) => m.unitId === 'u-mv-2');
    t.eq(mv && mv.toId, null, 'doMoveScan: movement toId null');
  }

  t.group('move ids: a unit already poisoned with "" heals through toRow');
  {
    // The field incident, exactly: locationId '' on the unit, toId '' on the
    // movement, both still in S. Retry un-parks and re-diffs from live state —
    // toRow is the choke point that must emit null.
    const u = mkUnit({ id: 'u-mv-3', locationType: 'fleet', locationId: '', inTransitToShowId: '' });
    const mv = { id: id('mv'), unitId: 'u-mv-3', fromType: 'show', fromId: '', toType: 'fleet', toId: '',
      techName: 'Mike R.', timestamp: 1758400000000, gps: null, photos: null, kind: null };
    t.eq(app.fn.toRow('units', u).location_id, null, 'units.location_id: "" -> null');
    t.eq(app.fn.toRow('units', u).in_transit_to_show_id, null, 'units.in_transit_to_show_id: "" -> null');
    t.eq(app.fn.toRow('movements', mv).from_id, null, 'movements.from_id: "" -> null');
    t.eq(app.fn.toRow('movements', mv).to_id, null, 'movements.to_id: "" -> null');
    t.eq(app.fn.toRow('reports', { id: 'r1', unitId: '', showId: '', timestamp: 1758400000000 }).unit_id, null, 'reports.unit_id: "" -> null');
    t.eq(app.fn.toRow('issues', { id: 'i1', unitId: '', showId: '', fromReportId: '', timestamp: 1758400000000 }).from_report_id, null, 'issues.from_report_id: "" -> null');
  }

  t.group('move ids: coercion is uuid-only — text fields keep their empty strings');
  {
    const u = mkUnit({ id: 'u-mv-4', tagId: '', notes: '', model: '' });
    const r = app.fn.toRow('units', u);
    t.eq(r.tag_id, '', 'tag_id stays "" (text, not uuid)');
    t.eq(r.notes, '', 'notes stays ""');
    t.eq(r.model, '', 'model stays ""');
  }

  t.group('move ids: real destinations pass through untouched');
  {
    const u = mkUnit({ id: 'u-mv-5', locationType: 'fleet', locationId: null });
    app.setState({ units: [u], shows: [{ id: 'show-A', name: 'A' }], movements: [] });
    app.S.settings.techName = 'Mike R.';
    app.fn.doMove('u-mv-5', 'show', 'show-A');
    t.eq(u.locationId, 'show-A', 'a real show id is preserved');
    const mv = app.S.movements.find((m) => m.unitId === 'u-mv-5');
    t.eq(mv && mv.toId, 'show-A', 'movement carries the real id');
    t.eq(mv && mv.fromId, null, 'fromId from a null-location unit stays null');
    t.eq(app.fn.toRow('movements', mv).to_id, 'show-A', 'serialization preserves real uuids');
  }
};
