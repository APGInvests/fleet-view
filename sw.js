/* fleetview service worker — VERSION must be bumped when this file's logic changes.
   KILL=true is the kill switch: deploying that variant makes install skip-wait
   immediately, activate wipe all caches and unregister, and fetch pass through —
   every installed phone recovers within one SW update-check cycle (GitHub Pages
   serves this file with ~10-minute cache headers; browsers re-check on navigation).

   Strategy — do not "improve" these away:
   - Navigations: network-first with a 3.5s timeout, cache fallback. Online users
     always get freshly deployed HTML (the instant-update property survives); the
     cache only serves when the network can't. Cache is keyed by full request URL
     so a sandbox copy under this scope is never served production HTML.
   - Only the five CDN hosts below are cache-first. Backend requests must never be
     intercepted (auth/realtime/PostgREST all break on cached responses); tiles and
     geocoding pass straight through. */
const VERSION = 'fv-sw-1';
const KILL = false;
const SHELL = VERSION + '-shell', CDN = VERSION + '-cdn';
const CDN_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  if (KILL) { self.skipWaiting(); return; }
  e.waitUntil(caches.open(SHELL).then((c) => c.add('./index.html')).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    /* caches.keys() is ORIGIN-scoped, not SW-scope-scoped — and ALL GitHub Pages
       project sites share https://apginvests.github.io, so a drill under another
       path is the SAME origin as production. Both deletion paths filter to our
       'fv-sw-' prefix, and a drill copy must rewrite that prefix (fv-drill-)
       throughout — VERSION and both filters — so its caches can never touch
       ours. Same-origin sharing also applies to localStorage (namespaced in the
       drill build) and, once Phase 3 lands, the IndexedDB database name. */
    if (KILL) {
      const ks = await caches.keys();
      await Promise.all(ks.filter((k) => k.startsWith('fv-sw-')).map((k) => caches.delete(k)));
      await self.registration.unregister();
      return;
    }
    const ks = await caches.keys();
    await Promise.all(ks.filter((k) => k.startsWith('fv-sw-') && k !== SHELL && k !== CDN).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  if (KILL) return;
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') { e.respondWith(netFirst(req)); return; }
  if (CDN_HOSTS.includes(url.hostname)) { e.respondWith(cacheFirst(req)); return; }
  // everything else (backend, nominatim, OSM tiles): straight to network, untouched
});

async function netFirst(req) {
  const c = await caches.open(SHELL);
  try {
    const res = await fetchWithTimeout(req, 3500);
    if (res && res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await c.match(req)) || (await c.match('./index.html'));
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req) {
  const c = await caches.open(CDN);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
  return res;
}
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sw-timeout')), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}
