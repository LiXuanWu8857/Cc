-- =============================================================================
-- RLS / cost-guard tests for the Phase-5 tables.
--   scan_records · ai_cost_budget · reserve_ai_budget()
--
-- Proves per-user isolation of scans and budget, and that the atomic budget
-- reservation denies once the daily request cap is hit (§4.12).
--
-- Run with:  supabase test db
-- =============================================================================
begin;
select plan(9);

insert into auth.users (id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'a@test.local', '', now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'b@test.local', '', now(), now(), now());

insert into scan_records (user_id, kind, object_path) values
  ('11111111-1111-1111-1111-111111111111', 'nutrition_label',
   '11111111-1111-1111-1111-111111111111/nutrition_label/a-scan'),
  ('22222222-2222-2222-2222-222222222222', 'nutrition_label',
   '22222222-2222-2222-2222-222222222222/nutrition_label/b-scan');

-- ===========================================================================
-- User A.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

-- 1-2. Scan isolation.
select is((select count(*)::int from scan_records), 1, 'A sees only its own scan');
select is(
  (select count(*)::int from scan_records where user_id = '22222222-2222-2222-2222-222222222222'),
  0, 'A cannot see B''s scan');

-- 3. Cannot create a scan owned by B.
select throws_ok(
  $$ insert into scan_records (user_id, kind, object_path)
     values ('22222222-2222-2222-2222-222222222222', 'receipt', 'x/y/z') $$,
  '42501', null, 'A cannot create a scan owned by B');

-- 4-6. Atomic budget reservation: cap of 2 requests/day.
select is((select reserve_ai_budget(2, 100::numeric, 1::numeric)), true,
  'first reservation within budget succeeds');
select is((select reserve_ai_budget(2, 100::numeric, 1::numeric)), true,
  'second reservation within budget succeeds');
select is((select reserve_ai_budget(2, 100::numeric, 1::numeric)), false,
  'third reservation is denied (request cap reached)');

-- 7. A sees only its own budget row.
select is((select count(*)::int from ai_cost_budget), 1, 'A sees only its own budget row');

-- ===========================================================================
-- User B — independent budget.
-- ===========================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select is((select reserve_ai_budget(2, 100::numeric, 1::numeric)), true,
  'B has an independent budget and can reserve');
select is((select count(*)::int from ai_cost_budget), 1, 'B sees only its own budget row');

select * from finish();
rollback;
