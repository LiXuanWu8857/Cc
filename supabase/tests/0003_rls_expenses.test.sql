-- =============================================================================
-- RLS / authorization tests for the Phase-4 tables.
--   expense_categories · expenses · food_purchases
--
-- Proves per-user isolation, and the cross-link guards: a user cannot attach
-- an expense to another user's category, nor a purchase to another user's
-- expense (TM #1/#2/#3).
--
-- Run with:  supabase test db
-- =============================================================================
begin;
select plan(11);

insert into auth.users (id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'a@test.local', '', now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'b@test.local', '', now(), now(), now());

insert into expense_categories (id, user_id, name) values
  ('caaa0000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'Groceries'),
  ('cbbb0000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'Dining');

insert into expenses (id, user_id, amount, currency, category_id) values
  ('eaaa0000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 100, 'TWD',
   'caaa0000-0000-0000-0000-000000000000'),
  ('ebbb0000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 200, 'TWD',
   'cbbb0000-0000-0000-0000-000000000000');

-- One purchase for B (seeded as superuser).
insert into food_purchases (user_id, expense_id, quantity_g, price, currency)
values ('22222222-2222-2222-2222-222222222222', 'ebbb0000-0000-0000-0000-000000000000', 500, 80, 'TWD');

-- ===========================================================================
-- Authenticate as User A.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

-- 1-2. A sees only its own categories / expenses.
select is((select count(*)::int from expense_categories), 1, 'A sees only its own category');
select is((select count(*)::int from expenses), 1, 'A sees only its own expense');

-- 3. A cannot link an expense to B's category (RLS WITH CHECK subquery).
select throws_ok(
  $$ insert into expenses (user_id, amount, currency, category_id)
     values ('11111111-1111-1111-1111-111111111111', 30, 'TWD',
             'cbbb0000-0000-0000-0000-000000000000') $$,
  '42501', null, 'A cannot attach an expense to B''s category');

-- 4. A can create an expense with its own category.
select lives_ok(
  $$ insert into expenses (user_id, amount, currency, category_id)
     values ('11111111-1111-1111-1111-111111111111', 30, 'TWD',
             'caaa0000-0000-0000-0000-000000000000') $$,
  'A can create an expense with its own category');

-- 5. A cannot read B's expenses.
select is(
  (select count(*)::int from expenses where user_id = '22222222-2222-2222-2222-222222222222'),
  0, 'A cannot read B''s expenses');

-- 6. A cannot attach a purchase to B's expense.
select throws_ok(
  $$ insert into food_purchases (user_id, expense_id, quantity_g, price, currency)
     values ('11111111-1111-1111-1111-111111111111', 'ebbb0000-0000-0000-0000-000000000000',
             100, 20, 'TWD') $$,
  '42501', null, 'A cannot attach a purchase to B''s expense');

-- 7. A can attach a purchase to its own expense.
select lives_ok(
  $$ insert into food_purchases (user_id, expense_id, quantity_g, price, currency)
     values ('11111111-1111-1111-1111-111111111111', 'eaaa0000-0000-0000-0000-000000000000',
             100, 20, 'TWD') $$,
  'A can attach a purchase to its own expense');

-- 8. A cannot read B's purchases.
select is(
  (select count(*)::int from food_purchases where user_id = '22222222-2222-2222-2222-222222222222'),
  0, 'A cannot read B''s food_purchases');

-- ===========================================================================
-- Authenticate as User B — symmetric.
-- ===========================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select is((select count(*)::int from expense_categories), 1, 'B sees only its own category');
select is((select count(*)::int from expenses), 1, 'B sees only its own expense');
select is((select count(*)::int from food_purchases), 1, 'B sees only its own purchase');

select * from finish();
rollback;
