#!/usr/bin/env node
/**
 * fv_backup.js — full-database export. Every table, no show scoping.
 *
 * Why this exists (security assessment 2026-08-11): the Supabase free tier
 * takes no backups, and RLS is `using(true)` for every authenticated user —
 * any account can delete every row, and deletion would be unrecoverable.
 * This export is the recovery path. It is read-only by construction: the
 * same sign-in fv_archive.js uses (one POST to /auth/v1/token) and nothing
 * but GETs after that.
 *
 * Usage:
 *   FV_EMAIL=... FV_PASSWORD=... node fv_backup.js [--out DIR] [--keep N]
 *
 * Output: DIR/YYYY-MM-DD-HHMM/<table>.json + manifest.json.
 *   DIR defaults to ~/FleetView-Backups and MUST be outside the repo —
 *   backups hold crew data and this repo deploys to public Pages, so the
 *   script refuses an --out inside the repo (same rule the preflight
 *   publish block enforces).
 *
 * Cross-check: every table's row count must equal the server's exact
 * Content-Range total. A mismatch or a failed table is a SHORTFALL —
 * loud, nonzero exit, and the run's directory is suffixed `-INCOMPLETE`.
 *
 * Retention: --keep N (default 60) prunes the oldest complete backup dirs
 * beyond N, only after a fully successful run, and only dirs matching the
 * timestamp pattern. INCOMPLETE dirs are never counted and never pruned.
 *
 * NOT included: Storage objects (unit-photos bucket). Rows carry the
 * public URLs; the objects themselves are a separate decision — see the
 * manifest's `not_included` note.
 *
 * Restore is deliberately manual (an emergency, not a routine): the JSON is
 * PostgREST row-shaped, so restore = POST the rows back per table with the
 * same auth headers, parents before children (TABLES order), Prefer:
 * resolution=merge-duplicates. Practice on a scratch project first.
 *
 * Exit codes: 0 = complete backup; 2 = ran but INCOMPLETE; 1 = fatal.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { login, fetchAll, TABLES } = require('./fv_archive.js');

/* profiles is optional: populated by the new-user trigger, never client-read,
   and its RLS may legitimately hide other users' rows. A refusal is recorded
   in the manifest but does not mark the backup incomplete. */
const OPTIONAL = ['profiles'];

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

(async () => {
  const argv = process.argv.slice(2);
  const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
  const outRoot = path.resolve(opt('--out', path.join(process.env.HOME || '.', 'FleetView-Backups')));
  const keep = Math.max(2, Number(opt('--keep', 60)) || 60);

  const repoRoot = path.dirname(__dirname);
  if ((outRoot + path.sep).startsWith(repoRoot + path.sep)) {
    console.error(`REFUSED: --out ${outRoot} is inside the repo (${repoRoot}).`);
    console.error('Backups hold crew data; this repo deploys to public GitHub Pages.');
    process.exit(1);
  }

  const H = await login();          /* auth first — a failed login must not leave an empty dated dir */
  const started = new Date();
  const dir = path.join(outRoot, stamp(started));
  fs.mkdirSync(dir, { recursive: true });
  const counts = {}, shortfalls = [], optionalSkips = [];
  for (const table of [...TABLES, ...OPTIONAL]) {
    try {
      const { rows, total } = await fetchAll(H, table);
      if (rows.length !== total) {
        shortfalls.push(`${table}: fetched ${rows.length} rows but server counts ${total}`);
      }
      fs.writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 1));
      counts[table] = rows.length;
      console.log(`  ${table}: ${rows.length} rows`);
    } catch (e) {
      if (OPTIONAL.includes(table)) {
        optionalSkips.push(`${table}: ${e.message}`);
        console.log(`  ${table}: skipped (optional) — ${e.message}`);
      } else {
        shortfalls.push(`${table}: ${e.message}`);
        console.error(`  ${table}: FAILED — ${e.message}`);
      }
    }
  }

  const manifest = {
    taken_at: started.toISOString(),
    duration_ms: Date.now() - started.getTime(),
    tables: counts,
    optional_skipped: optionalSkips,
    shortfalls,
    not_included: 'Storage objects (unit-photos bucket) — rows reference their public URLs only.',
    restore: 'POST rows back per table with the same auth headers, parents first '
      + '(shops,shows,units,reports,issues,movements,status_events), Prefer: resolution=merge-duplicates.',
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  if (shortfalls.length) {
    const bad = dir + '-INCOMPLETE';
    fs.renameSync(dir, bad);
    for (const s of shortfalls) console.error('SHORTFALL: ' + s);
    console.error(`INCOMPLETE backup kept at ${bad} — not counted for retention, never pruned.`);
    process.exit(2);
  }

  /* prune, oldest first, only after a complete run */
  const dated = fs.readdirSync(outRoot)
    .filter((n) => /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(n))
    .sort();
  for (const old of dated.slice(0, Math.max(0, dated.length - keep))) {
    fs.rmSync(path.join(outRoot, old), { recursive: true });
    console.log(`  pruned ${old}`);
  }

  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  console.log(`backup complete -> ${dir}  (${total} rows across ${Object.keys(counts).length} tables, keeping newest ${keep})`);
})().catch((e) => { console.error('FATAL:', e.message || e); process.exit(1); });
