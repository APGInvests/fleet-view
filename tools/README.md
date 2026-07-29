# FleetView dev tooling

Test + deploy tooling for the app. **Nothing here is served to the crew** —
`index.html` is the entire app; these files are never referenced by it.

## Deploy an app change

```bash
python3 fv_deploy.py pull                      # app + tooling to disk, caches blob sha
#   ...edit index.html with targeted edits...
python3 fv_deploy.py preflight -m "what changed"
#   ...one push: github create_or_update_file with paramsFile=/tmp/fv_params.json
python3 fv_deploy.py verify                    # polls until live bytes match
```

`preflight` refuses to stage anything if the invariant suite fails. That refusal
is the point: a broken push means broken phones on a show day.

## Files

| File | Purpose |
|---|---|
| `fv_deploy.py`  | Deploy driver: `pull` / `preflight` / `verify` / `status` |
| `fv_harness.js` | Loads `index.html` headless — DOM stub, Supabase mock, zero npm deps |
| `fv_assert.js`  | Tiny assertion helper |
| `fv_smoke.js`   | Standing invariant suite (96 assertions) |

## The invariants

The suite encodes the product contracts, not just syntax:

- **Status colors** — the arm's-length signal. `down` outranks everything;
  green=running, yellow=cosmetic, orange=over/near service or low fuel, red=down.
- **Per-job isolation (sacred)** — a per-job name/placement (e.g. "Coca-Cola AC")
  must never follow the asset to the next show. Asset specs, condition, photos
  and issue history do travel, forever.
- **Service math** — over / soon / ok boundaries at `warnHours`.
- **Freshness** — how stale the last check is; a DOWN unit is never "stale".
- **Scan dedup** — the license-plate model: serial or tag, case- and
  whitespace-insensitive; an unknown code returns null so add-once can fire.
- **Data round-trip** — camelCase↔snake_case and ms↔ISO must not lose data.
- **Every field optional** — a routine check with no vitals and no photo is valid.
- **People, not emails** — logs stamp "Mike R.", never a raw email.

## Adding tests for a new feature

Don't edit `fv_smoke.js`. Write a small file exporting `(app, t) => {...}`:

```js
module.exports = (app, t) => {
  app.setState({});
  t.eq(app.fn.myNewThing(1), 2, 'my new thing doubles');
};
```

Then: `python3 fv_deploy.py preflight -m "msg" --extras myfeature.js`
