# NES import — match table for review

**Read only. Nothing has been written.** Rows identified by SERIAL on both sides; no NES row positions anywhere. Matching normalises to alphanumerics for comparison only, never written back. Classification comes from the NES alone; `config` is never evidence. Fill gaps only, so anything a person entered wins. kW to kVA at 0.8 PF. Hours, vitals and label style are never imported.

## Counts

| | |
|---|---|
| App units | 78 |
| **Matched** | **17** |
| **New from NES (insert)** | **134** — 135 NES-only rows minus `UVC700618`, held out |
| Big-iron app units with no NES row | **2** — both are flagged items |
| Small-iron app units | 59 — **no NES row by design, out of scope** |
| NES rows that failed to parse | **0** |
| Fleet after import | 78 + 134 = **212** |


> **Correction to my earlier numbers.** I first reported 58 small-iron and 14 matched. Both were wrong. Keying app records by normalised serial in a dict silently collapsed `D19701` and `D19701.` into one entry, dropping a unit — **the same dedup blindness that created that duplicate in the first place.** Fixed by grouping instead of overwriting. Correct figure is 59 small iron. The ATLAS parse then took matched from 14 to 17.


## 1. Matched units — what changes, what stays

Protected on every row: checks, issues, movements, jobMeta, photos, job assignment, hours, status.

| Serial | NES class | kVA/eng | pkg | app kw | klass | make | engines | notes appended |
|---|---|---|---|---|---|---|---|---|
| `1LS01712/14` | 400 kW Twin | 500 | 1000 | 500 *(keep)* | big | — *(blank, no rule)* | already has | No CA CARB |
| `C5E02269/70` | 400 kW Twin | 500 | 1000 | 500 *(keep)* | big | **→ CAT** | already has | 20' |
| `C5E02984-85` | 300 kW Twin | 375 | 750 | **blank → 750** | big | CAT *(keep)* | **CREATE** | 20' |
| `TGD62501` | 500 kW Twin | 625 | 1250 | 1257 *(keep)* | big | Technogen *(keep)* | **CREATE** | 150 kW Loadbank |
| `TGD62504` | 500 kW Twin | 625 | 1250 | 1257 *(keep)* | big | Technogen *(keep)* | **CREATE** | NO Loadbank |
| `TGD62507` | 500 kW Twin | 625 | 1250 | 1257 *(keep)* | **small → big** | Technogen *(keep)* | **CREATE** | 100kW Loadbank |
| `UVC700616` | 560 kW | 700 | 700 | 700 *(keep)* | big | **→ Atlas Copco** | none | ATLAS CopCo #2 |
| `UVC700617` | 560 kW | 700 | 700 | 700 *(keep)* | **small → big** | **→ Atlas Copco** | none | ATLAS CopCo #2 |
| `UVC700619` | 560 kW | 700 | 700 | 700 *(keep)* | big | **→ Atlas Copco** | none | ATLAS CopCo #4 |
| `X5M00207` | 500 kW | 625 | 625 | 625 *(keep)* | **small → big** | **→ CAT** | none | — |
| `X5M00213` | 500 kW | 625 | 625 | 625 *(keep)* | big | **→ CAT** | none | — |
| `X5M00296` | 500 kW | 625 | 625 | 625 *(keep)* | big | **→ CAT** | none | — |
| `X5M00306` | 500 kW | 625 | 625 | 625 *(keep)* | big | **→ CAT** | **none — config trap** | — |
| `X5M00357` | 500 kW | 625 | 625 | 625 *(keep)* | big | **→ CAT** | none | — |
| `X5M00388` | 500 kW | 625 | 625 | 625 *(keep)* | big | **→ CAT** | **none — config trap** | — |
| `X5M00394` | 500 kW | 625 | 625 | 625 *(keep)* | big | **→ CAT** | none | — |
| `X5M00446` | 500 kW | 625 | 625 | 625 *(keep)* | big | **→ CAT** | **none — config trap** | — |

### `X5M00207` — the row with the most going on

- **klass** `small` → **`big`** (NES: 500 kW, and the NES is authoritative on classification)
- **make** blank → **`CAT`** (X5M prefix)
- **kw** stays `625`; the derived package figure is also 625, so there is nothing to fill and nothing to argue about
- **engines** none — NES says single
- untouched: its 2 checks, its job assignment, its hours

Both changes land on the one row and agree with each other.


## 2. Flagged — surfaced, never resolved

### a. Transposed serial

`UCV700618` (app, big, 700 kVA, 1 check) vs `UVC700618` (NES, ATLAS CopCo #3). Every other unit in the family is **UVC** — 616, 617 and 619 all exist and now match cleanly. `UCV` appears exactly once.

**Not auto-corrected.** It stays an unmatched app unit, and its NES row is **held out of the insert set** — otherwise correcting the serial later would leave you with three records instead of one.

### b. Probable duplicate

| Serial | make | model | hours | checks |
|---|---|---|---|---|
| `D19701` | Yamabiko | DGK15FL | 3,566 | 0 |
| `D19701.` | Yamakibo | DGK15FL | **407,366** | 1 |

Trailing period defeated dedup. Same model, same 15 kW, makes differing by one letter. **407,366 hours is not physical** — about 46 years of continuous running. Both small iron, so neither is in the import's path. No merge, no delete.

### c. NES says big iron, app says small

| Serial | app kw | NES | Change |
|---|---|---|---|
| `TGD62507` | 1257 | 500 kW Twin | **klass → big**, **engines CREATE** |
| `UVC700617` | 700 | 560 kW | **klass → big** |
| `X5M00207` | 625 | 500 kW | **klass → big** |

`TGD62507` is both a klass change and an engines gap. `UVC700617` only became visible once the ATLAS rows parsed.

### d. Orphan — two records, one machine

`C5E02269/70` holds engines A+B at 500 kVA each with 6 checks and the note "2269 - gen A / 2270 - gen B". `C5E02270` still exists separately with **2 checks** and `config=TwinPak`. The NES has one row, `C5E02269-70` (400 kW Twin → 500 kVA per engine, exactly what the twin already holds), so `C5E02270` has no NES row of its own. **The import skips it entirely.** No merge, no delete.

### e. Config trap, fired for real

| Serial | config | NES | Action |
|---|---|---|---|
| `1LS01712/14` | TwinPak | 400 kW Twin | already has engines |
| `C5E02269/70` | TwinPak | 400 kW Twin | already has engines |
| `C5E02984-85` | TwinPak | 300 kW Twin | engines CREATE |
| `TGD62501` | TwinPak | 500 kW Twin | engines CREATE |
| `X5M00306` | TwinPak | 500 kW | **SINGLE — no engines** |
| `X5M00388` | TwinPak | 500 kW | **SINGLE — no engines** |
| `X5M00446` | TwinPak | 500 kW | **SINGLE — no engines** |
| `C5E02270` | TwinPak | no NES row | **skipped, see (d)** |

`X5M00306`, `X5M00388` and `X5M00446` carry `config=TwinPak` while the NES calls them 500 kW **singles**; two of them literally say "On trailer with…" each other. Two 500s on a shared chassis is not a twin. **No engines created on any of them**, and this becomes a standing assertion.


## 3. New records from the NES

**134 inserts** (the 135th, `UVC700618`, is held out — see 2a), all unassigned, blank hours, no vitals, label style unset.

- **44** twins receive an engines object with per-engine kVA from the classification
- **21** import as `down` (NES hard-down), the other 114 as `staged`
- derived make: **CAT** 54, **(blank)** 32, **HiPower** 32, **Technogen** 10, **Atlas Copco** 5, **Cummins** 2


## 4. Projected alerts after the import

| Section | Delta | Why |
|---|---|---|
| Overdue for a check | **+0** | not on a job, not running |
| Low fuel | **+0** | no fuel reading, not running |
| Service due/over | **+0** | blank hours means no countdown |
| Hard down | **+21** | fires fleet-wide, which is the point |

**Exactly +21, all known-dead machines.** Zero matched units are NES hard-down, so the import never overwrites an observed status.


## 5. Serial collision surface — the number you asked for

| | |
|---|---|
| Serials after import | 213 |
| **Serials within one character of another** | **127 of 213 = 60%** |
| One-character pairs | 235 |
| Identical after normalising | 1 |


**60% of the fleet has a neighbour one keystroke away.** Not a long tail — the fleet is built from dense sequential families, so this is structural and permanent:

| Family | One-char pairs |
|---|---|
| `U` | 85 |
| `TGD` | 45 |
| `X` | 44 |
| `T` | 28 |
| `(numeric)` | 10 |
| `C` | 9 |

The single identical-after-normalising pair is **`D19701` / `D19701.`** — the duplicate you already flagged, and the one that fooled my own matcher.

42 of the one-character pairs straddle app and NES, including `UVC700616`/`UVC700618` and `UVC700619`/`UVC700618` — the transposition sits inside a family where every neighbour is one character away. Typing a serial from memory in that family is close to a coin flip.


## 6. Make normalisation — SEPARATE, after the import verifies

Every one of these **overwrites an existing value**, which the import's fill-gaps-only rule forbids. Inside the import, that rule would stop meaning anything. So: its own statement, run separately.

| From | To | Records |
|---|---|---|
| `Cummings` | `Cummins` | `G150859135` |
| `TechnoGen` | `Technogen` | `FQ08006`, `FQ08008` |
| `TecnoGen` | `Technogen` | `FQ08009` |
| `Yamakibo` | `Yamabiko` | `D19701.` |
| `Cat` | `CAT` | `28B10440` |
| `Sindawa` | `Shindaiwa` | `D1410656` |

**7 records.** Idempotent.

```sql
-- Run ONLY after the import is verified. These are overwrites, by design.
update units set make='Cummins',   updated_at=now() where make='Cummings';
update units set make='Technogen', updated_at=now() where make in ('TechnoGen','TecnoGen');
update units set make='Yamabiko',  updated_at=now() where make='Yamakibo';
update units set make='CAT',       updated_at=now() where make='Cat';
update units set make='Shindaiwa', updated_at=now() where make='Sindawa';

-- verify: none of the six folded spellings should remain
select make, count(*) from units where coalesce(make,'')<>'' group by make order by count(*) desc;
```

### A sixth cluster this import would create

`X1CH30847` already reads **`Hipower`**. The prefix rule derives **`HiPower`** for the 32 incoming U122/U121 rows. Never-overwrite means both spellings end up in the fleet — a new inconsistency, created by this import, of exactly the kind you just asked me to clean up. Either derive `Hipower` to match what exists, or add `update units set make='HiPower' where make='Hipower';` above. **Not decided, not applied.**


## 7. What `kw` means on a twin — audit, no change made

You spotted this and it is real. After the import, `kw` carries two different meanings across six twins:

| Serial | NES package | app `kw` | Reads as |
|---|---|---|---|
| `1LS01712/14` | 1000 | 500 *(keep)* | **per-engine** |
| `C5E02269/70` | 1000 | 500 *(keep)* | **per-engine** |
| `TGD62501` | 1250 | 1257 *(keep)* | package |
| `TGD62504` | 1250 | 1257 *(keep)* | package |
| `TGD62507` | 1250 | 1257 *(keep)* | package |
| `C5E02984-85` | 750 | blank → **750** | package |

### Q1. Everywhere `kw` is READ

Audited every occurrence, not recalled:

| Surface | Uses `kw` | Effect of a wrong value |
|---|---|---|
| `byKva` sort | yes | a 1000 kVA twin sorts in among the 500s |
| `assetLabel` card headline | yes, when the unit has no per-job name | card reads "500 kVA · VIP South" |
| `paneInfo` Rating row | yes | Info tab shows 500 |
| Job-detail search haystack | yes | searching "1000 kva" misses it |
| Fleet/scan search + result subtitle | yes | same |
| **Per-engine load %** | **NO** | `engKva(u,e)` returns `engines[e].kvaEach` on a twin and never reads `kw`. `logVitals` and `saveVitals` both go through it. |
| **Service math** | **NO** | per-engine targets and derived hours only |
| **Alerts, status colours** | **NO** | — |
| **End-of-show report** | **NO** | it prints serial, make/model, status, hours, service remaining and issues. **No rating at all.** |

**Blast radius is display, sort and search. Nothing computational.** Load % was the one that would have mattered and it is already clean, because `kvaEach` took over that job when the engines layer shipped.

### Q2. Does filling `C5E02984-85` with 750 deepen the split?

**No — it joins the majority.** Counting all six twins rather than the three in your list: **three already hold a package figure** (the TGDs at 1257), and filling this one makes it **four package versus two per-engine**. It also matches your instinct that `kw` should be the chassis rating.

Leaving it blank is worse than either side. `byKva` maps blank to `Infinity`, so the unit sorts to the **bottom** of every job and fleet list, its card headline falls back to make/model with no rating, and the Info tab shows a dash. A blank is not neutral here — it is a third behaviour.

So: **fill it in the import** (gap-fill, correct), and if you want `kw` to mean package everywhere, that is a **two-record overwrite** belonging in the separate statement:

```sql
-- NOT part of the import. Overwrites, run alongside the make normalisation.
update units set kw=1000, updated_at=now() where serial='1LS01712/14' and kw=500;
update units set kw=1000, updated_at=now() where serial='C5E02269/70' and kw=500;
```

The three TGDs stay at **1257**, not 1250: someone read real nameplates and that beats the conversion.
