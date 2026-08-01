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
};
