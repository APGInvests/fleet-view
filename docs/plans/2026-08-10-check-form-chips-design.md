# Check-form chips — design proposal (no build)

Status: proposed, awaiting go/no-go. Companion to the shadow-UI finding from the
2026-08-10 three-archive analysis: of 189 check notes, 81 are a typed "all good"
button, 10 are defect reports that never became issue rows, 9 are gauge-broken
flags, 10 are hours-only markers. The notes box is doing the work of three
missing affordances. This proposes the three, under the standing rules: nothing
blocks, nothing becomes required, happy-path taps go down.

## The three, and what they are

Only one of the three is actually a new chip. One is a placement fix to an
existing control, and one is a new lightweight flag. Calling that out up front
because building three new UI elements when one exists already would be the
wrong version of this.

### 1. "All good" — a real chip

**Where:** a single ghost chip directly above the Condition/notes field:
`[ ✓ All good ]`. Tapping fills nothing else and clears nothing — it toggles on,
turns green, done. Notes stay visible; a tech can chip AND type.

**Writes:** `reports.condition_ok = true` — one new nullable boolean column.
Not a canned note string: 81 typed variants ("Running clean", "Running
cleannnnn", "Runnin smoooth") prove the demand, and the point of capturing it
is to *query* it later (per-unit "last positively confirmed OK" is a real
maintenance signal). A note string would keep it as free text and we'd be
parsing "cleannnn" spellings forever. Null means "not asserted" — same
semantics as every other field: blank is not-observed, never "not OK".

**Tap cost:** happy path today = fill vitals, type "Running clean" (15–25
keystrokes), Save. After = fill vitals, 1 tap, Save. Strictly down. A tech who
ignores the chip has an unchanged form.

### 2. "Off / staged today" — NOT a new chip. Fix the Status segment's position and make the form react to it.

The check form already has the Running / Staged / Down segment, prefilled from
current status. The fake-zero problem (hz=0, volts=0 logged on off units, 6+
checks across the archives) happens because the segment sits at the **bottom**
of the form: the tech walks up to an off unit, the form shows a full vitals
grid, they dutifully type zeros, and only then reach the status control.
`rangeFlags` already keys off the segment (`vsegVal !== 'running'`) — the form
knows; it just learns too late.

**Change:** move the Status segment to the top, directly under the identity
card. When the segment is `staged` or `down`, the electrical vitals collapse
(voltage, amps, Hz, kW, coolant, oil psi, fuel psi) behind a one-line note:
*"Not running — electrical vitals n/a."* Fields observable on an off unit stay:
engine hours, fuel %, battery V, DEF %, notes, photos. Flipping back to Running
restores the grid instantly, nothing typed is lost (collapse hides, never
clears).

**Suppress vs mark-N/A:** suppress. No sentinel values, no per-field N/A
writes. The blank stays "not observed" and the check's status context says
*why* — a reader (and the archive tool) sees staged + blank electricals and the
row explains itself. Writing explicit N/A markers would be a second schema for
information the status already carries.

**Writes:** nothing new. Zero columns. This is the whole reason it should ship
first among the three.

**Tap cost:** unchanged for running units (segment was already there, still
prefilled). For off units, taps go *down* — one segment tap replaces typing a
row of zeros, and 7 irrelevant fields leave the screen.

### 3. "Gauge broken" — one chip, per-vital via a picker, one column

Nine notes across three shows flag broken or untrusted instruments (six of them
oil-pressure gauges). Today a blank oil psi is ambiguous: not observed, or
unobservable? Two OSL issues are literally titled "…or incorrect gauge."

**Where:** one small ghost chip under the vitals grids: `[ ⚠ Gauge broken… ]`.
NOT a toggle on every field label — nine per-field affordances is clutter on
every check for a case that occurs on ~2% of them. Tapping opens a small sheet
listing the vitals (Volts · Amps · Hz · kW meter · Coolant · Oil psi · Fuel psi
· Fuel % · Batt V · DEF · Hour meter); tap the broken one(s), done. The chosen
fields show a struck-through label on the form so the blank reads as deliberate.

**Writes:** `reports.broken_gauges jsonb` — one new nullable column, an array
of field keys (`["oil_pressure"]`). Blank vital + key present = gauge broken.
Blank vital + no key = not observed. Same row, no second table.

**Surfacing — yes, it must surface, and here is the cheap version.** A
maintenance signal nobody sees is a note with extra steps. Two derived
surfaces, no new state:

- **Unit card:** small amber chip (`oil gauge u/s`) whenever the *latest* check
  flagging a gauge is not superseded by a later check that filled that same
  field with a real value. A real reading clears the badge by construction —
  derived, nothing mutates, no "resolve" flow to build or forget. (Consistent
  with the reporting-never-mutates rule.)
- **Issues list:** do NOT auto-create issue rows. Auto-writes the tech didn't
  make are how trust dies, and six cosmetic instrument rows would bury the one
  real down. Instead, the picker sheet gets an optional secondary button —
  "Also file as issue" — prefilled title ("Oil pressure gauge inoperable"),
  severity maintenance, one tap. Tech's choice, tech's name on it.

**Tap cost:** zero on normal checks (one passive chip). Two taps when a gauge
is actually broken — versus typing "oil guage doesnt work" today.

## Schema cost — every column, all at once

| Column | Type | Nullable | Written by |
|---|---|---|---|
| `reports.condition_ok` | boolean | yes | "All good" chip |
| `reports.broken_gauges` | jsonb (array of field keys) | yes | Gauge picker |

Two columns, one idempotent migration (Andy pastes via dashboard SQL editor, per
standing practice). "Off/staged" costs zero columns. The schema gate
(20cd90c) requires both columns exist before the fields ship — migration lands
first, build second. `fv_archive.js` export of the two columns is a follow-on
edit to checks.csv/dictionary (small, same PR as the build).

## The issue-flow question, answered honestly

Does giving people chips make the notes-box-instead-of-issues problem (10
defect notes vs 6 issue rows) better or worse? **It could go either way, and
these chips only fix two-thirds of it.**

Better: 81 all-good notes and 9 gauge notes stop flowing through the notes box
— roughly 90 of the ~100 shadow-UI notes get a real home, so what's *left* in
notes is much higher-signal, and the "Also file as issue" button inside the
gauge picker is the first place the check flow has ever pointed at the issue
form.

Worse, or at least not better: the 10 free-text defect notes ("loose alternator
belt", "aftertreatment alarm", "fuel pressure low, not filling secondary
filter") are unaffected. The path of least resistance for a tech holding a
defect is still the notes box they're already typing in, and a more capable
check form arguably strengthens the habit of doing everything from one sheet.
The distinction between "note" and "issue" does not become obvious by adding
chips; it becomes obvious only when the note field itself offers promotion
("flag this note as an issue" — one tap, note becomes issue text). That
affordance is deliberately NOT in this proposal — it's the next candidate after
these three prove out, and it's parked alongside derived small-iron load,
hiding fuel_psi/DEF where inapplicable, and the void window.

## Rules check (A2)

- No new required field — both columns nullable, all three affordances optional.
- No prefilled observations — chips assert nothing until tapped; status prefill
  is system-known state, allowed.
- High-frequency tap count: down (happy path unchanged or fewer keystrokes).
- Destructive actions: none. Nothing blocks, nothing auto-writes issues.
- Status writes move nothing.

## Ship order if approved

1. Status-segment move + vitals collapse (zero schema, kills fake zeros).
2. Migration for the two columns, then "All good".
3. Gauge picker + unit-card badge (+ "Also file as issue" button).
