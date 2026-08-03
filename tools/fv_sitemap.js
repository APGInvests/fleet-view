#!/usr/bin/env node
/**
 * fv_sitemap.js — render a show archive's site map (site-map.pdf + page PNGs):
 * one overview page + four
 *
 * The artifact a 2027 reader actually opens: every unit's placement drawn on
 * embedded USGS NAIP satellite imagery. Pin labels are PLACEMENT TEXT + kVA
 * only — never serials (they change year to year), never coordinates (useless
 * after load-out). "Perrys stage — 4× 625 kVA" is the planning unit.
 *
 * Design decisions (settled 2026-08-02, do not re-litigate):
 * - Grouping is placement-text FIRST, proximity second. The Lolla boneyard
 *   proved proximity-only lies: "Swamp" sits inside the "Back up" pile — same
 *   geography, different meaning (deployed power vs staged spares).
 * - Quadrants come from a KD median split (long axis, then each half's longer
 *   axis) — deterministic, balanced, frames actual iron; a fixed 2×2 of a
 *   tall-narrow site wastes pages on empty park.
 * - Imagery is EMBEDDED at render time (exportImage, format=jpg): an archive
 *   that needs a live tile server in 2029 is not an archive. NAIP is a live
 *   render with no SLA -> retry ×3, fall back to stitching z16 USGSImageryOnly
 *   tiles, and if both fail the run fails LOUDLY. Never a silently blank page.
 * - Units with no GPS pin are listed in the overview sidebar, never dropped.
 *   Units whose stored location disagrees with their movement log (the
 *   gap-audit condition) render as hollow dashed pins.
 *
 * Dependencies: pdfkit + sharp, devDependencies of tools/ ONLY. The app's
 * no-dependency rule protects index.html and the deploy — not this tool.
 * Install with:  cd tools && npm install
 *
 * Usage:
 *   node tools/fv_sitemap.js <archiveDir>     (reads frozen data/, needs network for imagery)
 *   node tools/fv_sitemap.js --selftest       (offline; pure logic only)
 * Also called by fv_archive.js after a live pull.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage';
const Z16 = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile';
const ACCENT = '#c77455', INK = '#191714', WHITE = '#ffffff';
const PAGE_W = 612, PAGE_H = 792, M = 36;          // letter portrait, 72pt/in
const IMG_SCALE = 3;                                // imagery px per page pt
const GROUP_RADIUS_M = 40;                          // same-text units within this merge
const LOOSE_RADIUS_M = 20;                          // no-text proximity clusters
const PAD_M = 40;                                   // bbox pad around each page's iron

/* ---------------------------------------------------------------- projection */
const RM = 20037508.342789244;
function toMerc(lat, lng) {
  return { x: lng * RM / 180, y: Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * RM / 180 };
}

/* ---------------------------------------------------------------- pure logic */

function kvaOfUnit(u) {
  if (!u) return 0;
  if (u.engines && typeof u.engines === 'object') {
    let t = 0;
    for (const e of ['A', 'B']) {
      const m = u.engines[e];
      if (m && typeof m === 'object' && !m.off && m.kvaEach) t += Number(m.kvaEach) || 0;
    }
    if (t) return t;
  }
  return Number(u.kw) || 0;
}

function placementText(u, showId) {
  const jm = (u.job_meta && typeof u.job_meta === 'object' && u.job_meta[showId]) || {};
  const t = String(jm.area || jm.name || '').replace(/\s+/g, ' ').trim();
  return t || null;
}

/* "4× 625 kVA" / "3× 35 + 1× 15 kVA" — count-descending then size-descending */
function kvaBreakdown(kvas) {
  const counts = new Map();
  for (const k of kvas) { const key = Math.round(k * 10) / 10; counts.set(key, (counts.get(key) || 0) + 1); }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .map(([k, n]) => `${n}× ${k % 1 ? k : Math.round(k)}`);
  return parts.join(' + ') + ' kVA';
}

/* Latest on-show GPS per unit: last non-photo movement to/at this show that
 * carries gps. A photo row mirrors location and is never an observation. */
function unitPins(units, movements, showId) {
  const pins = new Map();
  const lastMove = new Map();
  const sorted = [...movements].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  for (const m of sorted) {
    if (m.kind === 'photo') continue;
    lastMove.set(m.unit_id, m);
    if (m.to_id === showId && m.gps && m.gps.lat != null) pins.set(m.unit_id, m.gps);
  }
  const out = [];
  for (const u of units) {
    const g = pins.get(u.id) || null;
    const lm = lastMove.get(u.id) || null;
    // gap-audit condition: unit says it's on the show but its movement log doesn't
    const suspect = !!(u.location_type === 'show' && u.location_id === showId && lm && lm.to_id !== showId);
    out.push({ u, gps: g, suspect, kva: kvaOfUnit(u) });
  }
  return out;
}

/* Placement-text first, proximity second. */
function buildGroups(pinned, showId) {
  const byText = new Map();
  const loose = [];
  for (const p of pinned) {
    const t = placementText(p.u, showId);
    if (t) {
      const key = t.toLowerCase();
      if (!byText.has(key)) byText.set(key, { label: t, members: [] });
      byText.get(key).members.push(p);
    } else loose.push(p);
  }
  const groups = [];
  const dist = (a, b) => Math.hypot(a.mx - b.cx, a.my - b.cy);
  const clusterInto = (members, label, radius) => {
    const cls = [];
    for (const p of members) {
      let c = cls.find((c) => dist(p, c) <= radius);
      if (!c) { c = { label, members: [], cx: p.mx, cy: p.my }; cls.push(c); }
      c.members.push(p);
      c.cx = c.members.reduce((s, m) => s + m.mx, 0) / c.members.length;
      c.cy = c.members.reduce((s, m) => s + m.my, 0) / c.members.length;
    }
    return cls;
  };
  for (const { label, members } of byText.values()) groups.push(...clusterInto(members, label, GROUP_RADIUS_M));
  groups.push(...clusterInto(loose, null, LOOSE_RADIUS_M));
  for (const g of groups) {
    g.totalKva = g.members.reduce((s, m) => s + m.kva, 0);
    g.suspect = g.members.every((m) => m.suspect);
    g.kvaLabel = kvaBreakdown(g.members.map((m) => m.kva));
  }
  return groups.sort((a, b) => b.totalKva - a.totalKva);
}

/* KD median split of positions: long axis first, then each half's longer axis. */
function kdSplit(pts) {
  if (!pts.length) return [[], [], [], []];
  const span = (a, k) => Math.max(...a.map((p) => p[k])) - Math.min(...a.map((p) => p[k]));
  /* index-median: sort along the longer axis and cut at the halfway index —
   * balanced by construction even with tied coordinates, and deterministic */
  const splitBy = (a) => {
    const k = span(a, 'my') >= span(a, 'mx') ? 'my' : 'mx';
    const s = [...a].sort((p, q) => p[k] - q[k]);
    const h = Math.ceil(s.length / 2);
    return [s.slice(0, h), s.slice(h)];
  };
  const [h1, h2] = splitBy(pts);
  const [q1, q2] = h1.length > 1 ? splitBy(h1) : [h1, []];
  const [q3, q4] = h2.length > 1 ? splitBy(h2) : [h2, []];
  return [q1, q2, q3, q4];
}

function bboxOf(pts, padM) {
  const xs = pts.map((p) => p.mx), ys = pts.map((p) => p.my);
  return { x0: Math.min(...xs) - padM, y0: Math.min(...ys) - padM, x1: Math.max(...xs) + padM, y1: Math.max(...ys) + padM };
}
/* expand bbox (meters, mercator) to the aspect of the target area (pt) */
function fitAspect(b, w, h) {
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0, target = w / h;
  if (bw / bh < target) { const add = (bh * target - bw) / 2; return { x0: b.x0 - add, x1: b.x1 + add, y0: b.y0, y1: b.y1 }; }
  const add = (bw / target - bh) / 2;
  return { x0: b.x0, x1: b.x1, y0: b.y0 - add, y1: b.y1 + add };
}
function niceScale(mPerPt, maxPt) {
  for (const m of [5000, 2000, 1000, 500, 250, 200, 100, 50, 25, 10]) if (m / mPerPt <= maxPt) return m;
  return 10;
}

/* ------------------------------------------------------------- label placing */

function estWidth(str, size, bold) { return String(str).length * size * (bold ? 0.58 : 0.52) + 4; }

function makeGrid(x0, y0, x1, y1, cell = 4) {
  const w = Math.ceil((x1 - x0) / cell), h = Math.ceil((y1 - y0) / cell);
  const busy = new Uint8Array(w * h);
  const idx = (x, y) => {
    const cx = Math.floor((x - x0) / cell), cy = Math.floor((y - y0) / cell);
    return (cx < 0 || cy < 0 || cx >= w || cy >= h) ? -1 : cy * w + cx;
  };
  /* sampling is INCLUSIVE of the far edge — an exclusive loop skips the last
   * partial cell, which is how a pin ended up drawn through "Jackson boneyard" */
  return {
    block(r) { for (let x = r.x; x <= r.x + r.w; x += cell) for (let y = r.y; y <= r.y + r.h; y += cell) { const i = idx(x, y); if (i >= 0) busy[i] = 1; } },
    free(r) {
      if (r.x < x0 || r.y < y0 || r.x + r.w > x1 || r.y + r.h > y1) return false;
      for (let x = r.x; x <= r.x + r.w; x += cell) for (let y = r.y; y <= r.y + r.h; y += cell) { const i = idx(x, y); if (i < 0 || busy[i]) return false; }
      return true;
    },
  };
}

function placeLabel(grid, mx, my, r, w, h) {
  const cands = [];
  for (const d of [4, 12, 22]) {
    cands.push({ x: mx + r + d, y: my - h / 2 }, { x: mx - r - d - w, y: my - h / 2 },
      { x: mx - w / 2, y: my - r - d - h }, { x: mx - w / 2, y: my + r + d },
      { x: mx + r + d, y: my - r - d - h }, { x: mx - r - d - w, y: my - r - d - h },
      { x: mx + r + d, y: my + r + d }, { x: mx - r - d - w, y: my + r + d });
  }
  for (const c of cands) {
    const rect = { x: c.x, y: c.y, w, h };
    if (grid.free(rect)) { grid.block(rect); return rect; }
  }
  return null;
}

/* ---------------------------------------------------------------- imagery */

async function fetchJpeg(url, tries = 3) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get('content-type') || '';
        if (buf.length > 5000 && ct.startsWith('image/')) return buf;
        last = new Error(`bad image response (${ct}, ${buf.length} bytes)`);
      } else last = new Error(`HTTP ${res.status}`);
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw last || new Error('fetch failed');
}

async function naipImage(b, wPx, hPx) {
  const f = (v) => v.toFixed(3);
  return fetchJpeg(`${NAIP}?bbox=${f(b.x0)},${f(b.y0)},${f(b.x1)},${f(b.y1)}&bboxSR=3857&imageSR=3857&size=${wPx},${hPx}&format=jpg&f=image`);
}

/* Fallback: stitch z16 USGSImageryOnly tiles (the app's own base layer). */
async function stitchZ16(b, wPx, hPx, sharp) {
  const z = 16, world = 2 * RM, tileSpan = world / Math.pow(2, z);
  const tx0 = Math.floor((b.x0 + RM) / tileSpan), tx1 = Math.floor((b.x1 + RM) / tileSpan);
  const ty0 = Math.floor((RM - b.y1) / tileSpan), ty1 = Math.floor((RM - b.y0) / tileSpan);
  const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;
  if (cols * rows > 120) throw new Error(`z16 fallback would need ${cols * rows} tiles — bbox too large`);
  const comps = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const buf = await fetchJpeg(`${Z16}/${z}/${ty}/${tx}`, 2);
    comps.push({ input: buf, left: (tx - tx0) * 256, top: (ty - ty0) * 256 });
  }
  const mosaic = await sharp({ create: { width: cols * 256, height: rows * 256, channels: 3, background: '#222' } })
    .composite(comps).jpeg().toBuffer();
  // crop the bbox out of the mosaic, then resize to requested px
  const pxPerM = 256 / tileSpan;
  const left = Math.round((b.x0 - (tx0 * tileSpan - RM)) * pxPerM);
  const top = Math.round(((RM - ty0 * tileSpan) - b.y1) * pxPerM);
  return sharp(mosaic).extract({
    left: Math.max(0, left), top: Math.max(0, top),
    width: Math.min(cols * 256 - Math.max(0, left), Math.round((b.x1 - b.x0) * pxPerM)),
    height: Math.min(rows * 256 - Math.max(0, top), Math.round((b.y1 - b.y0) * pxPerM)),
  }).resize(wPx, hPx).jpeg({ quality: 82 }).toBuffer();
}

/* ---------------------------------------------------------------- page model */

function textPrim(x, y, str, size, opts = {}) {
  return Object.assign({ type: 'text', x, y, str: String(str), size }, opts); // y = TOP of line
}

/* Build one map page: header, imagery, pins, labels, frames, footer. */
function buildPage(title, sub, show, groups, box, jpeg, area, opts = {}) {
  const prims = [];
  const { x: AX, y: AY, w: AW, h: AH } = area;
  const mPerPtX = (box.x1 - box.x0) / AW;
  const px = (mx) => AX + (mx - box.x0) / (box.x1 - box.x0) * AW;
  const py = (my) => AY + (box.y1 - my) / (box.y1 - box.y0) * AH;

  // header
  prims.push(textPrim(M, 28, show.name, 16, { bold: true, color: INK }));
  if (show.ces_job_number) prims.push(textPrim(M + estWidth(show.name, 16, true) + 6, 33, '#' + show.ces_job_number, 10, { color: '#777' }));
  prims.push(textPrim(M, 48, title, 11, { bold: true, color: ACCENT }));
  if (sub) prims.push(textPrim(M + estWidth(title, 11, true) + 8, 49, sub, 9, { color: '#777' }));

  // imagery + border
  prims.push({ type: 'image', x: AX, y: AY, w: AW, h: AH, jpeg });
  prims.push({ type: 'rect', x: AX, y: AY, w: AW, h: AH, stroke: INK, width: 1 });

  const grid = makeGrid(AX + 2, AY + 2, AX + AW - 2, AY + AH - 2);
  const inBox = (g) => g.cx >= box.x0 && g.cx <= box.x1 && g.cy >= box.y0 && g.cy <= box.y1;
  const drawn = groups.filter(inBox);

  /* quadrant frames (overview only) draw FIRST — under pins and labels; a frame
   * border once sliced straight through "Jackson boneyard". The RAW padded bbox
   * — "the iron on page X", not the page's aspect-expanded coverage — clipped
   * to the image area. Letter badges get their space blocked so no label lands
   * on them. */
  for (const f of opts.frames || []) {
    const b = f.raw || f.box;
    const rx0 = Math.max(px(b.x0), AX), ry0 = Math.max(py(b.y1), AY);
    const rx1 = Math.min(px(b.x1), AX + AW), ry1 = Math.min(py(b.y0), AY + AH);
    if (rx1 <= rx0 || ry1 <= ry0) continue;
    prims.push({ type: 'rect', x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0, stroke: WHITE, width: 2.2 });
    prims.push({ type: 'rect', x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0, stroke: INK, width: 0.8 });
    prims.push(textPrim(rx0 + 4, ry0 + 3, f.letter, 13, { bold: true, color: WHITE, halo: false }));
    prims.push(textPrim(rx0 + 4.6, ry0 + 3.6, f.letter, 13, { bold: true, color: INK, halo: false }));
    grid.block({ x: rx0, y: ry0, w: 18, h: 18 });
  }

  /* muted context: another page's iron, visible for orientation but obviously
   * not countable — small grey dots, no labels, no badges, excluded from the
   * header count. Prevents the double-count when neighbouring frames overlap. */
  for (const p of opts.muted || []) {
    if (p.mx < box.x0 || p.mx > box.x1 || p.my < box.y0 || p.my > box.y1) continue;
    prims.push({ type: 'circle', x: px(p.mx), y: py(p.my), r: 3.2, fill: '#8a8175', stroke: WHITE, width: 0.8 });
  }

  // markers first (block their space), biggest kVA first so labels favor big iron
  for (const g of drawn) {
    g._x = px(g.cx); g._y = py(g.cy);
    g._r = Math.max(4, Math.min(14, 3 + Math.sqrt(g.totalKva) / 3.5));
    grid.block({ x: g._x - g._r - 4, y: g._y - g._r - 4, w: 2 * g._r + 8, h: 2 * g._r + 8 });
  }
  /* two passes: all pins first, all labels after — text can never end up under
   * a later marker (the other half of the "Jackson boneyard" clip) */
  const labelPrims = [];
  const overflow = [];
  let n = 0;
  for (const g of drawn) {
    prims.push({ type: 'circle', x: g._x, y: g._y, r: g._r, fill: g.suspect ? null : ACCENT, stroke: WHITE, width: 1.6, dash: g.suspect ? [3, 2] : null });
    if (g.members.length > 1 && g._r >= 7) {
      labelPrims.push(textPrim(g._x - 3.5, g._y - 4, String(g.members.length), 7.5, { bold: true, color: WHITE, halo: false }));
    }
    const lines = opts.overview
      ? (g.members.length > 1 && g.label ? [[g.label, 7.5, true]] : null)
      : [[g.label || '', 7.5, true], [g.kvaLabel, 7, false]].filter((l) => l[0]);
    if (!lines || !lines.length) continue;
    const w = Math.max(...lines.map(([s, sz, b]) => estWidth(s, sz, b)));
    const h = lines.reduce((s, [, sz]) => s + sz + 2, 0);
    const rect = placeLabel(grid, g._x, g._y, g._r, w, h);
    if (rect) {
      // leader when the label sits away from the pin
      const lx = rect.x + (rect.x > g._x ? 0 : rect.w), ly = rect.y + rect.h / 2;
      if (Math.hypot(lx - g._x, ly - g._y) > g._r + 8) {
        labelPrims.push({ type: 'line', x1: lx, y1: ly, x2: g._x, y2: g._y, stroke: WHITE, width: 1.4 });
        labelPrims.push({ type: 'line', x1: lx, y1: ly, x2: g._x, y2: g._y, stroke: INK, width: 0.6 });
      }
      let ty = rect.y;
      for (const [s, sz, b] of lines) { labelPrims.push(textPrim(rect.x + 2, ty, s, sz, { bold: b, color: INK, halo: true })); ty += sz + 2; }
    } else if (!opts.overview) {
      n++; overflow.push(`${n}. ${g.label ? g.label + ' — ' : ''}${g.kvaLabel}`);
      labelPrims.push(textPrim(g._x - 2.5, g._y - 4, String(n), 8, { bold: true, color: WHITE, halo: false }));
    }
  }
  prims.push(...labelPrims);

  // sidebar (overview): units with no pin — never silently dropped
  if (opts.sidebar && opts.sidebar.length) {
    let sy = AY + 4;
    prims.push(textPrim(opts.sidebarX, sy, 'NOT ON MAP (no GPS pin)', 8, { bold: true, color: INK })); sy += 14;
    for (const line of opts.sidebar.slice(0, 40)) { prims.push(textPrim(opts.sidebarX, sy, line, 7.5, { color: INK })); sy += 11; }
    if (opts.sidebar.length > 40) prims.push(textPrim(opts.sidebarX, sy, `… and ${opts.sidebar.length - 40} more`, 7.5, { color: '#777' }));
  }

  // footer: scale bar, north, coverage, attribution, overflow list
  const fy = AY + AH + 14;
  const scaleM = niceScale(mPerPtX, 140);
  const scalePt = scaleM / mPerPtX;
  prims.push({ type: 'line', x1: M, y1: fy, x2: M + scalePt, y2: fy, stroke: INK, width: 1.6 });
  prims.push({ type: 'line', x1: M, y1: fy - 4, x2: M, y2: fy + 4, stroke: INK, width: 1.6 });
  prims.push({ type: 'line', x1: M + scalePt, y1: fy - 4, x2: M + scalePt, y2: fy + 4, stroke: INK, width: 1.6 });
  prims.push(textPrim(M + scalePt + 6, fy - 5, `${scaleM} m`, 8, { color: INK }));
  // north arrow as a vector triangle — ↑ is not in base-14 Helvetica
  const nx = M + scalePt + 44;
  prims.push(textPrim(nx, fy - 5, 'N', 8, { bold: true, color: INK }));
  prims.push({ type: 'poly', pts: [[nx + 12, fy - 5], [nx + 9, fy + 3], [nx + 15, fy + 3]], fill: INK });
  if (opts.coverage) prims.push(textPrim(M, fy + 10, opts.coverage + ((opts.muted || []).length ? ' · grey dots are other pages’ iron (not counted here)' : ''), 7.5, { color: '#555' }));
  if (drawn.some((g) => g.suspect)) prims.push(textPrim(M, fy + 21, '◌ dashed pin: stored location disagrees with the movement log — position unverified', 7.5, { color: '#555' }));
  let oy = fy + 32;
  for (const o of overflow.slice(0, 4)) { prims.push(textPrim(M, oy, o, 7.5, { color: INK })); oy += 10; }
  prims.push(textPrim(PAGE_W - M - 210, PAGE_H - 22, 'Imagery: USGS NAIP Plus (public domain) — embedded at archive time', 7, { color: '#777' }));

  return { w: PAGE_W, h: PAGE_H, prims };
}

/* ---------------------------------------------------------------- renderers */

function svgEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function pageToSvg(page) {
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${page.w}" height="${page.h}" viewBox="0 0 ${page.w} ${page.h}">`,
    `<rect width="${page.w}" height="${page.h}" fill="#ffffff"/>`];
  for (const p of page.prims) {
    if (p.type === 'image') out.push(`<image x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" preserveAspectRatio="none" href="data:image/jpeg;base64,${p.jpeg.toString('base64')}"/>`);
    else if (p.type === 'rect') out.push(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="none" stroke="${p.stroke}" stroke-width="${p.width}"/>`);
    else if (p.type === 'circle') out.push(`<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${p.fill || 'none'}" stroke="${p.stroke}" stroke-width="${p.width}"${p.dash ? ` stroke-dasharray="${p.dash.join(',')}"` : ''}/>`);
    else if (p.type === 'line') out.push(`<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${p.stroke}" stroke-width="${p.width}"/>`);
    else if (p.type === 'poly') out.push(`<polygon points="${p.pts.map((q) => q.join(',')).join(' ')}" fill="${p.fill}"/>`);
    else if (p.type === 'text') out.push(`<text x="${p.x}" y="${p.y + p.size * 0.78}" font-family="Helvetica, Arial, sans-serif" font-size="${p.size}"${p.bold ? ' font-weight="bold"' : ''} fill="${p.color}"${p.halo ? ' stroke="#ffffff" stroke-width="2.2" paint-order="stroke" stroke-linejoin="round"' : ''}>${svgEsc(p.str)}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

function renderPdf(pages, PDFDocument) {
  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: false,
    info: { Title: 'FleetView site map', Creator: 'fv_sitemap.js' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  for (const page of pages) {
    doc.addPage();
    for (const p of page.prims) {
      if (p.type === 'image') doc.image(p.jpeg, p.x, p.y, { width: p.w, height: p.h });
      else if (p.type === 'rect') doc.rect(p.x, p.y, p.w, p.h).lineWidth(p.width).stroke(p.stroke);
      else if (p.type === 'circle') {
        doc.save();
        if (p.dash) doc.dash(p.dash[0], { space: p.dash[1] });
        doc.circle(p.x, p.y, p.r).lineWidth(p.width);
        if (p.fill) doc.fillAndStroke(p.fill, p.stroke); else doc.stroke(p.stroke);
        doc.restore();
      } else if (p.type === 'line') doc.moveTo(p.x1, p.y1).lineTo(p.x2, p.y2).lineWidth(p.width).stroke(p.stroke);
      else if (p.type === 'poly') doc.polygon(...p.pts).fill(p.fill);
      else if (p.type === 'text') {
        doc.font(p.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(p.size);
        if (p.halo) {
          doc.fillColor('#ffffff');
          for (const [dx, dy] of [[-0.8, 0], [0.8, 0], [0, -0.8], [0, 0.8], [-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
            doc.text(p.str, p.x + dx, p.y + dy, { lineBreak: false });
          }
        }
        doc.fillColor(p.color).text(p.str, p.x, p.y, { lineBreak: false });
      }
    }
  }
  doc.end();
  return done;
}

/* ---------------------------------------------------------------- generate */

async function generate(dir) {
  const PDFDocument = require('pdfkit');
  const sharp = require('sharp');
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, 'data', f), 'utf8'));
  const show = rd('show.json');
  const units = rd('units.json');
  const movements = rd('movements.json');

  const pinned = unitPins(units, movements, show.id);
  const withPin = pinned.filter((p) => p.gps);
  const noPin = pinned.filter((p) => !p.gps);
  if (!withPin.length) throw new Error('no unit has a GPS pin on this show — nothing to map');
  for (const p of withPin) { const m = toMerc(p.gps.lat, p.gps.lng); p.mx = m.x; p.my = m.y; }

  const groups = buildGroups(withPin, show.id);
  const quads = kdSplit(withPin).filter((q) => q.length);
  const letters = ['A', 'B', 'C', 'D'];

  // no-pin sidebar lines, grouped by placement text
  const sideGroups = new Map();
  for (const p of noPin) {
    const key = placementText(p.u, show.id) || '(no placement recorded)';
    if (!sideGroups.has(key)) sideGroups.set(key, []);
    sideGroups.get(key).push(p.kva);
  }
  const sidebar = [...sideGroups.entries()].map(([k, kvas]) => `${k} — ${kvaBreakdown(kvas)}`);

  const coverage = `${withPin.length} of ${pinned.length} units mapped · pins are the last logged movement, not surveyed positions`;

  // page geometry
  const sidebarW = sidebar.length ? 168 : 0;
  const ovArea = { x: M, y: 76, w: PAGE_W - 2 * M - sidebarW, h: 624 };
  const qArea = { x: M, y: 76, w: PAGE_W - 2 * M, h: 624 };

  const ovBox = fitAspect(bboxOf(withPin, PAD_M * 2), ovArea.w, ovArea.h);
  const frames = quads.map((q, i) => {
    const raw = bboxOf(q, PAD_M);
    return { letter: letters[i], raw, box: fitAspect(raw, qArea.w, qArea.h) };
  });

  const getImage = async (box, area) => {
    const w = Math.min(4100, Math.round(area.w * IMG_SCALE)), h = Math.min(4100, Math.round(area.h * IMG_SCALE));
    try { return { jpeg: await naipImage(box, w, h), source: 'naip' }; }
    catch (e) {
      console.error(`NAIP render failed (${e.message}) — falling back to z16 tile stitch`);
      return { jpeg: await stitchZ16(box, w, h, sharp), source: 'z16-fallback' };
    }
  };

  const sources = new Set();
  const ovImg = await getImage(ovBox, ovArea); sources.add(ovImg.source);
  const pages = [buildPage('SITE OVERVIEW', `${groups.length} placements · quadrants A–D on the following pages`, show, groups, ovBox, ovImg.jpeg, ovArea,
    { overview: true, frames, sidebar, sidebarX: M + ovArea.w + 10, coverage })];

  /* Each quadrant page labels ONLY its own partition — groups are rebuilt from
   * that partition's units so a straddling text-group can't be drawn twice and
   * page totals sum to the show. Everyone else's iron shows as muted dots. */
  for (let i = 0; i < frames.length; i++) {
    const img = await getImage(frames[i].box, qArea); sources.add(img.source);
    const own = new Set(quads[i]);
    const ownGroups = buildGroups(quads[i], show.id);
    const muted = withPin.filter((p) => !own.has(p));
    pages.push(buildPage(`QUADRANT ${letters[i]}`, `${quads[i].length} units · ${Math.round(quads[i].reduce((s, p) => s + p.kva, 0))} kVA`,
      show, ownGroups, frames[i].box, img.jpeg, qArea, { coverage, muted }));
  }

  // self-audit: a placed label must never intersect a drawn pin. Reports, not
  // asserts — imagery pages still ship, but the collision is named on stderr.
  for (let pi = 0; pi < pages.length; pi++) {
    const circles = pages[pi].prims.filter((p) => p.type === 'circle' && p.fill === ACCENT);
    for (const p of pages[pi].prims) {
      if (p.type !== 'text' || !p.halo) continue;
      const w = estWidth(p.str, p.size, p.bold), h = p.size + 2;
      for (const c of circles) {
        const nx = Math.max(p.x, Math.min(c.x, p.x + w)), ny = Math.max(p.y, Math.min(c.y, p.y + h));
        if (Math.hypot(c.x - nx, c.y - ny) < c.r) console.error(`LABEL/PIN OVERLAP page ${pi}: "${p.str}" at ${Math.round(p.x)},${Math.round(p.y)} vs pin r${c.r.toFixed(1)} at ${Math.round(c.x)},${Math.round(c.y)}`);
      }
    }
  }

  // write outputs ("site-map", hyphenated — "sitemap" reads as a website artifact;
  // lowercase-no-space matches every other archive file and needs no shell quoting)
  for (const f of fs.readdirSync(dir)) if (/^sitemap[.-]/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const pdf = await renderPdf(pages, PDFDocument);
  fs.writeFileSync(path.join(dir, 'site-map.pdf'), pdf);
  const pngNames = ['site-map-overview.png', ...frames.map((f) => `site-map-quad-${f.letter.toLowerCase()}.png`)];
  for (let i = 0; i < pages.length; i++) {
    const png = await sharp(Buffer.from(pageToSvg(pages[i])), { density: 144 }).png().toBuffer();
    fs.writeFileSync(path.join(dir, pngNames[i]), png);
  }

  return {
    pdf: 'site-map.pdf', pngs: pngNames, pdf_bytes: pdf.length,
    units_mapped: withPin.length, units_unmapped: noPin.length, groups: groups.length,
    quadrant_unit_counts: quads.map((q) => q.length),
    imagery: [...sources].join('+'),
    label_rule: 'placement text + kVA only — never serials, never coordinates',
  };
}

/* ---------------------------------------------------------------- selftest */

function selftest() {
  const t = (name, cond) => { if (!cond) { console.error('FAIL: ' + name); process.exitCode = 1; } };
  t('kva breakdown identical sizes', kvaBreakdown([625, 625, 625, 625]) === '4× 625 kVA');
  t('kva breakdown mixed, count-desc', kvaBreakdown([35, 15, 35, 35]) === '3× 35 + 1× 15 kVA');
  t('nice scale', niceScale(2.5, 140) === 250 && niceScale(0.5, 140) === 50);

  // placement-text-first grouping: Swamp inside the Back-up pile stays separate
  const mk = (id, mx, my, area, kva) => ({ u: { id, kw: kva, job_meta: { s1: { area } }, location_type: 'show', location_id: 's1' }, mx, my, kva, suspect: false, gps: {} });
  const pile = [mk('u1', 0, 0, 'Back up', 35), mk('u2', 5, 5, 'Back up', 35), mk('u3', 8, 2, 'Swamp', 70), mk('u4', 3, 8, 'Back up', 15)];
  const gs = buildGroups(pile, 's1');
  t('same spot, different text -> two markers', gs.length === 2);
  t('text groups aggregate', gs.find((g) => g.label === 'Back up').members.length === 3);
  const far = [mk('a', 0, 0, 'Gate', 100), mk('b', 500, 0, 'Gate', 100)];
  t('same text 500m apart stays two markers', buildGroups(far, 's1').length === 2);

  const pts = [];
  for (let i = 0; i < 20; i++) pts.push({ mx: (i % 5) * 100, my: Math.floor(i / 5) * 300 });
  const qs = kdSplit(pts);
  t('kd split balanced', qs.map((q) => q.length).join(',') === '5,5,5,5');
  t('kd split covers all', qs.flat().length === 20);

  const g = makeGrid(0, 0, 200, 100);
  const r1 = placeLabel(g, 100, 50, 6, 60, 18);
  t('label places beside the pin', !!r1 && r1.x === 110);
  const r2 = placeLabel(g, 100, 50, 6, 60, 18);
  t('second label avoids the first', !!r2 && (r2.x !== r1.x || r2.y !== r1.y));

  if (process.exitCode) { console.error('SELFTEST FAILED'); process.exit(1); }
  console.log('selftest OK');
}

/* ---------------------------------------------------------------- main */

if (require.main === module) {
  (async () => {
    const arg = process.argv[2];
    if (arg === '--selftest') return selftest();
    if (!arg) { console.error('usage: fv_sitemap.js <archiveDir> | --selftest'); process.exit(1); }
    const dir = path.resolve(arg);
    const meta = await generate(dir);
    const mPath = path.join(dir, 'manifest.json');
    if (fs.existsSync(mPath)) {
      const manifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
      manifest.sitemap = meta;
      fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));
    }
    console.log(`site map -> ${path.join(dir, meta.pdf)} (${(meta.pdf_bytes / 1e6).toFixed(1)} MB, imagery: ${meta.imagery})`);
    console.log(`  ${meta.units_mapped}/${meta.units_mapped + meta.units_unmapped} units mapped in ${meta.groups} placement markers; quadrants ${meta.quadrant_unit_counts.join('/')}`);
  })().catch((e) => { console.error('FATAL:', e.message || e); process.exit(1); });
}

module.exports = { generate, buildGroups, kdSplit, kvaBreakdown, unitPins, niceScale };
