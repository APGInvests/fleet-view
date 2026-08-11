#!/usr/bin/env node
/**
 * fv_archive.js — freeze one show into a permanent, self-contained archive:
 * raw rows (JSON), flat CSVs, real photo files, a data dictionary, a manifest.
 * Readable in 2027 with a browser and a spreadsheet — no app, no Supabase, no repo.
 *
 * READ-ONLY BY CONSTRUCTION: every request this script makes is a GET (plus the
 * one POST to /auth/v1/token, which mints a session and writes nothing). There is
 * no code path that issues an insert, update, upsert, or delete.
 *
 * Usage:
 *   FV_EMAIL=... FV_PASSWORD=... node tools/fv_archive.js --show "Lollapalooza"
 *   FV_EMAIL=... FV_PASSWORD=... node tools/fv_archive.js --show-id <uuid>
 *   FV_EMAIL=... FV_PASSWORD=... node tools/fv_archive.js --list
 *   node tools/fv_archive.js --rebuild <dir>   (offline; recompute cadence from frozen data)
 *   node tools/fv_archive.js --photos <dir>    (re-download the photo set from frozen rows; public bucket, no credentials)
 *   node tools/fv_archive.js --selftest        (offline; no credentials needed)
 *
 * Options: --out <dir> (default archive/). FV_ANON_KEY / FV_URL override the
 * defaults below (the anon key is the public client key from index.html —
 * public-safe by design; RLS is what protects the data).
 *
 * Exit codes: 0 = complete · 2 = completed with shortfalls (listed in the
 * manifest AND on stderr — e.g. failed photo downloads, row-count mismatch)
 * · 1 = fatal (auth, network, bad arguments).
 *
 * Roster derivation (why four sources): the union of
 *   movements.to_id/from_id  — authoritative (arrival, departure, transit,
 *                              placement photos are all job-stamped acts)
 *   units.job_meta keys      — strong (written from the placement UI, keyed by
 *                              the unit's actual show when it has one)
 *   reports.show_id          — WEAK: stamped from S.currentShowId, the job
 *   issues.show_id             selected in the top bar, NOT the unit's location
 *                              (index.html saveVitals/saveIssue). A tech with
 *                              the wrong job selected mis-attributes the row.
 * The 2026-08-01 outage lost ~14h of movement rows, so a movements-only roster
 * has holes; the weak sources fill them but are flagged, never trusted alone:
 * each roster entry carries its evidence list and a movement_confirmed flag.
 *
 * status_events has no show_id column at all — attribution is inferred from the
 * show's evidence window and labelled 'window-inferred' in the CSV.
 *
 * Future wiring (job-archiving, HANDOFF §10): swap selectShows() for "every show
 * with archived_at set and no up-to-date archive". Nothing else changes.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const URLB = process.env.FV_URL || 'https://eujgglfcpdfgskyqfggg.supabase.co';
const ANON = process.env.FV_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1amdnbGZjcGRmZ3NreXFmZ2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1ODI4MDksImV4cCI6MjEwMDE1ODgwOX0.0OCf7DeBOeaU3WgihQ2E-cSQ7WdUFPy7DsQJ_2X_8xc';
const TOOL = 'fv_archive.js v2';   // v2: cadence.md + cadence.csv + --rebuild
const TABLES = ['shops', 'shows', 'units', 'reports', 'issues', 'movements', 'status_events'];
const PAGE = 1000;           // Supabase REST returns at most 1000 rows per request
const PHOTO_TIMEOUT_MS = 20000;

/* Known data issues — recorded in the manifest when the matching serial is on
 * the roster. Deliberately NOT fixed, merged, or cleaned by this script. */
const KNOWN_ISSUES = [
  { serials: ['D19701', 'D19701.'],
    note: "UNRESOLVED: 'D19701' and 'D19701.' are two records in different placements, " +
          "probably one machine (trailing-period duplicate; predates near-match dedup). " +
          "'D19701.' carries a 407,366h reading, which is impossible. Field verification pending." },
  { serials: ['C5E02270'],
    note: "UNRESOLVED: 'C5E02270' is an orphan record of the 'C5E02269/70' twin. " +
          'Field verification pending.' },
];

/* ---------------------------------------------------------------- pure helpers */

function slugify(name) {
  return String(name || 'show').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'show';
}
function sanitizeSerial(s) {
  const out = String(s || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.+$/, '-');
  return out || 'no-serial';
}
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
}
function iso(ts) { return ts == null ? null : new Date(ts).toISOString(); }
function compactTs(ts) {
  return ts == null ? 'no-ts' : new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}
function isTwin(u) { return !!(u && u.engines && typeof u.engines === 'object' && !u.engines.off); }
/* Mirror of the app's derivedLoadPct (index.html), on snake_case rows: apparent
   power over nameplate — sqrt(3)*V_LL*(sum legs)/3 / (kVA*1000). No PF anywhere
   (it cancels against the rating's 0.8). Metered wins; all three legs required
   (one leg probably means single-phase). Recomputed on every archive run, so a
   formula fix here recomputes every past check — nothing is frozen. */
function derivedLoadPct(r) {
  if (!r || r.load_kw != null || r.load_pct != null) return null;
  if (r.voltage_ll == null || r.amps_l1 == null || r.amps_l2 == null || r.amps_l3 == null) return null;
  const kva = r.rating_kva;
  if (!(kva > 0)) return null;
  return Math.round(Math.sqrt(3) * r.voltage_ll * (r.amps_l1 + r.amps_l2 + r.amps_l3) / 3 / (kva * 10));
}
function jobMetaOf(u, showId) {
  const jm = u && u.job_meta;
  return (jm && typeof jm === 'object' && jm[showId] && typeof jm[showId] === 'object') ? jm[showId] : {};
}

/* The selection predicate, isolated on purpose: job-archiving later swaps this
 * for "every show with archived_at set and no up-to-date archive". */
function selectShows(shows, opts) {
  if (opts.showId) {
    const s = shows.find((x) => String(x.id) === String(opts.showId));
    return s ? [s] : [];
  }
  if (opts.show) {
    const q = opts.show.toLowerCase();
    const exact = shows.filter((s) => String(s.name || '').toLowerCase() === q);
    if (exact.length) return exact;
    return shows.filter((s) => String(s.name || '').toLowerCase().includes(q));
  }
  return [];
}

/* Roster union across the four sources. Returns Map unitId -> {sources:Set, …}. */
function deriveRoster(showId, units, reports, issues, movements) {
  const roster = new Map();
  const add = (unitId, source) => {
    if (!unitId) return;
    if (!roster.has(unitId)) roster.set(unitId, { sources: new Set() });
    roster.get(unitId).sources.add(source);
  };
  for (const m of movements) {
    if (m.to_id === showId) {
      add(m.unit_id, m.kind === 'photo' ? 'movement-photo'
        : m.to_type === 'transit' ? 'movement-transit' : 'movement-arrival');
    }
    if (m.from_id === showId && m.kind !== 'photo') add(m.unit_id, 'movement-departure');
  }
  for (const u of units) if (jobMetaOf(u, showId) !== undefined && u.job_meta && u.job_meta[showId]) add(u.id, 'job_meta');
  for (const r of reports) if (r.show_id === showId) add(r.unit_id, 'reports');
  for (const i of issues) if (i.show_id === showId) add(i.unit_id, 'issues');
  for (const e of roster.values()) {
    e.movement_confirmed = [...e.sources].some((s) => s.startsWith('movement-'));
  }
  return roster;
}

/* Evidence window: min/max ts across everything stamped or movement-linked to
 * the show. Used only to scope status_events (which cannot be stamped). */
function evidenceWindow(showId, reports, issues, movements) {
  let lo = null, hi = null;
  const see = (ts) => {
    if (ts == null) return;
    const t = Date.parse(ts);
    if (Number.isNaN(t)) return;
    if (lo === null || t < lo) lo = t;
    if (hi === null || t > hi) hi = t;
  };
  for (const m of movements) if (m.to_id === showId || m.from_id === showId) see(m.ts);
  for (const r of reports) if (r.show_id === showId) see(r.ts);
  for (const i of issues) if (i.show_id === showId) see(i.ts);
  return { start: lo, end: hi };
}

function gpsParts(g) {
  if (!g || typeof g !== 'object') return { lat: null, lng: null, acc: null };
  return { lat: g.lat != null ? g.lat : null, lng: g.lng != null ? g.lng : null, acc: g.acc != null ? g.acc : null };
}

/* ---------------------------------------------------------------- timeline */

/* Every `ts` is device time AT LOG TIME, not when the thing happened in the
 * field. `received_at` only became real when the column landed — every earlier
 * row carries the ALTER's backfill timestamp, so latency analysis is only valid
 * from this moment on. */
const RECEIVED_AT_VALID_FROM = '2026-08-01T16:29:00Z';

/* "Sustained logging" = the first pair of consecutive days each carrying at
 * least this many logged events. On the 2026 shows, everything before that pair
 * is the app's own adoption ramp — the tool did not exist yet or was not yet in
 * crew use — and the timeline must not read that silence as site inactivity. */
const ADOPTION_MIN_EVENTS = 5;

/* Nameplate kVA (units.kw is kVA — legacy name). TwinPak: sum the engines that
 * are not toggled off; fall back to the flat rating if the json carries none. */
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

/* One row per show-local calendar day. "Placed" is a state machine per unit —
 * first arrival while not on site — never a raw movement-row count: photo rows
 * (kind='photo') and same-location pins document a unit, they don't move it,
 * and a unit re-placed after leaving counts again. Departures subtract from the
 * running kVA-on-site figure; if that figure goes negative, arrivals are
 * missing (the 2026-08-01 outage class) and the report says so. */
function buildCadence(show, scoped, notes, win) {
  const tz = show.tz || 'America/Chicago';
  const dayKey = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: tz });

  const blank = () => ({ placed: 0, kvaPlaced: 0, departed: 0, kvaDeparted: 0, checks: 0, checksStamped: 0,
    checksInferred: 0, issues: 0, run: 0, down: 0, moveRows: 0, events: 0 });
  const days = new Map();
  const day = (k) => { if (!days.has(k)) days.set(k, blank()); return days.get(k); };

  const real = scoped.movements.filter((m) => m.kind !== 'photo');
  const photoRows = scoped.movements.length - real.length;
  let pinRows = 0;

  const byUnit = new Map();
  for (const m of real) {
    if (!byUnit.has(m.unit_id)) byUnit.set(m.unit_id, []);
    byUnit.get(m.unit_id).push(m);
  }
  for (const list of byUnit.values()) {
    list.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    let on = false;
    for (const m of list) {
      const toShow = m.to_type === 'show' && m.to_id === show.id;
      const fromShow = m.from_type === 'show' && m.from_id === show.id;
      if (toShow && fromShow) { pinRows++; continue; }          // pin: locates, never arrives
      const kva = kvaOfUnit(scoped.unitsById.get(String(m.unit_id)));
      if (toShow && !on) { on = true; const d = day(dayKey(m.ts)); d.placed++; d.kvaPlaced += kva; }
      else if (fromShow && !toShow) { on = false; const d = day(dayKey(m.ts)); d.departed++; d.kvaDeparted += kva; }
    }
  }
  for (const m of scoped.movements) { const d = day(dayKey(m.ts)); d.moveRows++; d.events++; }
  for (const r of scoped.checks) {
    const d = day(dayKey(r.ts)); d.checks++; d.events++;
    if (r.show_id === show.id) d.checksStamped++; else d.checksInferred++;
  }
  for (const i of scoped.issues) { const d = day(dayKey(i.ts)); d.issues++; d.events++; }
  for (const e of scoped.statusEvents) {
    const d = day(dayKey(e.ts)); d.events++;
    if (e.status === 'running') d.run++; else if (e.status === 'down') d.down++;
  }

  const sd = Array.isArray(show.show_days) && show.show_days.length ? [...show.show_days].sort() : null;
  const keys = [...days.keys()].sort();
  if (!keys.length && !sd) return null;

  /* continuous calendar range = union of activity span and show_days span;
   * start_date is deliberately NOT a range bound — a contract date ten quiet
   * days early (Lollapalooza) would pad the table with zero rows. */
  const bounds = [...keys, ...(sd || [])].sort();
  const lo = bounds[0], hi = bounds[bounds.length - 1];
  const range = [];
  for (let t = Date.parse(lo + 'T12:00:00Z'); range.length < 400; t += 86400e3) {
    const k = new Date(t).toISOString().slice(0, 10);
    range.push(k);
    if (k === hi) break;
  }

  const dayN = (k) => show.start_date
    ? Math.round((Date.parse(k + 'T12:00:00Z') - Date.parse(show.start_date + 'T12:00:00Z')) / 86400e3) + 1 : null;
  const phase = (k) => {
    if (!sd) return null;
    if (k < sd[0]) return 'load-in';
    if (sd.includes(k)) return 'show';
    if (k > sd[sd.length - 1]) return 'load-out';
    return 'dark';
  };

  const firstActivity = keys[0] || null;
  let sustainedFrom = null;
  for (let i = 0; i < range.length - 1; i++) {
    const a = days.get(range[i]), b = days.get(range[i + 1]);
    if (a && b && a.events >= ADOPTION_MIN_EVENTS && b.events >= ADOPTION_MIN_EVENTS) { sustainedFrom = range[i]; break; }
  }
  if (!sustainedFrom) sustainedFrom = firstActivity;
  const ramp = !!(firstActivity && sustainedFrom && firstActivity < sustainedFrom);

  let kvaOnSite = 0, wentNegative = false;
  const rows = range.map((k) => {
    const d = days.get(k) || blank();
    kvaOnSite += d.kvaPlaced - d.kvaDeparted;
    if (kvaOnSite < -0.001) wentNegative = true;
    return Object.assign({ date: k, dayN: dayN(k), phase: phase(k),
      pre: !!(sustainedFrom && k < sustainedFrom), kvaOnSite: Math.round(kvaOnSite * 10) / 10 }, d);
  });

  const csv = toCsv(
    ['date', 'day_n', 'phase', 'pre_sustained_logging', 'units_placed', 'kva_placed', 'units_departed', 'kva_departed',
      'kva_on_site_eod', 'checks', 'checks_stamped', 'checks_window_inferred', 'issues_opened',
      'status_running_events', 'status_down_events', 'movement_rows'],
    rows.map((r) => [r.date, r.dayN ?? '', r.phase ?? '', r.pre ? 'yes' : '', r.placed, Math.round(r.kvaPlaced),
      r.departed, Math.round(r.kvaDeparted), r.kvaOnSite, r.checks, r.checksStamped, r.checksInferred,
      r.issues, r.run, r.down, r.moveRows]));

  /* ---- cadence, computed not narrated ---- */
  const placedDays = rows.filter((r) => r.placed > 0);
  const totalPlaced = rows.reduce((n, r) => n + r.placed, 0);
  const totalKva = rows.reduce((n, r) => n + r.kvaPlaced, 0);
  const peak = placedDays.reduce((b, r) => (!b || r.kvaPlaced > b.kvaPlaced) ? r : b, null);
  const firstRun = rows.find((r) => r.run > 0);
  const firstDep = peak ? rows.find((r) => r.departed > 0 && r.date >= peak.date) : null;
  const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400e3);
  const cadence = [];
  if (placedDays.length) {
    cadence.push(`${totalPlaced} unit(s), ${Math.round(totalKva)} kVA placed across ${placedDays.length} delivery day(s), ${placedDays[0].date} → ${placedDays[placedDays.length - 1].date}.`);
    if (peak && placedDays.length > 1) {
      const adv = placedDays.filter((r) => r.date < peak.date);
      if (adv.length) cadence.push(`Advance load from ${adv[0].date} (${adv.reduce((n, r) => n + r.placed, 0)} unit(s), ${Math.round(adv.reduce((n, r) => n + r.kvaPlaced, 0))} kVA); main load-in ${peak.date} (${peak.placed} unit(s), ${Math.round(peak.kvaPlaced)} kVA — ${Math.round(peak.kvaPlaced / totalKva * 100)}% of the show's power).`);
      else cadence.push(`Main load-in ${peak.date} (${peak.placed} unit(s), ${Math.round(peak.kvaPlaced)} kVA — ${Math.round(peak.kvaPlaced / totalKva * 100)}% of the show's power).`);
    }
    if (firstRun && peak) cadence.push(`First running status logged ${firstRun.date}` + (firstRun.date >= peak.date ? ` — ${dayDiff(peak.date, firstRun.date)} day(s) after main load-in.` : '.'));
    if (firstDep) cadence.push(`Load-out (first logged departure after peak) began ${firstDep.date}.`);
  }

  /* ---- caveats: generated from the data, so future runs caveat themselves ---- */
  const caveats = [
    'Every timestamp is when a tech LOGGED the entry, not when the truck arrived or the work happened. ' +
      'Activity is dated by logging time; a burst of catch-up logging lands on the day of the burst.',
  ];
  if (ramp) {
    caveats.push(`Sustained logging begins ${sustainedFrom} (first pair of consecutive days with ≥${ADOPTION_MIN_EVENTS} logged events each); ` +
      `first logged activity is ${firstActivity}. Rows before ${sustainedFrom} are marked † — on the 2026 shows this early sparsity is the app's own adoption ramp ` +
      '(the tool did not exist or was not yet in crew use), NOT site inactivity. Read pre-† counts as a floor on what happened, never as cadence.');
  } else if (firstActivity) {
    caveats.push(`Sustained logging from first activity (${firstActivity}) — no adoption ramp detected by the ≥${ADOPTION_MIN_EVENTS}-events-on-consecutive-days rule.`);
  }
  if (!sd) caveats.push('No show_days set on this job — phases (load-in / show / dark / load-out) are unavailable. Set the show days in the app and re-run the archive.');
  if (!show.start_date) caveats.push('No start_date on this job — day numbers are unavailable; rows are anchored to first logged activity.');
  if (!show.tz) caveats.push(`Time zone: show.tz is not set; days are bucketed in the fallback zone ${tz}. If the show ran elsewhere, day boundaries may be shifted.`);
  else caveats.push(`Days are bucketed in ${tz} (show-local).`);
  if (win && win.start != null && iso(win.start) < RECEIVED_AT_VALID_FROM) {
    caveats.push(`received_at is only meaningful from ${RECEIVED_AT_VALID_FROM} (the column's ALTER backfilled everything earlier) — ` +
      'do not compute logging latency for rows before that moment.');
  }
  if (photoRows || pinRows) caveats.push(`Excluded from placement counts: ${photoRows} placement-photo row(s) and ${pinRows} same-location pin row(s) — they document units, they do not move them.`);
  if (wentNegative) caveats.push('kVA-on-site goes NEGATIVE at some point: departures were logged for arrivals that never were (lost or never-logged movement writes). Treat on-site totals as a floor.');
  caveats.push(`Counts end at the archive's evidence window (${iso(win && win.end)}); re-run the archive after load-out to capture the tail.`);
  caveats.push('status_running/down_events count TRANSITION events, which are sparse — they are not "units running that day".');
  caveats.push('Paralleled big iron (stage banks): a load reading reflects how many bank members were online when the tech walked by, not unit sizing. ' +
    'Redundancy is the spec on stages — low big-iron load % is never a downsizing case. See the data dictionary.');
  for (const n of notes || []) caveats.push(n);

  const fmtRow = (r) => `| ${r.date}${r.pre ? ' †' : ''} | ${r.dayN ?? ''} | ${r.phase ?? ''} | ${r.placed || ''} | ${r.kvaPlaced ? Math.round(r.kvaPlaced) : ''} | ${r.kvaOnSite || ''} | ${r.checks || ''} | ${r.issues || ''} | ${r.run || ''} | ${r.down || ''} |`;
  const md = `# Cadence — ${show.name}

One row per show-local day (${tz}). This is the crew's notepad read back: what got
logged, when. It is a record of logging, which is a floor on the record of work —
see the caveats before quoting any number.

## Cadence

${cadence.length ? cadence.map((s) => '- ' + s).join('\n') : '- No placements logged inside this archive.'}

## Day by day

| Date | Day | Phase | Placed | kVA placed | kVA on site | Checks | Issues | Run evts | Down evts |
|---|---|---|---|---|---|---|---|---|---|
${rows.map(fmtRow).join('\n')}
${ramp ? '\n† pre-sustained-logging: the app was not yet in crew use — a floor, not a cadence.\n' : ''}
## How to read this

${caveats.map((c) => '- ' + c).join('\n')}
`;

  const meta = {
    tz_used: tz, tz_source: show.tz ? 'show.tz' : 'fallback',
    days: rows.length, first_activity: firstActivity,
    sustained_logging_from: sustainedFrom,
    adoption_rule: `first pair of consecutive days with >=${ADOPTION_MIN_EVENTS} logged events each`,
    adoption_ramp_detected: ramp,
    phases_available: !!sd, day_numbers_available: !!show.start_date,
    excluded_rows: { placement_photos: photoRows, same_location_pins: pinRows },
    units_placed_total: totalPlaced, kva_placed_total: Math.round(totalKva),
  };
  return { rows, csv, md, meta };
}

/* ---------------------------------------------------------------- REST layer */

async function login() {
  const email = process.env.FV_EMAIL, pass = process.env.FV_PASSWORD;
  if (!email || !pass) { console.error('need FV_EMAIL and FV_PASSWORD in the environment'); process.exit(1); }
  const res = await fetch(`${URLB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass }),
  });
  const auth = await res.json().catch(() => ({}));
  if (!auth.access_token) { console.error('auth failed:', JSON.stringify(auth).slice(0, 200)); process.exit(1); }
  return { apikey: ANON, Authorization: `Bearer ${auth.access_token}` };
}

/* Paginated full-table GET. Returns {rows, total} where total is the server's
 * exact count from Content-Range — the row-count cross-check for the manifest. */
async function fetchAll(H, table) {
  const rows = [];
  let total = null;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${URLB}/rest/v1/${table}?select=*&order=id.asc`, {
      headers: { ...H, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items', Prefer: 'count=exact' },
    });
    if (!(res.status === 200 || res.status === 206)) throw new Error(`GET ${table} -> HTTP ${res.status}`);
    const cr = res.headers.get('content-range');           // e.g. "0-999/1234" or "*/0"
    const m = cr && cr.match(/\/(\d+|\*)$/);
    if (m && m[1] !== '*') total = Number(m[1]);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return { rows, total: total == null ? rows.length : total };
}

/* ---------------------------------------------------------------- archive core */

function archiveDirName(show, win) {
  const year = (show.start_date && String(show.start_date).slice(0, 4))
    || (win.start != null && new Date(win.start).getUTCFullYear())
    || new Date().getUTCFullYear();
  return `${year}-${slugify(show.name)}-${String(show.id).replace(/-/g, '').slice(0, 8)}`;
}

function locName(type, id, showsById, shopsById) {
  if (type === 'fleet' || (!type && !id)) return 'fleet (unassigned)';
  if (type === 'show' || type === 'transit') {
    const s = showsById.get(String(id));
    return (type === 'transit' ? 'en route: ' : '') + (s ? s.name : `show:${id || '?'}`);
  }
  if (type === 'shop') { const s = shopsById.get(String(id)); return s ? `${s.name} (shop)` : `shop:${id || '?'}`; }
  return `${type || '?'}:${id || '?'}`;
}

/* Filename must be unique per (source row, index) — the photo-reclass batch
 * stamped many rows with ONE shared transaction timestamp, and a ts-only name
 * silently overwrote distinct photos (found in QA 2026-08-03: 20 index rows,
 * 12 files on disk). The short row id makes collisions impossible. */
function photoName(ctx, ts, rowId, n) {
  return `${ctx}-${compactTs(ts)}-${String(rowId).replace(/-/g, '').slice(0, 8)}-${n}.jpg`;
}

/* Download every photo referenced by the given rows into photos/, write
 * index.csv. Used by the live run and by --photos (offline repair: the bucket
 * is public, so frozen rows are enough to rebuild the set — still GETs only). */
async function downloadPhotoSet(dir, rosterUnits, issues, movements, unitsById) {
  const photoJobs = [];
  for (const u of rosterUnits) (u.photos || []).forEach((p, n) => photoJobs.push({ url: p, ctx: 'unit', ts: u.updated_at, rowId: u.id, unitId: u.id, n }));
  for (const i of issues) (i.photos || []).forEach((p, n) => photoJobs.push({ url: p, ctx: 'issue', ts: i.ts, rowId: i.id, unitId: i.unit_id, n }));
  for (const m of movements) (m.photos || []).forEach((p, n) => photoJobs.push({ url: p, ctx: m.kind === 'photo' ? 'placement' : 'move', ts: m.ts, rowId: m.id, unitId: m.unit_id, n }));

  const serialDirs = new Map();  // unitId -> dir name, disambiguated on collision
  for (const u of rosterUnits) {
    let d = sanitizeSerial(u.serial || u.tag_id);
    if ([...serialDirs.values()].includes(d)) d += '-' + String(u.id).replace(/-/g, '').slice(0, 8);
    serialDirs.set(String(u.id), d);
  }

  fs.rmSync(path.join(dir, 'photos'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
  const photoIndex = [], photoFails = [];
  for (const j of photoJobs) {
    const u = unitsById.get(String(j.unitId));
    const sdir = serialDirs.get(String(j.unitId)) || sanitizeSerial(u && u.serial) || 'unknown-unit';
    fs.mkdirSync(path.join(dir, 'photos', sdir), { recursive: true });
    const rel = path.join('photos', sdir, photoName(j.ctx, j.ts, j.rowId, j.n));
    const r = await downloadPhoto(j.url, path.join(dir, rel));
    const urlNote = String(j.url).startsWith('data:') ? '(data URI in row)' : j.url;
    if (r.ok) {
      photoIndex.push([rel, j.ctx, j.rowId, (u && u.serial) || '', iso(j.ts) || '', urlNote]);
    } else {
      photoFails.push({ file: rel, url: urlNote, status: r.status });
      photoIndex.push([rel + ' (FAILED: ' + r.status + ')', j.ctx, j.rowId, (u && u.serial) || '', iso(j.ts) || '', urlNote]);
    }
  }
  fs.writeFileSync(path.join(dir, 'photos', 'index.csv'),
    toCsv(['file', 'context', 'source_row_id', 'serial', 'row_timestamp_utc', 'original_url'], photoIndex));
  return { photoJobs, photoIndex, photoFails };
}

async function downloadPhoto(url, dest) {
  if (typeof url === 'string' && url.startsWith('data:')) {   // unsynced legacy row: decode, don't fetch
    const i = url.indexOf(',');
    fs.writeFileSync(dest, Buffer.from(url.slice(i + 1), 'base64'));
    return { ok: true, bytes: fs.statSync(dest).size, source: 'data-uri' };
  }
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), PHOTO_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return { ok: false, status: res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return { ok: true, bytes: buf.length, source: 'url' };
  } catch (e) {
    return { ok: false, status: String(e.name === 'AbortError' ? 'timeout' : e.message) };
  } finally { clearTimeout(tm); }
}

async function archiveShow(show, all, totals, outRoot) {
  const shortfalls = [];
  const showId = show.id;
  const showsById = new Map(all.shows.map((s) => [String(s.id), s]));
  const shopsById = new Map(all.shops.map((s) => [String(s.id), s]));
  const unitsById = new Map(all.units.map((u) => [String(u.id), u]));

  const roster = deriveRoster(showId, all.units, all.reports, all.issues, all.movements);
  const win = evidenceWindow(showId, all.reports, all.issues, all.movements);

  const dir = path.join(outRoot, archiveDirName(show, win));
  // refresh in place: data/ and photos/ are fully derived, so rebuild them clean
  for (const sub of ['data', 'photos']) fs.rmSync(path.join(dir, sub), { recursive: true, force: true });
  for (const sub of ['data/csv', 'photos']) fs.mkdirSync(path.join(dir, sub), { recursive: true });

  /* ---- scope rows to the show ---- */
  const inWin = (ts) => {
    if (win.start === null || ts == null) return false;
    const t = Date.parse(ts);
    return !Number.isNaN(t) && t >= win.start && t <= win.end;
  };
  const attribution = (row) => row.show_id === showId ? 'stamped'
    : (roster.has(row.unit_id) && row.show_id == null && inWin(row.ts)) ? 'window-inferred' : null;

  const checks = all.reports.filter((r) => attribution(r));
  const issues = all.issues.filter((i) => attribution(i));
  const movements = all.movements.filter((m) => m.to_id === showId || m.from_id === showId);
  const statusEvents = all.status_events.filter((e) => roster.has(e.unit_id) && inWin(e.ts));
  const rosterUnits = [...roster.keys()].map((id) => unitsById.get(String(id))).filter(Boolean);
  const missingUnits = [...roster.keys()].filter((id) => !unitsById.has(String(id)));
  if (missingUnits.length) {
    shortfalls.push(`${missingUnits.length} roster unit id(s) have no units row (already deleted?): ${missingUnits.join(', ')}`);
  }

  /* ---- raw JSON, exactly as REST returned the rows ---- */
  const rawOut = {
    'show.json': show, 'units.json': rosterUnits, 'checks.json': checks, 'issues.json': issues,
    'movements.json': movements, 'status_events.json': statusEvents,
    'shops.json': all.shops, 'shows.json': all.shows.map((s) => ({ id: s.id, name: s.name, location: s.location, start_date: s.start_date })),
  };
  for (const [f, data] of Object.entries(rawOut)) {
    fs.writeFileSync(path.join(dir, 'data', f), JSON.stringify(data, null, 2));
  }

  /* ---- photos: real files, from every row type that can carry them ---- */
  const { photoJobs, photoFails } = await downloadPhotoSet(dir, rosterUnits, issues, movements, unitsById);
  if (photoFails.length) shortfalls.push(`${photoFails.length} photo download(s) failed — see manifest.photos.failed`);

  /* ---- CSVs ---- */
  const serialOf = (id) => { const u = unitsById.get(String(id)); return u ? (u.serial || u.tag_id || id) : id; };

  const rosterRows = [...roster.entries()].map(([id, e]) => {
    const u = unitsById.get(String(id)) || {};
    const jm = jobMetaOf(u, showId);
    let first = null, last = null;
    for (const m of movements) if (m.unit_id === id && m.ts) { const t = Date.parse(m.ts); if (first === null || t < first) first = t; if (last === null || t > last) last = t; }
    for (const r of checks) if (r.unit_id === id && r.ts) { const t = Date.parse(r.ts); if (first === null || t < first) first = t; if (last === null || t > last) last = t; }
    return [u.serial || '', u.tag_id || '', u.klass || '', u.make || '', u.model || '', u.kw != null ? u.kw : '',
      isTwin(u) ? 'yes' : '', u.has_def === true ? 'yes' : '', u.engines ? JSON.stringify(u.engines) : '',
      jm.name || '', jm.area || '', jm.note || '',
      [...e.sources].join('; '), e.movement_confirmed ? 'yes' : 'NO — weak evidence only (see dictionary)',
      iso(first) || '', iso(last) || '',
      locName(u.location_type, u.location_id, showsById, shopsById), id];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  fs.writeFileSync(path.join(dir, 'data', 'csv', 'roster.csv'), toCsv(
    ['serial', 'tag_id', 'class', 'make', 'model', 'kva_rating', 'twinpak', 'has_def', 'engines_json', 'job_name', 'placement', 'job_note',
      'roster_evidence', 'movement_confirmed', 'first_seen_utc', 'last_seen_utc', 'location_at_archive_time', 'unit_id'], rosterRows));

  fs.writeFileSync(path.join(dir, 'data', 'csv', 'checks.csv'), toCsv(
    ['ts_utc', 'serial', 'engine', 'tech_name', 'attribution', 'voltage_ll', 'voltage_ln', 'amps_l1', 'amps_l2', 'amps_l3', 'hz',
      'load_kw', 'load_pct', 'load_pct_derived', 'rating_kva', 'coolant_temp', 'oil_pressure', 'fuel_psi', 'fuel_level_pct', 'battery_v', 'def_pct',
      'engine_hours', 'condition_ok', 'broken_gauges', 'notes', 'unit_id', 'report_id'],
    checks.map((r) => [iso(r.ts), serialOf(r.unit_id), r.engine || '', r.tech_name || '', attribution(r),
      r.voltage_ll, r.voltage_ln, r.amps_l1, r.amps_l2, r.amps_l3, r.hz, r.load_kw, r.load_pct, derivedLoadPct(r) ?? '', r.rating_kva,
      r.coolant_temp, r.oil_pressure, r.fuel_psi, r.fuel_level_pct, r.battery_v, r.def_pct, r.engine_hours,
      r.condition_ok === true ? 'yes' : '', Array.isArray(r.broken_gauges) ? r.broken_gauges.join('; ') : '',
      r.notes || '', r.unit_id, r.id]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))));

  fs.writeFileSync(path.join(dir, 'data', 'csv', 'issues.csv'), toCsv(
    ['ts_utc', 'serial', 'engine', 'severity', 'title', 'text', 'tech_name', 'resolved', 'attribution', 'photo_count', 'unit_id', 'issue_id'],
    issues.map((i) => [iso(i.ts), serialOf(i.unit_id), i.engine || '', i.severity || '', i.title || '', i.text || '',
      i.tech_name || '', i.resolved ? 'yes' : 'no', attribution(i), (i.photos || []).length, i.unit_id, i.id])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))));

  fs.writeFileSync(path.join(dir, 'data', 'csv', 'movements.csv'), toCsv(
    ['ts_utc', 'serial', 'kind', 'from', 'to', 'tech_name', 'gps_lat', 'gps_lng', 'gps_acc_m', 'photo_count', 'unit_id', 'movement_id'],
    movements.map((m) => {
      const g = gpsParts(m.gps);
      return [iso(m.ts), serialOf(m.unit_id), m.kind === 'photo' ? 'placement-photo (NOT a move)' : 'move/placement/pin',
        locName(m.from_type, m.from_id, showsById, shopsById), locName(m.to_type, m.to_id, showsById, shopsById),
        m.tech_name || '', g.lat, g.lng, g.acc, (m.photos || []).length, m.unit_id, m.id];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0])))));

  fs.writeFileSync(path.join(dir, 'data', 'csv', 'status_events.csv'), toCsv(
    ['ts_utc', 'serial', 'engine', 'status', 'tech_name', 'attribution', 'unit_id', 'event_id'],
    statusEvents.map((e) => [iso(e.ts), serialOf(e.unit_id), e.engine || '', e.status || '', e.tech_name || '',
      'window-inferred (table has no show_id)', e.unit_id, e.id])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))));

  /* ---- data dictionary ---- */
  fs.writeFileSync(path.join(dir, 'data', 'dictionary.md'), dictionaryMd(show, win));

  /* ---- job_meta population check (roster-source verification, every run) ---- */
  const jmStats = (() => {
    const withAny = all.units.filter((u) => u.job_meta && typeof u.job_meta === 'object' && Object.keys(u.job_meta).length);
    let keys = 0, named = 0, placed = 0, thisShow = 0;
    for (const u of withAny) for (const [k, v] of Object.entries(u.job_meta)) {
      if (!v || typeof v !== 'object') continue;
      keys++;
      if (k === showId) thisShow++;
      if (v.name && String(v.name).trim()) named++;
      if (v.area && String(v.area).trim()) placed++;
    }
    return { fleet_units: all.units.length, units_with_any_job_meta: withAny.length, total_keys: keys, keys_with_name: named, keys_with_area: placed, keys_for_this_show: thisShow };
  })();

  /* ---- manifest ---- */
  const maxTs = (() => {
    let hi = null;
    for (const t of ['reports', 'issues', 'movements', 'status_events']) for (const r of all[t]) {
      const v = Date.parse(r.ts || 0); if (!Number.isNaN(v) && (hi === null || v > hi)) hi = v;
    }
    for (const u of all.units) { const v = Date.parse(u.updated_at || 0); if (!Number.isNaN(v) && (hi === null || v > hi)) hi = v; }
    return hi;
  })();

  const notes = [
    "reports.show_id / issues.show_id are stamped from the job selected in the app's top bar (S.currentShowId), " +
      "NOT from the unit's location. Rows can be attributed to the wrong show. Roster entries with movement_confirmed=NO rest on this weak evidence alone.",
    'status_events has no show_id column; its rows here are attributed by the evidence window, not by a stamp.',
    'The 2026-08-01 outage (~01:47–16:17 America/Chicago) lost all movement writes in that window. ' +
      'Movement history and GPS pins for moves in that window are permanently missing; unit locations and check/issue rows were unaffected.',
  ];
  for (const ki of KNOWN_ISSUES) {
    if (rosterRows.some((r) => ki.serials.includes(r[0]))) notes.push(ki.note);
  }
  if (jmStats.keys_with_name === 0 && jmStats.keys_with_area === 0) {
    notes.push('job_meta verification: effectively UNPOPULATED fleet-wide (no names, no areas) — roster still counts its keys as evidence, but placement columns are empty.');
  }

  /* ---- cadence: delivery timeline per show-local day ---- */
  /* Pre-rename archives carried timeline.md / timeline.csv — remove them so a
   * 2027 reader never finds two names for the same content. */
  fs.rmSync(path.join(dir, 'timeline.md'), { force: true });
  fs.rmSync(path.join(dir, 'data', 'csv', 'timeline.csv'), { force: true });
  const tl = buildCadence(show, { movements, checks, issues, statusEvents, unitsById }, notes, win);
  if (tl) {
    fs.writeFileSync(path.join(dir, 'data', 'csv', 'cadence.csv'), tl.csv);
    fs.writeFileSync(path.join(dir, 'cadence.md'), tl.md);
  }

  /* ---- site map: PDF + page PNGs on embedded NAIP imagery ---- */
  /* Needs tools/ devDependencies (pdfkit + sharp) and network for the imagery.
   * A missing install or a dead imagery service is a SHORTFALL (exit 2), never
   * a silent skip — the map is the artifact people actually open. */
  let sitemap = null;
  try {
    sitemap = await require('./fv_sitemap.js').generate(dir);
  } catch (e) {
    shortfalls.push('site map FAILED: ' + ((e && e.message) || e) +
      ((e && e.code === 'MODULE_NOT_FOUND') ? '  — run: cd tools && npm install' : ''));
  }

  const manifest = {
    tool: TOOL, generated_at: new Date().toISOString(), read_only: 'this tool only issues GETs',
    cadence: tl ? tl.meta : null,
    sitemap,
    show, evidence_window: { start: iso(win.start), end: iso(win.end) },
    max_source_row_timestamp: iso(maxTs),
    source_table_totals: totals,
    counts: {
      roster_units: roster.size,
      roster_movement_confirmed: [...roster.values()].filter((e) => e.movement_confirmed).length,
      roster_weak_evidence_only: [...roster.values()].filter((e) => !e.movement_confirmed).length,
      checks: checks.length, issues: issues.length, movements: movements.length, status_events: statusEvents.length,
    },
    photos: { referenced: photoJobs.length, downloaded: photoJobs.length - photoFails.length, failed: photoFails },
    job_meta_population: jmStats,
    roster: rosterRows.map((r) => ({ serial: r[0], unit_id: r[16], evidence: r[11], movement_confirmed: r[12] === 'yes' })),
    data_quality_notes: notes,
    shortfalls,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return { dir, manifest, shortfalls };
}

/* ---------------------------------------------------------------- dictionary */

function dictionaryMd(show, win) {
  return `# Data dictionary — FleetView show archive
Show: **${show.name}** (id \`${show.id}\`) · evidence window ${iso(win.start)} → ${iso(win.end)}

This archive is self-contained. \`data/*.json\` holds rows exactly as the backend
returned them (snake_case); \`data/csv/\` holds the same data flattened for a
spreadsheet. Photos are real files under \`photos/\`, indexed in \`photos/index.csv\`.
\`cadence.md\` (and \`data/csv/cadence.csv\`) is the show's day-by-day delivery
cadence — read its caveats section before quoting any number from it.
\`site-map.pdf\` (pages also as \`site-map-*.png\`) draws every unit's placement on
embedded satellite imagery — labels are placement text + kVA, never serials;
pins are the last logged movement, not surveyed positions.

## Read these before interpreting anything

- **\`units.kw\` is the rating in kVA.** The column name is legacy. Same for
  \`kva_rating\` in roster.csv — it is kVA, not kW.
- **\`movements.kind = 'photo'\` rows are NOT moves.** They are placement photos —
  how the unit sat on this job. Their from/to mirror the unit's location at
  capture time and must not be read as a transfer. Rows with kind null are real
  moves, placements, or pin-sets (from = to means a pin/placement event, not a move).
- **\`reports.show_id\` and \`issues.show_id\` are unreliable.** They record the job
  the tech had selected in the app's top bar, not where the unit stood. The
  \`attribution\` CSV column says how each row got in: \`stamped\` (show_id matched)
  or \`window-inferred\`. Roster membership with \`movement_confirmed = NO\` rests
  on these stamps alone — treat as probable, not proven.
- **\`status_events\` has no show column at all.** Rows here are included because
  the unit was on the roster and the event fell inside the evidence window.
- **Timestamps** (\`ts\`, \`ts_utc\`) are device time at write, ISO-8601 UTC.
  \`status_events.received_at\` (where present) is server receive time.
- **GPS**: \`gps\` objects are \`{lat, lng, acc}\` (accuracy in meters). Checks and
  issues carry \`gps: null\` by design — only movement rows locate a unit.
- **Load %** was derived at check time: \`round(load_kw / (rating_kva × 0.8) × 100)\`
  (0.8 assumed power factor). Each check stamps the \`rating_kva\` it used, so the
  stored percentage is self-describing even if ratings change later.
- **\`load_pct_derived\` (checks.csv) is computed, not observed.** Filled only when
  the check has no metered \`load_kw\`/\`load_pct\` but carries V L-L, all three amp
  legs, and a stamped rating: \`sqrt(3) x V_LL x (sum of legs)/3 / (kVA x 1000)\` —
  apparent power over nameplate, **no power-factor assumption** (a metered check's
  \`load_pct\` equals this x PF/0.8, so derived reads up to ~20% low when true PF
  is high; direction known). Recomputed on every archive run — a formula change
  re-derives every past check. Never merge it silently with \`load_pct\`.
- **Paralleled big iron: load % reflects bank state at observation time, not unit
  sizing.** Large stages run banks of paralleled machines (e.g. four 500s on one
  stage) brought online in steps — one machine through early build, two during
  programming, all of them doors-to-close — and the bank is sized to absorb
  transients (bass + video + audio hitting together) with redundancy as the spec.
  A check on one bank member records the load it happened to carry with however
  many mates were online at that moment. Low load % on stage/paralleled iron is
  the spec working. It is NOT evidence of oversizing and must never be read as a
  downsizing case. Sizing conclusions are only valid for standalone units.
- **TwinPak** (\`engines\` json present and not \`"off": true\`): one trailer, two
  engines, one serial. Per-engine fields live in \`engines.A\` / \`engines.B\`
  (\`kvaEach\`, \`serviceDueHours\`, \`lastServiceHours\`, \`opStatus\`). Checks and
  issues tagged \`engine\` A/B are per-engine; untagged rows on a TwinPak predate
  the split ("pre-split") and belong to Engine A's lineage. Flat \`current_hours\`
  on a TwinPak is only Engine A's pre-split seed.
- **\`job_meta\`** on a unit is a map keyed by show id: \`{name, area, note}\` —
  what the unit powered and where it sat on THAT job only. The roster.csv
  \`job_name\`/\`placement\`/\`job_note\` columns come from this show's key.
- **Serials are free text** (slashes, dashes, trailing periods are real).
  \`photos/\` directory names are sanitized serials; the true serial is in
  \`photos/index.csv\` and roster.csv.
- **The 2026-08-01 movement outage** (~01:47–16:17 America/Chicago) permanently
  lost every movement write in that window. Expect gaps in movement history and
  missing/stale GPS for placements made during it. Locations, checks, and issues
  were unaffected.

## Column notes (non-obvious only)

| Table.column | Meaning |
|---|---|
| units.kw | Rating in **kVA** (legacy name) |
| units.klass | 'big' or 'small' iron |
| units.tag_id | Barcode/scan code when it differs from the serial — a shortcut, never a second identity |
| units.has_def | \`yes\` = unit has a DEF tank (per-unit flag, small iron; blank = no/unknown). Gates the DEF % field on the check form — blank def_pct on a no-DEF unit is structural, not skipped. Future model-to-spec table backfills from this |
| units.op_status | 'staged' / 'running' / 'down' at archive time (TwinPak: per-engine in engines json) |
| units.location_type/-id | Where the unit stood **at archive time**, not during the show |
| reports.* | One vital-sign check. Every field optional — blank means not observed, never zero |
| reports.oil_pressure / fuel_psi | psi. fuel_psi is big-iron only (clogging-filter diagnostic) |
| reports.condition_ok | \`true\` = tech tapped "All good" — a positive OK assertion. Blank = not asserted, NEVER "not OK" |
| reports.broken_gauges | Field keys the tech flagged as broken instruments (\`voltage\`/\`amps\` cover their leg groups). A blank vital + its key here = gauge broken, not "not observed". Cleared by a later check recording a real value on that gauge |
| reports.engine_hours | Meter reading at check time — the source for runtime deltas |
| issues.severity | 'cosmetic' / 'maintenance' / 'down' |
| movements.from/to_type | 'show' / 'shop' / 'transit' / 'fleet' (= unassigned) |
| status_events.status | Operational status change event ('running'/'staged'/'down'), per engine when tagged |
`;
}

/* ---------------------------------------------------------------- selftest */

function selftest() {
  const t = (name, cond) => { if (!cond) { console.error('FAIL: ' + name); process.exitCode = 1; } };
  t('slugify', slugify('Lollapalooza 2026!') === 'lollapalooza-2026');
  t('sanitize slash serial', sanitizeSerial('1LS01712/14') === '1LS01712-14');
  t('sanitize trailing dot distinct', sanitizeSerial('D19701.') === 'D19701-' && sanitizeSerial('D19701') === 'D19701');
  t('csv quoting', csvEscape('a,"b"\nc') === '"a,""b""\nc"');
  t('csv null empty', csvEscape(null) === '');

  const units = [
    { id: 'u1', serial: 'A1', job_meta: { s1: { area: 'VIP' } } },
    { id: 'u2', serial: 'A2', job_meta: {} },
    { id: 'u3', serial: 'A3' }, { id: 'u4', serial: 'A4' }, { id: 'u5', serial: 'A5' }];
  const reports = [{ id: 'r1', unit_id: 'u2', show_id: 's1', ts: '2026-08-01T10:00:00Z' },
    { id: 'r2', unit_id: 'u5', show_id: 's2', ts: '2026-08-01T10:00:00Z' }];
  const issues = [{ id: 'i1', unit_id: 'u3', show_id: 's1', ts: '2026-08-01T11:00:00Z' }];
  const movements = [
    { id: 'm1', unit_id: 'u4', to_type: 'show', to_id: 's1', from_type: 'shop', from_id: 'p1', ts: '2026-07-30T00:00:00Z', kind: null },
    { id: 'm2', unit_id: 'u4', to_type: 'show', to_id: 's1', from_type: 'show', from_id: 's1', ts: '2026-07-31T00:00:00Z', kind: 'photo' },
    { id: 'm3', unit_id: 'u5', to_type: 'shop', to_id: 'p1', from_type: 'show', from_id: 's1', ts: '2026-08-02T00:00:00Z', kind: null }];
  const roster = deriveRoster('s1', units, reports, issues, movements);
  t('roster union size', roster.size === 5);
  t('jobmeta source', roster.get('u1') && [...roster.get('u1').sources].includes('job_meta') && !roster.get('u1').movement_confirmed);
  t('reports source weak', roster.get('u2') && !roster.get('u2').movement_confirmed);
  t('issues source weak', roster.get('u3') && !roster.get('u3').movement_confirmed);
  t('arrival + photo confirmed', roster.get('u4') && roster.get('u4').movement_confirmed);
  t('departure counts as membership', roster.get('u5') && roster.get('u5').movement_confirmed);
  t('photo row never a departure source', ![...roster.get('u4').sources].includes('movement-departure'));

  const win = evidenceWindow('s1', reports, issues, movements);
  t('window start', iso(win.start) === '2026-07-30T00:00:00.000Z');
  t('window end', iso(win.end) === '2026-08-02T00:00:00.000Z');

  const sel = selectShows([{ id: 'a', name: 'Lollapalooza' }, { id: 'b', name: 'Hinterland' }], { show: 'lolla' });
  t('name lookup substring', sel.length === 1 && sel[0].id === 'a');
  t('id lookup', selectShows([{ id: 'a' }], { showId: 'a' }).length === 1);

  /* photo filenames: the reclass batch shares ONE ts across rows — names must
   * still be unique (found overwriting distinct photos in QA 2026-08-03) */
  const sameTs = '2026-08-01T16:17:45Z';
  t('same-ts different rows -> different photo files',
    photoName('placement', sameTs, 'aaaa1111-2222', 0) !== photoName('placement', sameTs, 'bbbb3333-4444', 0));
  t('same row two photos -> different files',
    photoName('unit', sameTs, 'aaaa1111', 0) !== photoName('unit', sameTs, 'aaaa1111', 1));

  /* ---- timeline ---- */
  t('kva flat', kvaOfUnit({ kw: 100 }) === 100);
  t('kva twin sums live engines', kvaOfUnit({ kw: 80, engines: { A: { kvaEach: 50 }, B: { kvaEach: 50, off: true } } }) === 50);
  t('kva twin empty json falls back', kvaOfUnit({ kw: 80, engines: {} }) === 80);

  const tShow = { id: 's1', name: 'Fixture Fest', start_date: '2026-07-01', tz: 'America/Chicago',
    show_days: ['2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12'] };
  const tUnits = new Map([['u1', { id: 'u1', kw: 100 }], ['u2', { id: 'u2', kw: 80, engines: { A: { kvaEach: 50 }, B: { kvaEach: 50 } } }]]);
  const mv = (unit_id, ts, from, to, kind) => ({ unit_id, ts, kind: kind || null,
    from_type: from[0], from_id: from[1], to_type: to[0], to_id: to[1] });
  const tMoves = [
    // 03:00Z = 22:00 CDT the previous evening — the tz-bucketing case
    mv('u1', '2026-07-02T03:00:00Z', ['shop', 'p1'], ['show', 's1']),
    mv('u1', '2026-07-02T15:00:00Z', ['show', 's1'], ['show', 's1']),            // pin — excluded
    mv('u1', '2026-07-02T16:00:00Z', ['show', 's1'], ['show', 's1'], 'photo'),   // photo — excluded
    mv('u2', '2026-07-03T15:00:00Z', ['shop', 'p1'], ['show', 's1']),
    mv('u1', '2026-07-13T15:00:00Z', ['show', 's1'], ['shop', 'p1']),            // departs...
    mv('u1', '2026-07-14T15:00:00Z', ['shop', 'p1'], ['show', 's1']),            // ...and returns: placed again
  ];
  const chk = (ts) => ({ unit_id: 'u1', show_id: 's1', ts });
  const tChecks = [];
  for (let i = 0; i < 6; i++) tChecks.push(chk(`2026-07-03T1${i}:30:00Z`));
  for (let i = 0; i < 5; i++) tChecks.push(chk(`2026-07-04T1${i}:30:00Z`));
  const tStatus = [{ unit_id: 'u1', status: 'running', ts: '2026-07-05T18:00:00Z' }];
  const tl = buildCadence(tShow, { movements: tMoves, checks: tChecks, issues: [], statusEvents: tStatus,
    unitsById: tUnits }, ['fixture note'], { start: Date.parse('2026-07-01T00:00:00Z'), end: Date.parse('2026-07-14T00:00:00Z') });
  const row = (d) => tl.rows.find((r) => r.date === d);
  t('tz bucketing: 03:00Z arrival lands the previous Chicago day', row('2026-07-01').placed === 1 && row('2026-07-02').placed === 0);
  t('pins and photos excluded from placement', tl.meta.excluded_rows.same_location_pins === 1 && tl.meta.excluded_rows.placement_photos === 1);
  t('day numbers anchor to start_date', row('2026-07-01').dayN === 1 && row('2026-07-14').dayN === 14);
  t('phase: before first show day is load-in', row('2026-07-03').phase === 'load-in');
  t('phase: listed day is show', row('2026-07-04').phase === 'show' && row('2026-07-12').phase === 'show');
  t('phase: gap inside the list is dark', row('2026-07-07').phase === 'dark');
  t('phase: after last show day is load-out', row('2026-07-13').phase === 'load-out');
  t('re-arrival after departure counts again', row('2026-07-14').placed === 1 && row('2026-07-13').departed === 1);
  t('kva on site: 100+100-100+100', row('2026-07-14').kvaOnSite === 200);
  t('continuous range, one row per day', tl.rows.length === 14);
  t('sustained logging from the 07-03/07-04 pair', tl.meta.sustained_logging_from === '2026-07-03' && tl.meta.adoption_ramp_detected === true);
  t('pre-sustained rows flagged', row('2026-07-01').pre === true && row('2026-07-03').pre === false);
  t('csv has header + one line per day', tl.csv.trim().split('\n').length === 15);
  t('caveats carry the pass-through note', tl.md.includes('fixture note'));
  t('caveats explain the dagger', tl.md.includes('adoption ramp'));
  t('cadence day arithmetic never NaN', !tl.md.includes('NaN'));
  t('run event counted on its day', row('2026-07-05').run === 1);
  t('no show_days -> phases degrade, timeline still renders',
    buildCadence({ id: 's1', name: 'X' }, { movements: tMoves, checks: [], issues: [], statusEvents: [], unitsById: tUnits },
      [], { start: null, end: null }).rows.every((r) => r.phase === null));

  if (process.exitCode) { console.error('SELFTEST FAILED'); process.exit(1); }
  console.log('selftest OK');
}

/* ---------------------------------------------------------------- main */

(async () => {
  const argv = process.argv.slice(2);
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  if (argv.includes('--selftest')) return selftest();

  /* --rebuild <archiveDir>: recompute the DERIVED outputs (cadence) from an
   * existing archive's frozen data/*.json — offline, no credentials, and by
   * definition unable to touch Supabase. The raw rows are never rewritten. */
  const rb = opt('--rebuild');
  if (rb) {
    const dir = path.resolve(rb);
    const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, 'data', f), 'utf8'));
    const show = rd('show.json');
    const unitsById = new Map(rd('units.json').map((u) => [String(u.id), u]));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const win = { start: Date.parse(manifest.evidence_window.start) || null, end: Date.parse(manifest.evidence_window.end) || null };
    const tl = buildCadence(show, { movements: rd('movements.json'), checks: rd('checks.json'),
      issues: rd('issues.json'), statusEvents: rd('status_events.json'), unitsById },
    manifest.data_quality_notes || [], win);
    if (!tl) { console.error('nothing to draw: no events and no show_days'); process.exit(1); }
    fs.rmSync(path.join(dir, 'timeline.md'), { force: true });          // pre-rename leftovers
    fs.rmSync(path.join(dir, 'data', 'csv', 'timeline.csv'), { force: true });
    fs.writeFileSync(path.join(dir, 'data', 'csv', 'cadence.csv'), tl.csv);
    fs.writeFileSync(path.join(dir, 'cadence.md'), tl.md);
    delete manifest.timeline;                                           // older manifests carried this key
    manifest.cadence = tl.meta;
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`cadence rebuilt for "${show.name}" -> ${path.join(dir, 'cadence.md')} ` +
      `(${tl.meta.days} day rows, phases ${tl.meta.phases_available ? 'on' : 'OFF — no show_days'}, ` +
      `sustained logging from ${tl.meta.sustained_logging_from})`);
    return;
  }

  /* --photos <archiveDir>: rebuild photos/ + index.csv from the frozen rows.
   * The bucket is public, so this needs no credentials — and it exists because
   * the ts-only filename scheme overwrote same-timestamp photos (QA 2026-08-03). */
  const ph = opt('--photos');
  if (ph) {
    const dir = path.resolve(ph);
    const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, 'data', f), 'utf8'));
    const units = rd('units.json');
    const unitsById = new Map(units.map((u) => [String(u.id), u]));
    const r = await downloadPhotoSet(dir, units, rd('issues.json'), rd('movements.json'), unitsById);
    const mPath = path.join(dir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    manifest.photos = { referenced: r.photoJobs.length, downloaded: r.photoJobs.length - r.photoFails.length, failed: r.photoFails };
    fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));
    console.log(`photos rebuilt: ${r.photoJobs.length - r.photoFails.length}/${r.photoJobs.length} downloaded -> ${path.join(dir, 'photos')}`);
    if (r.photoFails.length) { r.photoFails.forEach((f) => console.error('FAILED: ' + f.file + ' (' + f.status + ')')); process.exit(2); }
    return;
  }

  const opts = { show: opt('--show'), showId: opt('--show-id'), out: opt('--out') || path.join(__dirname, '..', 'archive') };
  if (!argv.includes('--list') && !opts.show && !opts.showId) {
    console.error('usage: fv_archive.js --show <name> | --show-id <id> | --list | --rebuild <archiveDir> | --selftest  [--out dir]');
    process.exit(1);
  }

  const H = await login();
  const all = {}, totals = {};
  for (const t of TABLES) {
    const { rows, total } = await fetchAll(H, t);
    all[t] = rows; totals[t] = total;
    if (rows.length !== total) {
      console.error(`FATAL: ${t} fetched ${rows.length} of ${total} rows`);
      process.exit(1);
    }
  }

  if (argv.includes('--list')) {
    for (const s of all.shows) {
      const r = deriveRoster(s.id, all.units, all.reports, all.issues, all.movements);
      console.log(`${s.id}  ${String(s.name || '').padEnd(28)} start=${s.start_date || '—'}  roster=${r.size}`);
    }
    return;
  }

  const picked = selectShows(all.shows, opts);
  if (picked.length === 0) { console.error(`no show matches ${opts.showId || opts.show}. Try --list.`); process.exit(1); }
  if (picked.length > 1) {
    console.error(`ambiguous — matches: ${picked.map((s) => `"${s.name}" (${s.id})`).join(', ')}. Use --show-id.`);
    process.exit(1);
  }

  const { dir, manifest, shortfalls } = await archiveShow(picked[0], all, totals, opts.out);
  const c = manifest.counts, p = manifest.photos, j = manifest.job_meta_population;
  console.log(`archived "${picked[0].name}" -> ${dir}`);
  console.log(`roster=${c.roster_units} (movement-confirmed=${c.roster_movement_confirmed}, weak=${c.roster_weak_evidence_only}) ` +
    `checks=${c.checks} issues=${c.issues} movements=${c.movements} status_events=${c.status_events} ` +
    `photos=${p.downloaded}/${p.referenced}`);
  console.log(`job_meta fleet-wide: ${j.units_with_any_job_meta}/${j.fleet_units} units carry any key; ` +
    `${j.total_keys} keys, ${j.keys_with_name} named, ${j.keys_with_area} with placement; ${j.keys_for_this_show} for this show`);
  if (shortfalls.length) {
    for (const s of shortfalls) console.error('SHORTFALL: ' + s);
    process.exit(2);
  }
})().catch((e) => { console.error('FATAL:', e.message || e); process.exit(1); });
