/**
 * fv_inv_basemap.js — standing invariants for the satellite basemap toggle.
 *
 * USGS Imagery Only (public domain, keyless — settled choice; empirical cache
 * ceiling z16, probed 2026-08-01). One shared constructor (makeMap) owns both
 * layers, per-layer attribution, maxNativeZoom, and the persistence hook —
 * preference is per-device in S.settings.basemap, same pattern as theme:
 * missing/corrupt falls back to Street without throwing.
 */
'use strict';
module.exports = async (app, t) => {
  t.group('basemap: one constructor, every map instance');
  const mapCalls = (app.code.match(/L\.map\(/g) || []).length;
  t.eq(mapCalls, 1, 'exactly one L.map call — all instances go through makeMap (found ' + mapCalls + ')');
  const mk = (app.code.match(/makeMap\(/g) || []).length;
  t.ok(mk >= 4, 'makeMap used by all three map sites (definition + 3 calls, found ' + mk + ')');
  t.eq((app.code.match(/tile\.openstreetmap\.org/g) || []).length, 1, 'street tile config exists once, not three times');

  t.group('basemap: layers, attribution, zoom ceiling');
  t.includes(app.code, 'USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', 'USGS Imagery Only is the satellite source');
  t.includes(app.code, 'maxNativeZoom:16', 'satellite upscales past the empirical z16 cache ceiling instead of blanking');
  t.includes(app.code, "attribution:'U.S. Geological Survey'", 'USGS attribution on the satellite layer');
  t.includes(app.code, 'OpenStreetMap contributors', 'OSM attribution on the street layer (the long-owed credit)');
  t.excludes(app.code, 'attributionControl:false', 'attribution is no longer suppressed anywhere');
  t.includes(app.code, "maxZoom:19,maxNativeZoom:16", 'satellite maxZoom NOT lowered — upscale, not cap');
  t.ok(!/L\.tileLayer\([^)]*openstreetmap[^)]*\)(?![^]*maxZoom)/.test(''), 'street keeps depth (structural, see maxZoom:19 above)');

  t.group('basemap: preference — device-local, theme-pattern, safe fallback');
  app.setState({});
  t.eq(app.fn.basemapPref(), 'street', 'missing key defaults to Street');
  app.S.settings.basemap = 'satellite';
  t.eq(app.fn.basemapPref(), 'satellite', 'satellite honored');
  app.S.settings.basemap = 'garbage-value';
  t.eq(app.fn.basemapPref(), 'street', 'corrupt value falls back to Street without throwing');
  app.S.settings.basemap = 'satellite';
  app.fn.save();
  t.includes(String(app.localStorage.getItem('fleetview_settings_v1')), '"basemap":"satellite"',
    'persists in the same localStorage settings blob as theme — no Supabase round trip');
  app.localStorage.setItem('fleetview_settings_v1', '{not json');
  t.ok((() => { try { app.fn.loadSettings(); return true; } catch (e) { return false; } })(), 'unreadable settings blob does not throw');
  app.localStorage.setItem('fleetview_settings_v1', '{}');

  t.group('basemap: constructor is safe headless and hooks persistence');
  t.noThrow(() => app.fn.makeMap(app.document.createElement('div')), 'makeMap runs against the harness Leaflet stub');
  t.includes(app.code, "baselayerchange", 'layer switch persists the preference');
  t.includes(app.code, "{'Street':street,'Satellite':sat}", 'built-in L.control.layers, no new plugin');

  t.group('basemap: two-background marker legibility (task 5 styles present)');
  t.includes(app.code, 'spiderLegPolylineOptions', 'spiderfy legs styled, not plugin default');
  t.includes(app.code, "className:'spiderleg'", 'legs carry the halo class');
  t.includes(app.html, '.spiderleg{filter:drop-shadow', 'leg halo CSS present');
  t.includes(app.html, '.marker-cluster-small div,.marker-cluster-medium div,.marker-cluster-large div{background:rgba(25,23,20,.92)',
    'cluster bubbles opaque — no imagery bleeding through the count');
  t.includes(app.html, '.vmark{filter:drop-shadow', 'venue-picker circle halo present');
  const halos = (app.code.match(/box-shadow:0 0 0 2px rgba\(0,0,0,\.5?[56]?\d*\)/g) || []).length;
  t.ok(halos >= 3, 'unit pins, venue marker and placement pin all carry the dual halo (found ' + halos + ')');
  t.includes(app.code, 'width:20px;height:20px;border-radius:50%;background:#c77455;border:3px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.6)',
    'the draggable placement pin — the reason for the feature — has the strongest halo');

  t.group('naip: overlay, not handoff — base pair untouched');
  // NAIP Plus is a live dynamic render (shared government compute, no CDN, no
  // SLA). It rides ON TOP of the cached z16 imagery so its failure mode is a
  // visual degrade (upscaled z16), never a blank pane. These pin that shape.
  t.includes(app.code, 'maxZoom:19,maxNativeZoom:16', 'base satellite keeps its z16 ceiling — the fallback NAIP degrades onto');
  t.includes(app.code, "{'Street':street,'Satellite':sat}", 'toggle stays two entries — NAIP is an implementation detail of Satellite');
  t.excludes(app.code, "'NAIP'", 'no third user-visible layer label anywhere');
  t.includes(app.code, 'minZoom:17', 'NAIP tiles exist only at z17+ — below that, only the base pair renders');
  t.includes(app.code, 'naip.addTo(m)', 'overlay joins the map when Satellite is active');
  t.includes(app.code, 'm.removeLayer(naip)', 'overlay leaves the map when Street returns');

  t.group('naip: tile → exportImage translation (real math, no plugin)');
  t.ok(typeof app.fn.naipTileUrl === 'function', 'naipTileUrl is a standalone testable function');
  const u1 = String(app.fn.naipTileUrl({ x: 65536, y: 65535, z: 17 }));
  t.includes(u1, 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage',
    'NAIP Plus exportImage is the source — keyless, no esri-leaflet, no WMS plugin');
  t.includes(u1, 'bboxSR=3857', 'bbox is web mercator');
  t.includes(u1, 'imageSR=3857', 'render requested in web mercator');
  t.includes(u1, 'size=256,256', 'one render request = one 256px tile');
  t.includes(u1, 'f=image', 'raw image response, not JSON');
  const bbOf = (u) => ((String(u).match(/bbox=([-\d.,]+)/) || [])[1] || '').split(',').map(Number);
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const b1 = bbOf(u1);
  t.ok(near(b1[0], 0, 1e-6) && near(b1[1], 0, 1e-6),
    'tile (65536,65535,17) has its SW corner exactly at the mercator origin');
  t.ok(near(b1[2], 305.748113140705, 1e-3) && near(b1[3], 305.748113140705, 1e-3),
    'tile spans one z17 step (305.748 m) in both axes');
  const b0 = bbOf(app.fn.naipTileUrl({ x: 0, y: 0, z: 17 }));
  t.ok(near(b0[0], -20037508.342789244, 1e-3) && near(b0[3], 20037508.342789244, 1e-3),
    'tile (0,0) pins the NW corner of the mercator world');
  const b18 = bbOf(app.fn.naipTileUrl({ x: 131072, y: 131071, z: 18 }));
  t.ok(near(b18[2], 152.8740565703525, 1e-3), 'z18 tiles span half a z17 step — zoom scales the bbox');

  t.group('naip: failure degrades to base imagery, never to blank');
  t.ok(typeof app.fn.naipTileTimeout === 'function', 'per-tile timeout handler is a testable function');
  const hung = { complete: false, naturalWidth: 0, src: 'https://imagery.nationalmap.gov/hung', addEventListener() {} };
  app.fn.naipTileTimeout({ tile: hung });
  app.flushTimers();
  t.ok(String(hung.src).startsWith('data:image/gif'),
    'a hung render is replaced by a transparent pixel — the z16 base shows through');
  const painted = { complete: true, naturalWidth: 256, src: 'https://imagery.nationalmap.gov/ok', addEventListener() {} };
  app.fn.naipTileTimeout({ tile: painted });
  app.flushTimers();
  t.eq(painted.src, 'https://imagery.nationalmap.gov/ok', 'a tile that painted in time is left alone');
  t.includes(app.code, 'tileloadstart', 'timeout armed per tile, from the tile lifecycle event');
  t.excludes(app.code, 'errorTileUrl', 'tile errors stay transparent (Leaflet default) — no error imagery over the base');
};
