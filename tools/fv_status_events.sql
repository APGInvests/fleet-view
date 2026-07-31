-- fv_status_events.sql — Part 2 schema. Run in the Supabase dashboard SQL editor.
-- Idempotent: safe to re-run.
--
-- WHY A NEW TABLE, not a column on `reports`:
--   A status change is not a check. If it were stored as a report row it would land
--   in the freshness clock (marking a unit "running" would make it look recently
--   inspected) and in the hours-derivation path. Reusing `movements` would violate
--   standing rule 1 — status is not placement. So: its own append-only table.
--
-- WHY `text` ids, not `uuid`:
--   uid() in index.html is
--     (p='id')=>(window.crypto&&crypto.randomUUID)?crypto.randomUUID():(p+'_'+...)
--   The fallback branch produces a NON-uuid string (e.g. "id_lz4k1x_a93kd"), which a
--   uuid column would reject. crypto.randomUUID needs a secure context, so the
--   fallback is reachable on a plain-http origin. `text` accepts both shapes and
--   cannot fail. See the note in step 3 about what the existing tables use.

-- ---------------------------------------------------------------- 1. the table
create table if not exists status_events (
  id         text        primary key,
  unit_id    text        not null,
  engine     text,                      -- 'A' | 'B' | null (single-engine unit)
  status     text        not null,      -- 'running' | 'staged' | 'down'
  tech_name  text,
  ts         timestamptz not null default now()
);

create index if not exists status_events_unit_idx on status_events (unit_id);
create index if not exists status_events_ts_idx   on status_events (ts desc);

-- ---------------------------------------------------------------- 2. RLS
-- Same posture as every other table: any authenticated user shares one fleet.
alter table status_events enable row level security;

drop policy if exists status_events_all on status_events;
create policy status_events_all on status_events
  for all to authenticated using (true) with check (true);

-- ================================================================
-- 3. VERIFICATION — paste all three result sets back
-- ================================================================

-- 3a) columns. Expect exactly 6 rows, in this order and with these types:
--     id text | unit_id text | engine text | status text | tech_name text | ts timestamp with time zone
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'status_events'
order by ordinal_position;

-- 3b) RLS on, and exactly one policy. Expect rls_enabled = true, one row named
--     status_events_all with cmd = ALL.
select c.relname, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relname = 'status_events' and n.nspname = 'public';

select tablename, policyname, cmd
from pg_policies
where tablename = 'status_events';

-- 3c) What the EXISTING tables use for their id columns. Not a gate — I want to know
--     whether they are uuid, because if they are, the uid() fallback above would fail
--     on a non-secure origin. Purely diagnostic; nothing depends on the answer.
select table_name, column_name, data_type
from information_schema.columns
where table_name in ('units','reports','issues','movements','status_events')
  and column_name in ('id','unit_id')
order by table_name, column_name;
