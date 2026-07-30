#!/usr/bin/env node
/**
 * fv_migrate_photos.js — one-time migration of base64 photos out of table rows
 * into the `unit-photos` Storage bucket. Idempotent: anything that isn't a
 * data URI is skipped, so re-running after success lists nothing.
 *
 * Usage:
 *   FV_ANON_KEY=... FV_EMAIL=... FV_PASSWORD=... node tools/fv_migrate_photos.js --dry-run
 *   FV_ANON_KEY=... FV_EMAIL=... FV_PASSWORD=... node tools/fv_migrate_photos.js
 *
 * Requires Node >= 18 (global fetch). Signs in as a normal authenticated user;
 * needs the Task 1.1 bucket policies in place (auth write / public read).
 * A failed upload leaves the row untouched — never half-migrates a row.
 */
'use strict';
const URLB = 'https://eujgglfcpdfgskyqfggg.supabase.co';
const KEY = process.env.FV_ANON_KEY, EMAIL = process.env.FV_EMAIL, PASS = process.env.FV_PASSWORD;
if (!KEY || !EMAIL || !PASS) { console.error('need FV_ANON_KEY FV_EMAIL FV_PASSWORD in the environment'); process.exit(1); }
const DRY = process.argv.includes('--dry-run');

(async () => {
  const auth = await fetch(`${URLB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  }).then((r) => r.json());
  if (!auth.access_token) { console.error('auth failed:', JSON.stringify(auth).slice(0, 200)); process.exit(1); }
  const H = { apikey: KEY, Authorization: `Bearer ${auth.access_token}` };

  let migrated = 0, pending = 0, failed = 0;
  for (const table of ['units', 'issues']) {
    const res = await fetch(`${URLB}/rest/v1/${table}?select=id,photos`, { headers: H });
    if (!res.ok) { console.error(`read ${table} failed: ${res.status}`); process.exit(1); }
    const rows = await res.json();
    for (const row of rows) {
      if (!Array.isArray(row.photos) || !row.photos.some((p) => String(p).startsWith('data:'))) continue;
      pending++;
      const out = [];
      let ok = true;
      for (const p of row.photos) {
        if (!String(p).startsWith('data:')) { out.push(p); continue; }
        const path = `${table}/${row.id}/${Date.now()}-${out.length}.jpg`;
        if (DRY) { console.log(`[dry] would upload ${table}/${row.id} -> ${path} (${Math.round(p.length / 1024)} KB b64)`); out.push(p); continue; }
        const buf = Buffer.from(p.slice(p.indexOf(',') + 1), 'base64');
        const up = await fetch(`${URLB}/storage/v1/object/unit-photos/${path}`, {
          method: 'POST', headers: { ...H, 'Content-Type': 'image/jpeg' }, body: buf,
        });
        if (!up.ok) { console.error(`upload FAILED ${table}/${row.id}: ${up.status} — row left untouched`); ok = false; failed++; break; }
        out.push(`${URLB}/storage/v1/object/public/unit-photos/${path}`);
      }
      if (!ok || DRY) continue;
      const patch = await fetch(`${URLB}/rest/v1/${table}?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ photos: out }),
      });
      if (patch.ok) { migrated++; console.log(`${table}/${row.id}: ${out.length} photo(s) migrated`); }
      else { failed++; console.error(`${table}/${row.id}: PATCH FAILED ${patch.status}`); }
    }
  }
  console.log(DRY
    ? `dry run: ${pending} row(s) hold base64 photos`
    : `done: ${migrated} migrated, ${failed} failed${failed ? ' — re-run after fixing' : ''}`);
  process.exit(failed ? 1 : 0);
})();
