#!/usr/bin/env python3
"""fv_nes_extract.py — split a NES serial cell into SERIAL + NOTES.

Owner's rule, verbatim:
  * The LEADING token is the serial. Everything after it is notes.
  * An UNSPACED dash is part of the serial      -> C5E02984-85, 4ZR01594-1601, 400-1
  * A SPACED dash delimits serial from notes    -> "400-1 - Prod Power" => serial 400-1
  * Slash-joined fragments continue the serial  -> C9E00579 / 581, 396970/396971
    ...but only if the fragment contains a digit ("/ Lift Gate" is prose, not serial).
  * XXX and EIP are dropped entirely - job tags, not asset facts.
  * Everything else is a real fact and goes to notes (TecnoGen S/N, Prod Power, 20',
    Loadbank, Do Not Parallel, Step Deck, EMCP 4.4, 208 V only...).
  * Whitespace is normalised on the serial (new records only). '/' and '-' are NEVER
    unified with each other.
  * Serial FORMAT IS NEVER VALIDATED (HANDOFF 8 rule 4). No length or pattern check
    gates anything here; unparseable cells are flagged for a human, never rewritten.
"""
import re

DROP = re.compile(r"\b(?:XXX|EIP)\b", re.I)
TOKEN = re.compile(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*")
SLASH = re.compile(r"\s*/\s*")

def _has_digit(s): return any(c.isdigit() for c in s)

def split_cell(cell):
    """-> (serial, [notes...], flag)  flag is None or a reason string for review."""
    orig = (cell or "").strip()
    # 1. work on a copy with parentheticals and dropped tags removed, so they can't
    #    interfere with finding the serial head
    stripped = re.sub(r"\([^)]*\)", " ", orig)
    stripped = DROP.sub(" ", stripped)

    # 2. scan the serial head left-to-right
    m = TOKEN.match(stripped.lstrip())
    if not m or not _has_digit(m.group(0)):
        # Owner rule, settled 2026-07-31: a few rows lead with the MANUFACTURER
        # ("ATLAS CopCo #3 UVC700618"). There the serial is the TRAILING token and
        # everything before it is notes. Requires >=4 chars and a digit, so the
        # unit number "#3" can never be mistaken for an identity.
        tail = [x for x in TOKEN.findall(stripped) if _has_digit(x) and len(x) >= 4]
        if tail:
            return tail[-1].upper(), _notes(orig, tail[-1]), None
        return "", [n for n in _notes(orig, "")], "NO SERIAL FOUND - needs a human"
    lead_ws = len(stripped) - len(stripped.lstrip())
    parts = [m.group(0)]
    pos = lead_ws + m.end()
    while True:
        sm = SLASH.match(stripped, pos)
        if not sm: break
        tm = TOKEN.match(stripped, sm.end())
        if not tm or not _has_digit(tm.group(0)): break   # "/ Lift Gate" stops here
        parts.append(tm.group(0))
        pos = tm.end()
    head_text = stripped[lead_ws:pos]
    serial = "/".join(p.strip() for p in parts).upper()   # whitespace normalised only
    return serial, _notes(orig, head_text), None

def _notes(orig, head_text):
    rest = orig
    if head_text:
        i = rest.find(head_text)
        if i >= 0: rest = rest[:i] + " " + rest[i + len(head_text):]
    rest = DROP.sub(" ", rest)
    frags = re.split(r"[()]", rest)          # keeps prose and paren contents in order
    out = []
    for f in frags:
        f = f.strip().strip(" -/,;").strip()
        f = re.sub(r"\s{2,}", " ", f)
        if f and not re.fullmatch(r"[\s\-/,;.]*", f):
            out.append(f)
    return out

def norm_for_match(s):
    """Comparison key only. NEVER written back to a record."""
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())
