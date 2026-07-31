-- fv_alert_snapshot.sql
-- Read-only. Captures exactly the inputs the four alert predicates read, so the
-- before/after counts can be COMPUTED by running the real app code against one
-- snapshot — the old build and the new build, same data — rather than estimated.
--
-- No DDL, no writes. Three small result sets; paste all three back.

-- ============================================================
-- A) units — every field the predicates touch
-- ============================================================
select id, serial, klass, kw, op_status, location_type, location_id,
       current_hours, service_due_hours, engines
from units
order by klass, serial;

-- ============================================================
-- B) per unit + engine: latest check time, latest hours read, latest fuel read
--    (~one row per engine, not per check — small)
-- ============================================================
with r as (
  select unit_id, engine, ts, engine_hours, fuel_level_pct,
         row_number() over (partition by unit_id, engine order by ts desc) as rn_any,
         row_number() over (partition by unit_id, engine
                            order by (engine_hours is not null) desc, ts desc) as rn_hrs,
         row_number() over (partition by unit_id, engine
                            order by (fuel_level_pct is not null) desc, ts desc) as rn_fuel
  from reports
)
select unit_id, engine,
       max(case when rn_any  = 1 then ts end)                                   as last_check_ts,
       max(case when rn_hrs  = 1 and engine_hours    is not null then engine_hours    end) as last_hours,
       max(case when rn_fuel = 1 and fuel_level_pct  is not null then fuel_level_pct  end) as last_fuel,
       max(case when rn_fuel = 1 and fuel_level_pct  is not null then ts end)     as last_fuel_ts
from r
group by unit_id, engine
order by unit_id, engine nulls first;

-- ============================================================
-- C) open issues — severity drives the red/orange colour
-- ============================================================
select unit_id, engine, severity
from issues
where coalesce(resolved, false) = false
order by unit_id;

-- ============================================================
-- D) the current badge number, computed the OLD way, as a cross-check on 57
--    (old rule: everything filtered to units on a show)
-- ============================================================
select count(*) as on_job_units
from units where location_type = 'show';
