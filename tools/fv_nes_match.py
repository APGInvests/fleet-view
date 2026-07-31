#!/usr/bin/env python3
"""fv_nes_match.py — build the NES match table. READ ONLY. Writes nothing anywhere.

Rules encoded (all owner-decided):
  * SERIAL is the only cross-reference. No row numbers, ever.
  * Match on alphanumerics only, case-insensitive. The normalised form is a
    comparison key and is NEVER written back to a record.
  * Classification comes from the NES and ONLY the NES. The config field is not
    evidence (HANDOFF 7 Config trap).
  * Fill gaps only. Anything a person entered always wins.
  * kW -> kVA at 0.8 PF. "500 kW Twin" = 625 kVA per engine, 1250 package.
  * Hours, vitals and label style are never imported.
"""
import csv, re, sys, collections
sys.path.insert(0, 'tools')
from fv_nes_extract import split_cell, norm_for_match

MAKE_PREFIX = [('X1CH','HiPower'),('U122','HiPower'),('U121','HiPower'),('A190','Cummins'),
               ('UVC','Atlas Copco'),('TGD','Technogen'),('FQ','Technogen'),
               ('X5M','CAT'),('T4A','CAT'),('C5E','CAT'),('C9E','CAT'),('C4G','CAT'),
               ('CBX','CAT'),('B3G','CAT')]
BLANK_PREFIX = ['1LS','QSL','4ZR','GG500','X3M','U21001X','U18803Y','396970','17013','400-1','400-2']

def derive_make(serial):
    s = (serial or '').upper()
    for p in BLANK_PREFIX:
        if s.startswith(p.upper()): return ''          # owner: leave blank, don't guess
    for p, mk in sorted(MAKE_PREFIX, key=lambda x: -len(x[0])):
        if s.startswith(p): return mk
    return ''

def parse_class(cl):
    cl = (cl or '').strip()
    m = re.search(r'(\d+)\s*kW', cl, re.I)
    kw = int(m.group(1)) if m else None
    twin = 'twin' in cl.lower()
    per = (kw / 0.8) if kw else None
    return {'raw': cl, 'kw': kw, 'twin': twin,
            'per': per, 'pkg': (per * 2 if (per and twin) else per)}

def lev(a, b):
    if a == b: return 0
    if abs(len(a) - len(b)) > 1: return 2
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

def load():
    app = list(csv.DictReader(open('tmp/app_units.tsv', encoding='utf-8'), delimiter='\t'))
    nes = list(csv.DictReader(open(
        '/agent/stored_files/cms9895wr0spw07adlud3skli_nes-big-iron_1.csv', encoding='utf-8-sig')))
    for r in nes:
        r['ser'], r['ann'], r['flag'] = split_cell(r['serial'])
        r['cls'] = parse_class(r['classification'])
        r['hd'] = (r['hard_down'] or '').strip().lower() == 'yes'
    return app, nes
