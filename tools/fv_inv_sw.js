/**
 * fv_inv_sw.js — standing invariants for the service worker.
 *
 * The harness has no SW runtime, so these are structural: they pin the
 * safety-critical shape (kill switch, skip-waiting, no Supabase interception,
 * sandbox-scopable registration) so a refactor can't silently drop the parts
 * that make a bad SW recoverable. Behavior is verified on-device per the
 * Task 2.4 sandbox drill in docs/plans/2026-07-29-offline-write-path.md.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = (app, t) => {
  t.group('service worker: structure');
  const swPath = path.join(path.dirname(app.file), 'sw.js');
  t.ok(fs.existsSync(swPath), 'sw.js exists next to index.html');
  const src = fs.existsSync(swPath) ? fs.readFileSync(swPath, 'utf8') : '';
  t.noThrow(() => new vm.Script(src), 'sw.js parses');
  t.includes(src, 'const KILL', 'kill switch constant present');
  t.includes(src, 'registration.unregister', 'kill path unregisters');
  t.includes(src, 'caches.delete', 'kill path clears caches');
  t.includes(src, "startsWith('fv-sw-')", 'cache deletion scoped to our prefix (Cache Storage is origin-scoped)');
  t.includes(src, 'SKIP_WAITING', 'skip-waiting message handler present');
  t.includes(src, "req.mode === 'navigate'", 'navigations handled');
  t.excludes(src, 'supabase', 'SW never touches Supabase requests');
  t.includes(src, 'fetchWithTimeout', 'network-first has a timeout (offline fallback path)');

  t.group('service worker: tile servers never enter the cache — guard the guard');
  // The requirement is not "tiles are uncached today" (they fall through anyway);
  // it is that a future contributor cannot quietly add tile hosts to the cache.
  // Both assertions fail loudly if someone removes the guard or grows CDN_HOSTS.
  t.includes(src, "url.hostname === 'basemap.nationalmap.gov'", 'explicit early return for USGS tiles present');
  t.includes(src, "tile.openstreetmap.org", 'OSM tiles covered by the same guard');
  t.includes(src, 'TILE SERVERS NEVER ENTER THE SERVICE WORKER CACHE', 'reasoning stated in the code, not just HANDOFF');
  const cdnLine = (src.match(/CDN_HOSTS\s*=\s*\[[^\]]*\]/) || [''])[0];
  t.excludes(cdnLine, 'nationalmap', 'CDN_HOSTS does not contain the USGS host');
  t.excludes(cdnLine, 'openstreetmap', 'CDN_HOSTS does not contain OSM');

  t.group('service worker: app registration');
  t.includes(app.code, "serviceWorker.register('sw.js')", 'relative registration (sandbox-scopable)');
  t.includes(app.code, 'controllerchange', 'reload-on-takeover wired');
  t.includes(app.code, 'updateBar', 'update prompt UI present');
  t.ok(typeof app.fn.applySwUpdate === 'function', 'applySwUpdate exists');
  t.ok(typeof app.fn.initSW === 'function', 'initSW exists');
};
