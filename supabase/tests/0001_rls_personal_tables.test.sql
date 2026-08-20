-- =============================================================================
-- RLS / cross-tenant authorization tests for the Phase-2 personal tables.
--   user_profiles · body_metrics · nutrition_targets
--
-- Proves the core promise of §4.6 and Threat Model #1–#3: a logged-in user can
-- CRUD their own rows and can neither read, write, update nor delete another
-- user's rows — enforced by RLS at the database, independent of the API layer.
--
-- Run with:  supabase test db
-- =============================================================================
begin;
select plan(14);

-- ---------------------------------------------------------------------------
-- Seed two users and one row each, as the superuser (RLS is bypassed here, so
-- this is pure fixture setup — it does not exercise any policy).
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'user-a@test.local', '', now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'user-b@test.local', '', now(), now(), now());

insert into user_profiles (user_id, display_name, sex, birth_date, height_cm, activity_level, goal)
values
  ('11111111-1111-1111-1111-111111111111', 'A', 'male',   '1990-01-01', 178, 'moderate', 'maintain'),
  ('22222222-2222-2222-2222-222222222222', 'B', 'female', '1992-05-05', 165, 'light',    'lose_fat');

insert into body_metrics (user_id, weight_kg, body_fat_pct)
values
  ('11111111-1111-1111-1111-111111111111', 70.0, 18.0),
  ('22222222-2222-2222-2222-222222222222', 60.0, 24.0);

insert into nutrition_targets (user_id, bmr, tdee, calories_system, protein_g_system, fat_g_system, carbs_g_system)
values
  ('11111111-1111-1111-1111-111111111111', 1700, 2600, 2600, 150, 70, 300),
  ('22222222-2222-2222-2222-222222222222', 1400, 1900, 1600, 120, 50, 160);

-- ===========================================================================
-- Authenticate as User A (auth.uid() -> A).
-- ===========================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',  '11111111-1111-1111-1111-111111111111',
    'role', 'authenticated'
  )::text,
  true
);

-- 1. Identity comes from the JWT, not from any request field.
select is(
  auth.uid(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'auth.uid() resolves to User A from the JWT claims'
);

-- 2–4. A sees ONLY its own row in each personal table.
select is((select count(*)::int from user_profiles),      1, 'A sees exactly one profile (own)');
select is((select count(*)::int from body_metrics),       1, 'A sees exactly one body_metric (own)');
select is((select count(*)::int from nutrition_targets),  1, 'A sees exactly one nutrition_target (own)');

select is(
  (select user_id from user_profiles),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'The profile A sees is A''s own'
);

-- 5. A can insert a metric for itself.
select lives_ok(
  $$ insert into body_metrics (user_id, weight_kg) values ('11111111-1111-1111-1111-111111111111', 69.5) $$,
  'A can insert a body_metric for itself'
);

-- 6–7. WITH CHECK blocks A from writing rows owned by B (Threat Model #1).
select throws_ok(
  $$ insert into body_metrics (user_id, weight_kg) values ('22222222-2222-2222-2222-222222222222', 55.0) $$,
  '42501',
  null,
  'A cannot insert a body_metric owned by B (RLS WITH CHECK)'
);
select throws_ok(
  $$ insert into nutrition_targets (user_id, calories_system, protein_g_system, fat_g_system, carbs_g_system)
     values ('22222222-2222-2222-2222-222222222222', 9999, 10, 10, 10) $$,
  '42501',
  null,
  'A cannot insert a nutrition_target owned by B (RLS WITH CHECK)'
);

-- 8. A cannot read B's rows via a targeted query (IDOR — Threat Model #2).
select is(
  (select count(*)::int from body_metrics where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'A cannot read B''s body_metrics even by explicit user_id'
);

-- 9–10. A cannot update or delete B's rows (IDOR — Threat Model #3).
select is(
  (with upd as (
     update user_profiles set display_name = 'hacked'
     where user_id = '22222222-2222-2222-2222-222222222222' returning 1)
   select count(*)::int from upd),
  0,
  'A''s UPDATE against B''s profile affects zero rows'
);
select is(
  (with del as (
     delete from body_metrics
     where user_id = '22222222-2222-2222-2222-222222222222' returning 1)
   select count(*)::int from del),
  0,
  'A''s DELETE against B''s body_metrics affects zero rows'
);

-- ===========================================================================
-- Re-authenticate as User B and confirm symmetric isolation.
-- ===========================================================================
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',  '22222222-2222-2222-2222-222222222222',
    'role', 'authenticated'
  )::text,
  true
);

select is(
  auth.uid(),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'auth.uid() resolves to User B after re-auth'
);
select is((select count(*)::int from user_profiles), 1, 'B sees exactly one profile (own)');
select is(
  (select user_id from user_profiles),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'The profile B sees is B''s own — A''s row is invisible to B'
);

select * from finish();
rollback;
