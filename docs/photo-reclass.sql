-- ============================================================
-- PHOTO RECLASSIFICATION  --  all existing unit photos become
-- kind:'photo' placement events (owner-confirmed: no condition
-- photos exist; every shot documents placement).
--   28 photo events inserted, 13 units' photos emptied
-- Attribution is honest by construction:
--   tech_name '(migrated)'  -- a marker, not a person
--   ts now()               -- one shared transaction instant:
--     28 identical timestamps read as a batch migration, never
--     as 28 shutter presses. Capture time stays recoverable via
--     the <ms>- filename prefix / Storage created_at.
-- Idempotent: inserts are gated on the unit still holding photos,
-- and each unit's photos are emptied after its inserts. Re-run = no-op.
-- Storage URLs reused verbatim. No re-upload, no new objects.
-- ============================================================
begin;

-- ---------- 172B120067 (3 photo(s)) -> show ebe478f6-9a41-49f5-9413-566c8ff952cb ----------
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select 'f09df76d-533a-41c7-a259-e141160227bc', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/13255fe8-17ec-46d3-8c0b-bbb6a7c58b68/dfade5dd-43aa-47bd-9172-9d05468f38e2.jpg"]'::jsonb, 'photo'
from units u where u.serial = '172B120067' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '9a27248b-4f22-432b-bc79-436161a3f2d3', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/13255fe8-17ec-46d3-8c0b-bbb6a7c58b68/b6339d70-880d-4b97-b4ef-1324a61203ac.jpg"]'::jsonb, 'photo'
from units u where u.serial = '172B120067' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '0e5a40ba-0bc9-44f8-84c8-499c1ffdc1e5', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/13255fe8-17ec-46d3-8c0b-bbb6a7c58b68/933c57a3-99d6-4eff-9503-c86ba42ff517.jpg"]'::jsonb, 'photo'
from units u where u.serial = '172B120067' and coalesce(u.photos::text,'[]') <> '[]';
update units set photos = '[]'::jsonb, updated_at = now() where serial = '172B120067' and coalesce(photos::text,'[]') <> '[]';

-- ---------- 20141242 (2 photo(s)) -> show ebe478f6-9a41-49f5-9413-566c8ff952cb ----------
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '9935d2b1-6533-473e-bc2e-d7a5d55a003d', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/7215380d-e585-4a6c-84b3-708241480325/774f86d4-e2f9-4e33-a75c-fa248a6b0a1f.jpg"]'::jsonb, 'photo'
from units u where u.serial = '20141242' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select 'c4eb4ac8-4689-49cc-bf7f-3f4725f6a9d7', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/7215380d-e585-4a6c-84b3-708241480325/a12375aa-8a74-4b3b-a832-860c206a065f.jpg"]'::jsonb, 'photo'
from units u where u.serial = '20141242' and coalesce(u.photos::text,'[]') <> '[]';
update units set photos = '[]'::jsonb, updated_at = now() where serial = '20141242' and coalesce(photos::text,'[]') <> '[]';

-- ---------- 72B100178 (2 photo(s)) -> show ebe478f6-9a41-49f5-9413-566c8ff952cb ----------
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select 'd3505a53-e7bf-413a-a7d5-c6dd46cd7d31', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/1c1121a8-ffa2-4974-917f-5fe10f337df1/10c34004-2db3-4049-bd90-7855448ccd7f.jpg"]'::jsonb, 'photo'
from units u where u.serial = '72B100178' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '2e086744-6ffb-4332-bec9-fe37faaa501c', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/1c1121a8-ffa2-4974-917f-5fe10f337df1/79b7e920-bb58-41c4-a07b-204840bea0ea.jpg"]'::jsonb, 'photo'
from units u where u.serial = '72B100178' and coalesce(u.photos::text,'[]') <> '[]';
update units set photos = '[]'::jsonb, updated_at = now() where serial = '72B100178' and coalesce(photos::text,'[]') <> '[]';

-- ---------- 78C10202 (2 photo(s)) -> show ebe478f6-9a41-49f5-9413-566c8ff952cb ----------
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '98c1e75d-0591-4eb1-865f-65eabc2a5022', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/1b37cfd9-f74b-43e4-8d4c-53544d30180d/2d57e32e-edb0-406a-adf2-b28760972ab0.jpg"]'::jsonb, 'photo'
from units u where u.serial = '78C10202' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select 'f7cbd061-4afe-4d4a-a406-23486c2e4034', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/1b37cfd9-f74b-43e4-8d4c-53544d30180d/3938f16f-9208-40c8-aab3-2100f0dad5c7.jpg"]'::jsonb, 'photo'
from units u where u.serial = '78C10202' and coalesce(u.photos::text,'[]') <> '[]';
update units set photos = '[]'::jsonb, updated_at = now() where serial = '78C10202' and coalesce(photos::text,'[]') <> '[]';

-- ---------- 8802068 (1 photo(s)) -> show ebe478f6-9a41-49f5-9413-566c8ff952cb ----------
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select 'a2b7b7c4-6518-4d9d-94c8-0183c2e5607f', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/a3d9074c-1f03-4a75-99e0-7643c82dba48/fe7eb650-e5f7-429f-81f0-570b3bfb8030.jpg"]'::jsonb, 'photo'
from units u where u.serial = '8802068' and coalesce(u.photos::text,'[]') <> '[]';
update units set photos = '[]'::jsonb, updated_at = now() where serial = '8802068' and coalesce(photos::text,'[]') <> '[]';

-- ---------- C12532 (1 photo(s)) -> show ebe478f6-9a41-49f5-9413-566c8ff952cb ----------
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select 'e55ce24b-6bd7-4fbd-9fab-9781f5f32dd7', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/b722f59a-1237-4c5f-9e5b-7702e9cf887e/4decf8c4-076c-4968-b639-d057fb543491.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'C12532' and coalesce(u.photos::text,'[]') <> '[]';
update units set photos = '[]'::jsonb, updated_at = now() where serial = 'C12532' and coalesce(photos::text,'[]') <> '[]';

-- ---------- D1970145 (2 photo(s)) -> show ebe478f6-9a41-49f5-9413-566c8ff952cb ----------
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '80aa60aa-a4b2-499e-a9d6-eacebbc09704', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/24bd16f7-6a0f-47c2-8460-6b340caf56c7/7c97ec1f-a09c-4403-8bc6-29913b547982.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'D1970145' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select 'ac472f9e-ae98-4de0-bd40-fdc60f2e2932', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/24bd16f7-6a0f-47c2-8460-6b340caf56c7/8e85dcd6-654e-42c1-ae5d-463b0bd7f50c.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'D1970145' and coalesce(u.photos::text,'[]') <> '[]';
update units set photos = '[]'::jsonb, updated_at = now() where serial = 'D1970145' and coalesce(photos::text,'[]') <> '[]';

-- ---------- FQ08006 (1 photo(s)) -> show ebe478f6-9a41-49f5-9413-566c8ff952cb ----------
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '45b13211-f9b3-46cc-afa3-dc506beea519', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/df6acf2b-bfc8-455c-aa36-e773aaf321ed/d63c644b-e83d-4d8a-ada9-de93acc7e2ba.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'FQ08006' and coalesce(u.photos::text,'[]') <> '[]';
update units set photos = '[]'::jsonb, updated_at = now() where serial = 'FQ08006' and coalesce(photos::text,'[]') <> '[]';

-- ---------- FQ08009 (2 photo(s)) -> show ebe478f6-9a41-49f5-9413-566c8ff952cb ----------
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '069ae06f-5209-4bc0-a124-0a332236bb20', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/a6d35290-ec7b-4676-8d82-16446ff0f847/3c167dc8-b3f5-4da7-ba29-25550eb04813.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'FQ08009' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '3022f249-49c7-4a31-b38d-95b1bda491e8', u.id, 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', 'show', 'ebe478f6-9a41-49f5-9413-566c8ff952cb', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/a6d35290-ec7b-4676-8d82-16446ff0f847/bf4ff531-55bf-46df-bcee-ddad0df0a88e.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'FQ08009' and coalesce(u.photos::text,'[]') <> '[]';
update units set photos = '[]'::jsonb, updated_at = now() where serial = 'FQ08009' and coalesce(photos::text,'[]') <> '[]';

-- ---------- X5M00213 (3 photo(s)) -> show bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8 ----------
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '9bcc88f7-54c3-4d7f-be1f-ff3ecbd07382', u.id, 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/0708eee2-c448-4121-bb8f-0333ec698286/fca8886b-4e00-4a9e-8c62-07cd69765651.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'X5M00213' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '8bbe2789-fa67-4247-801c-8f8504c01410', u.id, 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/0708eee2-c448-4121-bb8f-0333ec698286/550011e7-e96d-46bd-9ea3-b5512562ab5c.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'X5M00213' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '174c702f-f678-4fb1-8a48-3db6ab7ed045', u.id, 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/0708eee2-c448-4121-bb8f-0333ec698286/bf08eff0-939c-42ed-86ce-b2396f986582.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'X5M00213' and coalesce(u.photos::text,'[]') <> '[]';
update units set photos = '[]'::jsonb, updated_at = now() where serial = 'X5M00213' and coalesce(photos::text,'[]') <> '[]';

-- ---------- X5M00296 (3 photo(s)) -> show bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8 ----------
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '94db3358-ad7a-4d10-b1ba-a3f6e26f0135', u.id, 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/967092de-e5ed-43b4-ae87-d0bae58a29cd/43fd3823-a1be-4bcf-9086-7e491f63b338.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'X5M00296' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '315dd734-9475-4130-99a9-76712edf0e62', u.id, 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/967092de-e5ed-43b4-ae87-d0bae58a29cd/803e4ec7-1e35-4690-93c4-00db61fcd75a.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'X5M00296' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select 'b4e196b2-be4a-4862-a7ae-e2d6cc40103e', u.id, 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/967092de-e5ed-43b4-ae87-d0bae58a29cd/eb4cc9bc-fd54-4d95-8745-b42a146569a3.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'X5M00296' and coalesce(u.photos::text,'[]') <> '[]';
update units set photos = '[]'::jsonb, updated_at = now() where serial = 'X5M00296' and coalesce(photos::text,'[]') <> '[]';

-- ---------- X5M00357 (3 photo(s)) -> show bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8 ----------
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '457a3f49-1a32-460a-af39-db356faa78b2', u.id, 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/ce6f63c3-8a19-4fa3-bc19-70f59cb84df5/0afe8045-7b00-475b-ad8d-7eef3d693687.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'X5M00357' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '5dca4b3c-ba76-4bf2-b9d0-a68d01092de2', u.id, 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/ce6f63c3-8a19-4fa3-bc19-70f59cb84df5/e7e27b31-45eb-442d-ac7d-0599843a87e9.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'X5M00357' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '41fad5dc-31c3-4992-9630-9903c742c55d', u.id, 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/ce6f63c3-8a19-4fa3-bc19-70f59cb84df5/6f2dd5a0-a0d6-476e-8bd0-812ccfd329d7.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'X5M00357' and coalesce(u.photos::text,'[]') <> '[]';
update units set photos = '[]'::jsonb, updated_at = now() where serial = 'X5M00357' and coalesce(photos::text,'[]') <> '[]';

-- ---------- X5M00394 (3 photo(s)) -> show bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8 ----------
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select 'ea055591-6e4c-4c81-9ccb-e37d19f46213', u.id, 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/06f4373e-3a44-4deb-b900-7fcc585af1eb/054a14ba-614d-4557-b695-dd388f9a6bbc.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'X5M00394' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '16a7fdc3-0b36-4582-91de-3693eba1a50f', u.id, 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/06f4373e-3a44-4deb-b900-7fcc585af1eb/482144dd-4be9-45e1-a8cf-651cbcc6d545.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'X5M00394' and coalesce(u.photos::text,'[]') <> '[]';
insert into movements (id, unit_id, from_type, from_id, to_type, to_id, tech_name, ts, gps, photos, kind)
select '794c4017-c185-4c89-8aa1-392327a4d42e', u.id, 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', 'show', 'bc6105c4-b55b-468b-98a7-6b1e0ec6f2a8', '(migrated)', now(), null, '["https://eujgglfcpdfgskyqfggg.supabase.co/storage/v1/object/public/unit-photos/units/06f4373e-3a44-4deb-b900-7fcc585af1eb/b8cfb6ba-965a-42e9-990e-246c9f3fb4a5.jpg"]'::jsonb, 'photo'
from units u where u.serial = 'X5M00394' and coalesce(u.photos::text,'[]') <> '[]';
update units set photos = '[]'::jsonb, updated_at = now() where serial = 'X5M00394' and coalesce(photos::text,'[]') <> '[]';

commit;

-- ---------- verification (runs post-commit: durable truth, re-runnable alone) ----------
-- expect: photo_events=28, migrated=28, units_still_holding_photos=0
select
  (select count(*) from movements where kind='photo' and tech_name='(migrated)') as photo_events,
  (select count(*) from movements where kind='photo' and tech_name='(migrated)' and gps is null) as migrated,
  (select count(*) from units where coalesce(photos::text,'[]') <> '[]') as units_still_holding_photos;
