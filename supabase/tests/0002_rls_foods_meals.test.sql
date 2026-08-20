-- =============================================================================
-- RLS / authorization tests for the Phase-3 tables.
--   foods · food_nutrition · food_barcodes · meals · meal_items
--
-- Proves: official foods are readable by everyone but writable by no ordinary
-- user; user foods are private to their owner; a user cannot create official
-- foods nor foods owned by someone else (§4.10, TM #19); and a user cannot
-- read another user's meal items nor attach items to another user's meal
-- (TM #1/#2/#3).
--
-- Run with:  supabase test db
-- =============================================================================
begin;
select plan(13);

-- Fixed ids -----------------------------------------------------------------
--   A = 111...   B = 222...
--   FO = official food   FA = A's food   FB = B's food
--   MA = A's meal   MB = B's meal
insert into auth.users (id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'a@test.local', '', now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'b@test.local', '', now(), now(), now());

-- Official (shared) food — no owner.
insert into foods (id, owner_user_id, is_official, name, source)
values ('f0000000-0000-0000-0000-000000000000', null, true, 'Official Apple', 'official');
insert into food_nutrition (food_id, calories_kcal, protein_g, fat_g, carbs_g)
values ('f0000000-0000-0000-0000-000000000000', 52, 0.3, 0.2, 14);
insert into food_barcodes (food_id, barcode)
values ('f0000000-0000-0000-0000-000000000000', '0123456789012');

-- A's private food.
insert into foods (id, owner_user_id, is_official, name, source)
values ('fa000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
        false, 'A private food', 'user_manual');
insert into food_nutrition (food_id, calories_kcal, protein_g, fat_g, carbs_g)
values ('fa000000-0000-0000-0000-000000000000', 200, 20, 10, 5);

-- B's private food.
insert into foods (id, owner_user_id, is_official, name, source)
values ('fb000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
        false, 'B private food', 'user_manual');

-- One meal each, plus one meal_item for B (to test cross-tenant read).
insert into meals (id, user_id, meal_type)
values
  ('ma000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'lunch'),
  ('mb000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'lunch');
insert into meal_items (meal_id, user_id, food_name, quantity_g, calories_kcal, protein_g, fat_g, carbs_g)
values ('mb000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
        'B item', 100, 200, 20, 10, 5);

-- ===========================================================================
-- Authenticate as User A.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

-- 1. A sees official + own food, but not B's private food.
select is((select count(*)::int from foods), 2, 'A sees exactly official + own food');
select is(
  (select count(*)::int from foods where id = 'fb000000-0000-0000-0000-000000000000'),
  0, 'A cannot see B''s private food');

-- 2. A can read official nutrition (visibility mirrors the parent food).
select is(
  (select count(*)::int from food_nutrition where food_id = 'f0000000-0000-0000-0000-000000000000'),
  1, 'A can read official food_nutrition');

-- 3. A can resolve the official barcode.
select is(
  (select count(*)::int from food_barcodes where barcode = '0123456789012'),
  1, 'A can resolve the official barcode');

-- 4. A cannot create an OFFICIAL food (§4.10).
select throws_ok(
  $$ insert into foods (owner_user_id, is_official, name, source)
     values (null, true, 'Fake official', 'official') $$,
  '42501', null, 'A cannot create an official food (RLS)');

-- 5. A cannot create a food owned by B.
select throws_ok(
  $$ insert into foods (owner_user_id, is_official, name, source)
     values ('22222222-2222-2222-2222-222222222222', false, 'For B', 'user_manual') $$,
  '42501', null, 'A cannot create a food owned by B (RLS)');

-- 6. A can create its own private food.
select lives_ok(
  $$ insert into foods (owner_user_id, is_official, name, source)
     values ('11111111-1111-1111-1111-111111111111', false, 'A new food', 'user_manual') $$,
  'A can create its own private food');

-- 7. A can add an item to its own meal.
select lives_ok(
  $$ insert into meal_items (meal_id, user_id, food_name, quantity_g, calories_kcal, protein_g, fat_g, carbs_g)
     values ('ma000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
             'A item', 150, 300, 30, 15, 7.5) $$,
  'A can add an item to its own meal');

-- 8. A cannot attach an item to B's meal (WITH CHECK meal ownership).
select throws_ok(
  $$ insert into meal_items (meal_id, user_id, food_name, quantity_g, calories_kcal, protein_g, fat_g, carbs_g)
     values ('mb000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
             'sneaky', 100, 100, 1, 1, 1) $$,
  '42501', null, 'A cannot attach an item to B''s meal (RLS)');

-- 9. A cannot read B's meal_items.
select is(
  (select count(*)::int from meal_items where user_id = '22222222-2222-2222-2222-222222222222'),
  0, 'A cannot read B''s meal_items');

-- ===========================================================================
-- Authenticate as User B — symmetric visibility.
-- ===========================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

-- 10. B sees official + own food (not A's).
select is((select count(*)::int from foods), 2, 'B sees exactly official + own food');
select is(
  (select count(*)::int from foods where id = 'fa000000-0000-0000-0000-000000000000'),
  0, 'B cannot see A''s private food');

-- 11. B sees only its own meal_item.
select is((select count(*)::int from meal_items), 1, 'B sees exactly its own meal_item');

select * from finish();
rollback;
