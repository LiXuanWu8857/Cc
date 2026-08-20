-- =============================================================================
-- Seed data — loaded by `supabase db reset` after migrations.
-- A small set of OFFICIAL foods so the app has something to search/scan on a
-- fresh local database. Runs as the superuser (RLS bypassed), which is the
-- controlled path for writing official catalogue entries (§4.6/§4.7).
-- Values are per 100 g and chosen to pass the backend calorie cross-check.
-- =============================================================================

insert into foods (id, owner_user_id, is_official, name, brand, source, default_serving_g) values
  ('a0000000-0000-4000-8000-000000000001', null, true, '白飯（熟）',       null, 'official', 150),
  ('a0000000-0000-4000-8000-000000000002', null, true, '雞胸肉（熟）',     null, 'official', 120),
  ('a0000000-0000-4000-8000-000000000003', null, true, '全脂牛奶',         null, 'official', 240),
  ('a0000000-0000-4000-8000-000000000004', null, true, '香蕉',             null, 'official', 120),
  ('a0000000-0000-4000-8000-000000000005', null, true, '雞蛋（全蛋）',     null, 'official', 50)
on conflict (id) do nothing;

insert into food_nutrition (food_id, calories_kcal, protein_g, fat_g, carbs_g, fiber_g, sugar_g, sodium_mg) values
  ('a0000000-0000-4000-8000-000000000001', 130, 2.7, 0.3, 28,  0.4, 0.1, 1),
  ('a0000000-0000-4000-8000-000000000002', 165, 31,  3.6, 0,   0,   0,   74),
  ('a0000000-0000-4000-8000-000000000003', 61,  3.2, 3.3, 4.8, 0,   4.8, 43),
  ('a0000000-0000-4000-8000-000000000004', 89,  1.1, 0.3, 23,  2.6, 12,  1),
  ('a0000000-0000-4000-8000-000000000005', 155, 13,  11,  1.1, 0,   1.1, 124)
on conflict (food_id) do nothing;

-- A couple of demo barcodes (packaged items) so barcode lookup returns a
-- local hit before any external call.
insert into food_barcodes (food_id, barcode) values
  ('a0000000-0000-4000-8000-000000000003', '4710000000013'),
  ('a0000000-0000-4000-8000-000000000005', '4710000000051')
on conflict (food_id, barcode) do nothing;
