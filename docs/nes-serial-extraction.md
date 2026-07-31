# NES serial extraction — review before any matching runs

**Rule applied:** the leading token is the serial, everything after is notes. An **unspaced** dash stays *inside* the serial (`C5E02984-85`, `4ZR01594-1601`, `400-1`); a **spaced** dash delimits (`400-1 - Prod Power` → serial `400-1`). Slash-joined fragments continue the serial only if they contain a digit, so `C9E00582 / 575 / Lift Gate` keeps `C9E00582/575` and sends `Lift Gate` to notes. `XXX` and `EIP` are dropped entirely. Whitespace normalised on the serial; `/` and `-` never unified. **No format validation.**

**4 rows cannot be parsed and need your decision. 80 split rows need your eye. 68 pass through unchanged.**

## 1. MUST DECIDE — the rule does not fit these 4 rows

Here the **leading token is the manufacturer, not the serial** — so "leading token is the serial" would store `ATLAS` as an identity. My extractor refused rather than guessing. The suggestion column is a **suggestion only** and has not been applied anywhere.

| Original cell | Suggested serial | Suggested notes |
|---|---|---|
| `ATLAS CopCo #2 UVC700616` | `UVC700616` | ATLAS CopCo #2 |
| `ATLAS CopCo #2 UVC700617` | `UVC700617` | ATLAS CopCo #2 |
| `ATLAS CopCo #3 UVC700618` | `UVC700618` | ATLAS CopCo #3 |
| `ATLAS CopCo #4 UVC700619` | `UVC700619` | ATLAS CopCo #4 |

Also note `ATLAS CopCo #2` appears on **two** rows (UVC700616 and UVC700617) while #3 and #4 appear once each — possibly a numbering slip in the sheet. Flagged, not touched.

## 2. Needs review — split applied (80)

| # | Original cell | → Serial | → Notes |
|---|---|---|---|
| 1 | `QSL92255/67 - 20'` | **`QSL92255/67`** | 20' |
| 2 | `QSL92263/69 - 20'` | **`QSL92263/69`** | 20' |
| 3 | `QSL974188/96 - 20'` | **`QSL974188/96`** | 20' |
| 4 | `1LS01390/91  XXX 30'` | **`1LS01390/91`** | 30' |
| 5 | `1LS01332/33  XXX 30'` | **`1LS01332/33`** | 30' |
| 6 | `1LS01478/79 30'` | **`1LS01478/79`** | 30' |
| 7 | `C9E00579 / 581  EMCP 4.4` | **`C9E00579/581`** | EMCP 4.4 |
| 8 | `C9E00317/ 318 EMCP 4.4` | **`C9E00317/318`** | EMCP 4.4 |
| 9 | `C9E00576 / 577 (20')` | **`C9E00576/577`** | 20' |
| 10 | `C9E00315 / 309  20'` | **`C9E00315/309`** | 20' |
| 11 | `C9E00582 / 575 / Lift Gate` | **`C9E00582/575`** | Lift Gate |
| 12 | `C9E00580 / 629 / (20')` | **`C9E00580/629`** | 20' |
| 13 | `C9E00574/627 20'` | **`C9E00574/627`** | 20' |
| 14 | `C9E00626 / 628` | **`C9E00626/628`** | — |
| 15 | `CBX00416-17 (20')` | **`CBX00416-17`** | 20' |
| 16 | `C5E02984-85 / (20')` | **`C5E02984-85`** | 20' |
| 17 | `1LS00652-653 20'` | **`1LS00652-653`** | 20' |
| 18 | `1LS00722-23  XXX 20'` | **`1LS00722-23`** | 20' |
| 19 | `1LS00724-28  XXX  20'` | **`1LS00724-28`** | 20' |
| 20 | `X3M00113 - does not parallel 48' stepdeck` | **`X3M00113`** | does not parallel 48' stepdeck |
| 21 | `X3M00190 - does not parallel 48' stepdeck` | **`X3M00190`** | does not parallel 48' stepdeck |
| 22 | `U21001X SWP (Do Not Parallel) 48' stepdek skid` | **`U21001X`** | SWP; Do Not Parallel; 48' stepdek skid |
| 23 | `U18803Y SWP (Do Not Parallel) 48' stepdek skid` | **`U18803Y`** | SWP; Do Not Parallel; 48' stepdek skid |
| 24 | `400-1 - Prod Power (TecnoGen S/N 18.55089)(does Parallel)` | **`400-1`** | Prod Power; TecnoGen S/N 18.55089; does Parallel |
| 25 | `400-2 - Prod Power (does parallel)` | **`400-2`** | Prod Power; does parallel |
| 26 | `1LS01715-17 / Lift Gate` | **`1LS01715-17`** | Lift Gate |
| 27 | `1LS01712-14 (No CA CARB)` | **`1LS01712-14`** | No CA CARB |
| 28 | `1LS01713-16 (20')` | **`1LS01713-16`** | 20' |
| 29 | `C5E02263-64 (20')` | **`C5E02263-64`** | 20' |
| 30 | `C5E02269-70 (20')` | **`C5E02269-70`** | 20' |
| 31 | `C5E02276-77 (40" w/ LG)` | **`C5E02276-77`** | 40" w/ LG |
| 32 | `C5E02286-87 (20')` | **`C5E02286-87`** | 20' |
| 33 | `C5E02982-83 20'` | **`C5E02982-83`** | 20' |
| 34 | `4ZR01594-1601 - 30'` | **`4ZR01594-1601`** | 30' |
| 35 | `4ZR02831-34 - 30'` | **`4ZR02831-34`** | 30' |
| 36 | `4ZR03042-43 - 30'` | **`4ZR03042-43`** | 30' |
| 37 | `1LS00683-81 - 30'` | **`1LS00683-81`** | 30' |
| 38 | `1LS01189-91 - 30'` | **`1LS01189-91`** | 30' |
| 39 | `396970/396971 (DC) (208 V only)` | **`396970/396971`** | DC; 208 V only |
| 40 | `A190484324 CUMMINS (no parallel, no AS, No CA Carb)` | **`A190484324`** | CUMMINS; no parallel, no AS, No CA Carb |
| 41 | `A190486513 CUMMINS (no parallel, no AS, No CA Carb)` | **`A190486513`** | CUMMINS; no parallel, no AS, No CA Carb |
| 42 | `B3G00213  OLD 3.2 -20' (Does Not Parallel w/ Other 500kw Units)` | **`B3G00213`** | OLD 3.2 -20'; Does Not Parallel w/ Other 500kw Units |
| 43 | `GG500109  XXX` | **`GG500109`** | — |
| 44 | `X5M00374 No ping since 12-2020` | **`X5M00374`** | No ping since 12-2020 |
| 45 | `X5M00320 XXX` | **`X5M00320`** | — |
| 46 | `X5M00418  XXX` | **`X5M00418`** | — |
| 47 | `X5M00355   XXX` | **`X5M00355`** | — |
| 48 | `X5M00534  XXX` | **`X5M00534`** | — |
| 49 | `X5M00384   XXX` | **`X5M00384`** | — |
| 50 | `X5M00357   XXX` | **`X5M00357`** | — |
| 51 | `X5M00394   XXX` | **`X5M00394`** | — |
| 52 | `GG500104  XXX` | **`GG500104`** | — |
| 53 | `T4A00754-55 (CAT)` | **`T4A00754-55`** | CAT |
| 54 | `TGD62501 (150 kW Loadbank)` | **`TGD62501`** | 150 kW Loadbank |
| 55 | `TGD62502 - (NO load bank on board)` | **`TGD62502`** | NO load bank on board |
| 56 | `TGD62503 - (100kW Loadbank)` | **`TGD62503`** | 100kW Loadbank |
| 57 | `TGD62504 (NO Loadbank)` | **`TGD62504`** | NO Loadbank |
| 58 | `TGD62505 (NO Loadbank)` | **`TGD62505`** | NO Loadbank |
| 59 | `TGD62506 (NO LOADBANK)` | **`TGD62506`** | NO LOADBANK |
| 60 | `TGD62507 (100kW Loadbank)` | **`TGD62507`** | 100kW Loadbank |
| 61 | `TGD62508 (150 kW Loadbank)` | **`TGD62508`** | 150 kW Loadbank |
| 62 | `TGD62509 (150 kW Loadbank)` | **`TGD62509`** | 150 kW Loadbank |
| 63 | `TGD62510  (150 kW Loadbank)` | **`TGD62510`** | 150 kW Loadbank |
| 64 | `TGD62511 (NO  Load bank on board)` | **`TGD62511`** | NO Load bank on board |
| 65 | `TGD62512 (NO  Load bank on board)` | **`TGD62512`** | NO Load bank on board |
| 66 | `TGD62513 (150 kW Loadbank)` | **`TGD62513`** | 150 kW Loadbank |
| 67 | `17013144 - Prod Power 500-1 (Step Deck)480 ONLY SINGLE UNIT DOES NOT PARALLEL` | **`17013144`** | Prod Power 500-1; Step Deck; 480 ONLY SINGLE UNIT DOES NOT PARALLEL |
| 68 | `17013584 - Prod Power 500-3 (Step Deck)480 ONLY SINGLE UNIT DOES NOT PARALLEL` | **`17013584`** | Prod Power 500-3; Step Deck; 480 ONLY SINGLE UNIT DOES NOT PARALLEL |
| 69 | `17013580 - Prod Power 500-2 (Step Deck)480 ONLY SINGLE UNIT DOES NOT PARALLEL` | **`17013580`** | Prod Power 500-2; Step Deck; 480 ONLY SINGLE UNIT DOES NOT PARALLEL |
| 70 | `17013722 - Prod Power 500-4 (Step Deck)480 ONLY SINGLE UNIT DOES NOT PARALLEL` | **`17013722`** | Prod Power 500-4; Step Deck; 480 ONLY SINGLE UNIT DOES NOT PARALLEL |
| 71 | `U12203309 (EIP)` | **`U12203309`** | — |
| 72 | `U12203310 (EIP)` | **`U12203310`** | — |
| 73 | `U12203258 (EIP)` | **`U12203258`** | — |
| 74 | `U12203255 (EIP)` | **`U12203255`** | — |
| 75 | `U12203254 (EIP)` | **`U12203254`** | — |
| 76 | `U12204173 DOES NOT PARALLEL` | **`U12204173`** | DOES NOT PARALLEL |
| 77 | `U12203253 (EIP)` | **`U12203253`** | — |
| 78 | `U12203260 (EIP)` | **`U12203260`** | — |
| 79 | `U12102988 (EIP)` | **`U12102988`** | — |
| 80 | `U12102877 (EIP)` | **`U12102877`** | — |

## 3. Pass-through, unchanged (68)

| # | Serial | Classification |
|---|---|---|
| 1 | `CBX00418-19` | 300 kW Twin |
| 2 | `C4G00293` | 400 kW |
| 3 | `C4G00294` | 400 kW |
| 4 | `1LS01718-21` | 400 kW Twin |
| 5 | `C5E02980-81` | 400 kW Twin |
| 6 | `X5M00216` | 500 kW |
| 7 | `X5M00526` | 500 kW |
| 8 | `X5M00387` | 500 kW |
| 9 | `X5M00328` | 500 kW |
| 10 | `X5M00375` | 500 kW |
| 11 | `T4A00750` | 500 kW |
| 12 | `X5M00528` | 500 kW |
| 13 | `X5M00312` | 500 kW |
| 14 | `X5M00443` | 500 kW |
| 15 | `X5M00514` | 500 kW |
| 16 | `GG500110` | 500 kW |
| 17 | `GG500111` | 500 kW |
| 18 | `X5M00304` | 500 kW |
| 19 | `T4A00753` | 500 kW |
| 20 | `X5M00494` | 500 kW |
| 21 | `X5M00306` | 500 kW |
| 22 | `X5M00446` | 500 kW |
| 23 | `T4A00758` | 500 kW |
| 24 | `T4A00759` | 500 kW |
| 25 | `T4A00752` | 500 kW |
| 26 | `X5M00253` | 500 kW |
| 27 | `X5M00318` | 500 kW |
| 28 | `T4A00751` | 500 kW |
| 29 | `X5M00531` | 500 kW |
| 30 | `X5M00207` | 500 kW |
| 31 | `X5M00388` | 500 kW |
| 32 | `X5M00444` | 500 kW |
| 33 | `X5M00492` | 500 kW |
| 34 | `X5M00296` | 500 kW |
| 35 | `X5M00382` | 500 kW |
| 36 | `X5M00276` | 500 kW |
| 37 | `T4A00756` | 500 kW |
| 38 | `T4A00757` | 500 kW |
| 39 | `X5M00213` | 500 kW |
| 40 | `X5M00212` | 500 kW |
| 41 | `X5M00309` | 500 kW |
| 42 | `X5M00285` | 500 kW |
| 43 | `UVC700301` | 560 kW |
| 44 | `UVC700302` | 560 kW |
| 45 | `UVC700023` | 560 kW |
| 46 | `UVC700026` | 560 kW |
| 47 | `U12203257` | 500 kW HiPower |
| 48 | `U12204164` | 500 kW HiPower |
| 49 | `U12203259` | 500 kW HiPower |
| 50 | `U12203256` | 500 kW HiPower |
| 51 | `U12204159` | 500 kW HiPower |
| 52 | `U12204165` | 500 kW HiPower |
| 53 | `U12204161` | 500 kW HiPower |
| 54 | `U12204158` | 500 kW HiPower |
| 55 | `U12203261` | 500 kW HiPower |
| 56 | `U12204163` | 500 kW HiPower |
| 57 | `U12204166` | 500 kW HiPower |
| 58 | `U12204167` | 500 kW HiPower |
| 59 | `U12204170` | 500 kW HiPower |
| 60 | `U12204169` | 500 kW HiPower |
| 61 | `U12204171` | 500 kW HiPower |
| 62 | `U12204168` | 500 kW HiPower |
| 63 | `U12204160` | 500 kW HiPower |
| 64 | `U12204162` | 500 kW HiPower |
| 65 | `U12204172` | 500 kW HiPower |
| 66 | `U12203262` | 500 kW HiPower |
| 67 | `U12102987` | 500 kW HiPower |
| 68 | `U12102989` | 500 kW HiPower |
