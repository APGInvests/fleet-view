#!/usr/bin/env python3
"""fv_nes_gen_sql.py — generate the NES import SQL from the approved match table.

Every statement is IDEMPOTENT. Re-running changes nothing.
  * UPDATEs fill gaps only, guarded by `is null` / emptiness checks.
  * Note appends are guarded by a [NES] marker so they cannot double-append.
  * INSERTs are guarded by a not-exists on the normalised serial.
NEVER written: hours, vitals, label style (engines.style is deliberately absent),
job assignment, job_meta, photos, or any row position. Nothing is deleted.
"""
import sys, os, re, collections, json
os.chdir('/agent/workspace/fleet-view'); sys.path.insert(0,'tools')
from fv_nes_match import load, derive_make
from fv_nes_extract import norm_for_match

def nz(x):
    """375.0 -> 375, 437.5 stays 437.5. Avoids float noise in stored jsonb."""
    return int(x) if float(x).is_integer() else float(x)

Q = lambda s: "'" + str(s).replace("'", "''") + "'"
NORM = "upper(regexp_replace(coalesce(serial,''),'[^A-Za-z0-9]','','g'))"

app, nes = load()
akeys = collections.defaultdict(list)
for r in app: akeys[norm_for_match(r['serial'])].append(r)
nn = collections.defaultdict(list)
for r in nes:
    if r['ser']: nn[norm_for_match(r['ser'])].append(r)

matched   = [(r, nn[norm_for_match(r['serial'])][0]) for r in app if norm_for_match(r['serial']) in nn]
nes_only  = [v[0] for k, v in nn.items() if k not in akeys]
HELD      = {'UVC700618'}                    # transposed pair: do not insert
inserts   = [r for r in nes_only if r['ser'] not in HELD]
held      = [r for r in nes_only if r['ser'] in HELD]

L = []; A = L.append
A("-- ============================================================")
A("-- NES IMPORT  --  generated from the approved match table")
A("-- Idempotent. Re-running is a no-op. Nothing is deleted.")
A(f"--   {len(matched)} matched units updated (gaps only)")
A(f"--   {len(inserts)} new units inserted")
A(f"--   {len(held)} NES row held out: {', '.join(sorted(HELD))} (transposed pair, see match table 2a)")
A("-- Never written: hours, vitals, engines.style, job assignment, job_meta, photos.")
A("-- ============================================================")
A("begin;\n")

A("-- ---------- 1. MATCHED: classification (NES is authoritative) ----------")
for a, n in sorted(matched, key=lambda x: x[0]['serial']):
    if a['klass'] != 'big':
        A(f"update units set klass='big', updated_at=now() where serial={Q(a['serial'])} and klass<>'big';")
A("")
A("-- ---------- 2. MATCHED: fill blank package rating ----------")
for a, n in sorted(matched, key=lambda x: x[0]['serial']):
    if not (a['kw'] or '').strip():
        A(f"update units set kw={n['cls']['pkg']:g}, updated_at=now() where serial={Q(a['serial'])} and kw is null;")
A("")
A("-- ---------- 3. MATCHED: fill blank make (never overwrite) ----------")
for a, n in sorted(matched, key=lambda x: x[0]['serial']):
    dm = derive_make(n['ser'])
    if dm and not (a['make'] or '').strip():
        A(f"update units set make={Q(dm)}, updated_at=now() where serial={Q(a['serial'])} and coalesce(make,'')='';")
A("")
A("-- ---------- 4. MATCHED: create engines where the NES says Twin ----------")
A("-- Only where engines is null. style is deliberately ABSENT: the housing label is")
A("-- physical, unset until a tech reads it, and renders as Engine 1 / Engine 2.")
for a, n in sorted(matched, key=lambda x: x[0]['serial']):
    c = n['cls']
    if c['twin'] and a['engines'] == '0':
        j = json.dumps({"A": {"kvaEach": nz(c['per'])}, "B": {"kvaEach": nz(c['per'])}})
        A(f"update units set engines={Q(j)}::jsonb, updated_at=now() where serial={Q(a['serial'])} and engines is null;")
A("-- Config trap: these say config=TwinPak but the NES calls them SINGLES.")
A("-- No engines statement is emitted for them, by design:")
for a, n in sorted(matched, key=lambda x: x[0]['serial']):
    if 'twinpak' in (a['config'] or '').lower() and not n['cls']['twin']:
        A(f"--   {a['serial']}  config=TwinPak  NES={n['cls']['raw']}")
A("")
A("-- ---------- 5. MATCHED: append NES notes, marked, never overwriting ----------")
for a, n in sorted(matched, key=lambda x: x[0]['serial']):
    if n['ann']:
        txt = '[NES] ' + '; '.join(n['ann'])
        A(f"update units set notes=case when coalesce(notes,'')='' then {Q(txt)} "
          f"else notes||chr(10)||{Q(txt)} end, updated_at=now() "
          f"where serial={Q(a['serial'])} and coalesce(notes,'') not like '%[NES]%';")
A("")
A("-- ---------- 6. INSERT new units ----------")
A("-- Unassigned, blank hours, no vitals, no label style. Hard-down from the NES is a")
A("-- known office fact; everything else lands staged.")
for r in sorted(inserts, key=lambda x: x['ser']):
    c = r['cls']; dm = derive_make(r['ser'])
    cols = ["id", "serial", "klass", "kw", "op_status", "location_type", "location_id",
            "job_meta", "created_at", "updated_at"]
    vals = ["gen_random_uuid()::text", Q(r['ser']), "'big'", f"{c['pkg']:g}",
            "'down'" if r['hd'] else "'staged'", "'fleet'", "null", "'{}'::jsonb",
            "now()", "now()"]
    if dm: cols.append("make"); vals.append(Q(dm))
    if c['twin']:
        cols.append("engines")
        vals.append(Q(json.dumps({"A": {"kvaEach": nz(c['per'])}, "B": {"kvaEach": nz(c['per'])}})) + "::jsonb")
    if r['ann']:
        cols.append("notes"); vals.append(Q('[NES] ' + '; '.join(r['ann'])))
    A(f"insert into units ({', '.join(cols)}) select {', '.join(vals)} "
      f"where not exists (select 1 from units where {NORM}={Q(norm_for_match(r['ser']))});")
A("")
A("commit;")
A("")
A("-- ============================================================")
A("-- VERIFY")
A("-- ============================================================")
A(f"select count(*) as total_units from units;                              -- expect {len(app)+len(inserts)}")
A(f"select count(*) as big_iron from units where klass='big';               -- expect {len([a for a,_ in matched])+len(inserts)+2}")
A(f"select count(*) as twins from units where engines is not null;          -- expect "
  f"{len([1 for a,n in matched if n['cls']['twin'] or a['engines']=='1'])+len([r for r in inserts if r['cls']['twin']])}")
A(f"select count(*) as nes_hard_down from units where op_status='down';     -- expect at least {len([r for r in inserts if r['hd']])}")
A("select count(*) as any_style_set from units where engines->>'style' is not null;  -- expect 0")
A("-- no imported unit may carry hours or a service target:")
A("select count(*) as imported_with_hours from units where location_type='fleet' and (current_hours is not null or service_due_hours is not null);  -- expect 0")
A("-- the held-out transposition must NOT have been created:")
A("select serial from units where serial in ('UVC700618','UCV700618');      -- expect UCV700618 only")
open('docs/nes-import.sql','w',encoding='utf-8').write("\n".join(L)+"\n")
print(f"matched={len(matched)} inserts={len(inserts)} held={len(held)} "
      f"total_after={len(app)+len(inserts)} twins_new={len([r for r in inserts if r['cls']['twin']])} "
      f"hard_down_new={len([r for r in inserts if r['hd']])}")
print("statements:", sum(1 for x in L if x.strip().startswith(('update','insert'))))
