/**
 * fv_inv_loadpaged.js — paged reads + the rule-12 short-read guard.
 *
 * 2026-09-30 incident: `reports` crossed the server's max-rows cap (1000) and
 * every phone silently "lost" its newest checks — a truncated-but-OK response
 * merged as truth, and mergeServerState dropped every synced local row the
 * response omitted. Contracts pinned here:
 *   1. loadAll pages in PAGE_ROWS chunks with a STABLE order ('id') — unordered
 *      range pagination shifts rows across page boundaries under concurrent
 *      writes (skips), which is the same silent-loss shape.
 *   2. Pages assemble ATOMICALLY per table — any page failure fails the whole
 *      table into the failed-read path (local rows + SNAP kept, nothing drops).
 *   3. A strict shortfall (received < exact count, surviving one full retry)
 *      NEVER merges: it keeps the phone's full copy, parks in SYNC_SHORT, and
 *      lights the chip ("partial server read"). It also must NOT read as
 *      offline — the server answered.
 *   4. received > count is quiet (another phone inserting mid-load is normal).
 *   5. A complete read clears the shortfall state.
 */
'use strict';
module.exports = async (app, t) => {
  const srvUnit = (i) => ({ id: 'u' + String(i).padStart(5, '0'), serial: 'SER' + i });
  const many = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(srvUnit(i)); return a; };
  const rangeCalls = (tb) => app.supabaseCalls.filter((c) => c.table === tb && c.op === 'range');
  const reset = () => {
    app.opts.tableData = null; app.opts.tableCount = null;
    app.opts.pageError = null; app.opts.readError = null;
    app.live.SYNC_SHORT = {}; app.live.SYNC_FAILS = {}; app.live.NET_DOWN = false;
  };

  t.group('load-paged: multi-page reassembly merges identically to a single read');
  {
    reset();
    app.setState({ units: [], shows: [], shops: [], reports: [], issues: [], movements: [] });
    app.opts.tableData = { units: many(2345) };
    app.supabaseCalls.length = 0;
    await app.fn.loadAll();
    t.eq(app.S.units.length, 2345, 'all three pages landed (2345 rows)');
    t.ok(app.S.units.some((u) => u.id === 'u00000') && app.S.units.some((u) => u.id === 'u02344'),
      'first and last rows both present — no page-boundary loss');
    const rc = rangeCalls('units');
    t.eq(rc.length, 3, 'exactly three page requests for 2345 rows');
    t.deep(rc.map((c) => c.payload.lo), [0, 1000, 2000], 'page windows advance by PAGE_ROWS');
    t.ok(app.supabaseCalls.some((c) => c.table === 'units' && c.op === 'order' && c.payload === 'id'),
      "pagination is ordered by 'id' — unordered range paging loses rows under concurrent writes");
    t.eq(Object.keys(app.live.SYNC_SHORT).length, 0, 'complete read: no shortfall state');
  }

  t.group('load-paged: a mid-loop page failure is a FAILED READ — local rows + SNAP intact');
  {
    reset();
    app.setState({ units: [{ id: 'u-keep', serial: 'KEEP1', updatedAt: 5 }], shows: [], shops: [], reports: [], issues: [], movements: [] });
    app.fn.snapshot();                                   /* the local row is clean/synced */
    const snapBefore = String(app.live.SNAP.units['u-keep']);
    app.opts.tableData = { units: many(1500) };          /* page 1 full, then... */
    app.opts.pageError = (tb, lo) => (tb === 'units' && lo === 1000 ? { message: 'network died mid-loop' } : null);
    await app.fn.loadAll();
    t.eq(app.S.units.length, 1, 'partial pages did NOT merge — that would recreate the bug being fixed');
    t.eq(app.S.units[0].id, 'u-keep', 'the synced local row survived');
    t.eq(String(app.live.SNAP.units['u-keep']), snapBefore, 'SNAP untouched — a failed read never launders');
    t.eq(Object.keys(app.live.SYNC_SHORT).length, 0, 'an ERROR is not a shortfall (offline stays offline-shaped)');
    t.ok(!app.live.NET_DOWN, 'one failed table of six is not NET_DOWN');
  }

  t.group('load-paged: strict shortfall (server truncation) keeps the full local copy and lights the chip');
  {
    reset();
    app.setState({ units: [{ id: 'u-keep2', serial: 'KEEP2', updatedAt: 5 }], shows: [], shops: [], reports: [], issues: [], movements: [] });
    app.fn.snapshot();
    const snapBefore = String(app.live.SNAP.units['u-keep2']);
    app.opts.tableData = { units: many(1000) };          /* server holds 1043 but returns 1000 */
    app.opts.tableCount = (tb, n) => (tb === 'units' ? 1043 : n);
    app.supabaseCalls.length = 0;
    app.live.DEAD = {}; app.live.SYNC_LOST = []; app.live.CACHE_BROKEN = false;
    await app.fn.loadAll();
    t.eq(app.S.units.length, 1, 'truncated response did not merge — phone keeps its full copy');
    t.eq(String(app.live.SNAP.units['u-keep2']), snapBefore, 'SNAP untouched on shortfall');
    const sh = app.live.SYNC_SHORT.units;
    t.ok(sh && sh.got === 1000 && sh.total === 1043, 'shortfall parked with N-of-M (' + JSON.stringify(sh) + ')');
    t.eq(rangeCalls('units').filter((c) => c.payload.lo === 0).length, 2,
      'exactly one immediate full-table retry before calling it truncation (count races are normal)');
    t.ok(!app.live.NET_DOWN, 'truncation must NOT read as offline — the server answered');
    app.fn.updateSyncChip();
    t.includes(app.document.querySelector('#syncChip').textContent, 'partial server read',
      'chip: partial server read · showing saved copy');
    app.fn.openSyncStatus();
    t.includes(String(app.document.querySelector('#sheet').innerHTML),
      'Server returned 1000 of 1043 rows for units', 'status sheet explains N of M');
  }

  t.group('load-paged: received > count is quiet (mid-load inserts are normal)');
  {
    reset();
    app.setState({ units: [], shows: [], shops: [], reports: [], issues: [], movements: [] });
    app.opts.tableData = { units: many(1005) };
    app.opts.tableCount = (tb, n) => (tb === 'units' ? 990 : n);   /* count taken before the inserts */
    await app.fn.loadAll();
    t.eq(app.S.units.length, 1005, 'over-count read merges normally');
    t.eq(Object.keys(app.live.SYNC_SHORT).length, 0, 'no false alarm');
  }

  t.group('load-paged: the first complete read clears the shortfall state');
  {
    reset();
    app.live.SYNC_SHORT = { units: { got: 1000, total: 1043, ts: 1 } };
    app.setState({ units: [], shows: [], shops: [], reports: [], issues: [], movements: [] });
    app.opts.tableData = { units: many(1043) };
    await app.fn.loadAll();
    t.eq(app.S.units.length, 1043, 'recovered read merges in full');
    t.eq(Object.keys(app.live.SYNC_SHORT).length, 0, 'shortfall state self-cleared');
    app.live.DEAD = {}; app.live.SYNC_LOST = []; app.live.SYNC_FAILS = {}; app.live.CACHE_BROKEN = false;
    app.fn.updateSyncChip();
    t.eq(app.document.querySelector('#syncChip').style.display, 'none', 'chip goes quiet after recovery');
  }

  t.group('load-paged: offline behavior byte-identical (errors on every table = NET_DOWN, nothing dropped)');
  {
    reset();
    app.setState({ units: [{ id: 'u-off', serial: 'OFF1', updatedAt: 5 }], shows: [], shops: [], reports: [], issues: [], movements: [] });
    app.fn.snapshot();
    app.opts.readError = () => ({ message: 'TypeError: Failed to fetch' });
    await app.fn.loadAll();
    t.ok(app.live.NET_DOWN, 'all tables failing reads as offline, exactly as before load-paged');
    t.eq(app.S.units.length, 1, 'local data kept offline');
    t.ok(app.live.SNAP.units['u-off'], 'SNAP kept offline');
    t.eq(Object.keys(app.live.SYNC_SHORT).length, 0, 'dead zone can never produce a "shortfall" — errors only');
    reset();
  }
};
