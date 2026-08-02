-- fv_gap_audit.sql — read-only audit of the 2026-08-01 movement-write outage.
-- Paste each block separately into the Supabase dashboard SQL editor (it shows
-- only the last result set). No DDL, no writes — safe on production.
--
-- Window: last good movement 01:47, movements.photos column created ~16:17
-- (times read off the incident data, assumed America/Chicago). Widened 15 min
-- each side. Adjust t0/t1 if the incident notes say otherwise.
--
-- What was lost in the window: EVERY movements insert — moves, placements,
-- pin-sets, and kind:'photo' placement-photo rows. Units upserts succeeded,
-- so units.location_* is CORRECT; what's missing is the event history and any
-- GPS captured in the window. Reports/issues/status_events were unaffected.

-- ============================================================
-- 1. THE TECH LIST — units on a show with suspect placement.
--    Hand this to the sweep crew. why_suspect ranks the reason.
-- ============================================================
with win as (select timestamptz '2026-08-01 01:30-05' as t0,
                    timestamptz '2026-08-01 16:30-05' as t1),
last_mv as (
  select distinct on (unit_id) unit_id, to_type, to_id, ts
  from movements
  where kind is distinct from 'photo'
  order by unit_id, ts desc),
last_pin as (
  select distinct on (unit_id) unit_id, ts as pin_ts
  from movements
  where kind is distinct from 'photo' and gps is not null
  order by unit_id, ts desc)
select
  coalesce(s.name, u.location_type)                as where_now,
  u.serial,
  (u.job_meta -> u.location_id::text) ->> 'name'   as job_label,
  (u.job_meta -> u.location_id::text) ->> 'area'   as placement,
  case
    when lm.unit_id is null
      then '1: no movement history at all'
    when lm.to_type is distinct from u.location_type
      or lm.to_id::text is distinct from u.location_id::text
      then '2: stored location disagrees with last movement — a move row was lost'
    when u.updated_at between w.t0 and w.t1
      then '3: unit written during outage — pin capture likely lost'
    when lp.pin_ts is null
      then '4: on a show with no GPS pin'
    when lp.pin_ts < w.t0 and u.updated_at >= w.t0
      then '5: pin predates outage, unit touched since'
  end                                              as why_suspect,
  lm.ts        as last_movement_at,
  lp.pin_ts    as last_pin_at,
  u.updated_at
from units u
cross join win w
left join last_mv  lm on lm.unit_id::text = u.id::text
left join last_pin lp on lp.unit_id::text = u.id::text
left join shows s on s.id::text = u.location_id::text and u.location_type = 'show'
where u.location_type = 'show'
  and (   lm.unit_id is null
       or lm.to_type is distinct from u.location_type
       or lm.to_id::text is distinct from u.location_id::text
       or u.updated_at between w.t0 and w.t1
       or lp.pin_ts is null
       or (lp.pin_ts < w.t0 and u.updated_at >= w.t0))
order by where_now, placement nulls last, u.serial;

-- ============================================================
-- 2. FLEET-WIDE mismatch (includes units now at shops / in transit /
--    unassigned) — for the archive's integrity notes, not the sweep.
-- ============================================================
with last_mv as (
  select distinct on (unit_id) unit_id, to_type, to_id, ts
  from movements
  where kind is distinct from 'photo'
  order by unit_id, ts desc)
select u.serial, u.location_type, u.location_id, u.updated_at,
       lm.to_type as movement_says_type, lm.to_id as movement_says_id, lm.ts
from units u
left join last_mv lm on lm.unit_id::text = u.id::text
where lm.unit_id is null
   or lm.to_type is distinct from u.location_type
   or lm.to_id::text is distinct from u.location_id::text
order by u.location_type, u.serial;

-- ============================================================
-- 3. SURVIVING ACTIVITY in the window — checks / issues / status
--    changes written while movements were failing. Cross-evidence:
--    a check stamped with a show_id proves the unit was believed
--    there at that moment even though its move row is gone.
-- ============================================================
with win as (select timestamptz '2026-08-01 01:30-05' as t0,
                    timestamptz '2026-08-01 16:30-05' as t1)
select a.kind, s.name as show, u.serial, a.ts, a.tech_name
from (
  select 'check'  as kind, unit_id, show_id, ts, tech_name from reports
  union all
  select 'issue',          unit_id, show_id, ts, tech_name from issues
  union all
  select 'status',         unit_id, null,    ts, tech_name from status_events
) a
cross join win w
left join units u on u.id::text  = a.unit_id::text
left join shows s on s.id::text  = a.show_id::text
where a.ts between w.t0 and w.t1
order by a.ts;

-- ============================================================
-- 4. ORPHANED PLACEMENT PHOTOS — uploads landed in Storage during
--    the window but their parent movement row was lost. The image
--    files survive; the unit linkage does not (the path holds the
--    dead movement id, which appears nowhere else). Match manually
--    by timestamp against block 3. Fetch any file at:
--    https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/<name>
-- ============================================================
with win as (select timestamptz '2026-08-01 01:30-05' as t0,
                    timestamptz '2026-08-01 16:30-05' as t1)
select o.name, o.created_at, split_part(o.name, '/', 2) as lost_movement_id
from storage.objects o
cross join win w
where o.bucket_id = 'unit-photos'
  and o.name like 'movements/%'
  and o.created_at between w.t0 and w.t1 + interval '2 hours'
  and not exists (select 1 from movements m
                  where m.id::text = split_part(o.name, '/', 2))
order by o.created_at;
