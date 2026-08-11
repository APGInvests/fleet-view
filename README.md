# FleetView

Mobile-first field app for tracking a generator fleet across festival and event sites — where
every unit is, how it's running, and what needs attention, shared live across the crew.

**Live:** https://apginvests.github.io/fleet-view/
**Status:** in production with a real crew. Treat the data as production.

## What it does

- Per-show unit tracking: placement, status, movements, GPS map pins
- Vital-sign checks (volts, amps, hours, coolant, oil psi, …) — append-only, timestamped, attributed
- Issues with severity, photos, and note-to-issue promotion
- Service-hour countdowns, including per-engine tracking on TwinPak (two-engine) units
- Barcode/QR scan-to-assign with fleet-wide dedup and near-match candidates
- Alerts: hard down, service due, low fuel, overdue for a check
- Offline-tolerant: renders from a durable cache in dead zones, queues writes, replays on reconnect

## Architecture

One self-contained `index.html` (vanilla JS, no build step, no dependencies) deployed via GitHub
Pages from `main`. Backend is Supabase (Postgres + Auth + Realtime); libraries load from CDN.
`sw.js` is the offline app shell. Pushing `main` **is** the deploy.

## Repo layout

| Path | What |
|---|---|
| `index.html` | The entire app |
| `sw.js` | Service worker (offline shell) |
| `HANDOFF.md` | **Source of truth.** Architecture, sync layer, data model, standing rules, ship-verify loop |
| `tools/` | Zero-dependency invariant suite (963 assertions), preflight/deploy scripts, archive exporter |
| `docs/` | Design records, migration SQL, plans |

## Developing

Read `HANDOFF.md` first — especially §3 (sync), §4 (data model), §8 (standing rules), and §9
(ship-verify loop). Verify any change with:

```bash
python3 tools/fv_deploy.py preflight -m "what changed"
```
