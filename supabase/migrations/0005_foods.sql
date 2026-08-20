-- =============================================================================
-- 0005  foods · food_nutrition · food_barcodes
-- -----------------------------------------------------------------------------
-- The food catalogue. Two visibility classes coexist (§4.6, §4.13):
--   * OFFICIAL foods  — shared/public, readable by everyone, writable ONLY by
--                       controlled system jobs (service_role bypasses RLS).
--   * USER foods      — private to their creator; a manual/scan candidate that
--                       the user may use in their own meals but which must NOT
--                       pollute the shared catalogue (§4.10).
-- A regular user can therefore SELECT official + own, and write only own.
-- =============================================================================

do $$ begin
  create type food_source_t as enum
    ('official', 'user_manual', 'barcode_import', 'scan_candidate');
exception when duplicate_object then null; end $$;

-- ------------------------------- foods ---------------------------------------
create table if not exists foods (
  id             uuid primary key default gen_random_uuid(),
  -- NULL owner  <=> official/shared food. Non-null <=> private user food.
  owner_user_id  uuid references auth.users (id) on delete cascade,
  is_official    boolean not null default false,
  name           text not null,
  brand          text,
  source         food_source_t not null default 'user_manual',
  default_serving_g numeric(7, 2),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint chk_name_present check (length(btrim(name)) > 0),
  constraint chk_default_serving
    check (default_serving_g is null or (default_serving_g > 0 and default_serving_g <= 10000)),
  -- Official <=> no owner; user food <=> has owner. Keeps the two classes
  -- from ever blurring (an official row can't secretly belong to a user).
  constraint chk_official_ownership check (
    (is_official and owner_user_id is null) or
    (not is_official and owner_user_id is not null)
  )
);

create index if not exists idx_foods_owner on foods (owner_user_id);
create index if not exists idx_foods_official on foods (is_official) where is_official;
-- Cheap prefix search on name (case-insensitive) for the food picker.
create index if not exists idx_foods_name_lower on foods (lower(name));

create trigger trg_foods_updated_at
  before update on foods
  for each row execute function set_updated_at();

alter table foods enable row level security;

-- Read: official foods (public) OR the caller's own foods.
create policy foods_select_visible
  on foods for select
  using (is_official or owner_user_id = auth.uid());

-- Create: only a private food owned by the caller. Blocks creating official
-- foods and blocks assigning ownership to someone else (§4.10, TM #19).
create policy foods_insert_own
  on foods for insert
  with check (owner_user_id = auth.uid() and is_official = false);

-- Update: only own private foods; cannot promote to official or reassign.
create policy foods_update_own
  on foods for update
  using (owner_user_id = auth.uid() and is_official = false)
  with check (owner_user_id = auth.uid() and is_official = false);

create policy foods_delete_own
  on foods for delete
  using (owner_user_id = auth.uid() and is_official = false);

-- --------------------------- food_nutrition ----------------------------------
-- Canonical nutrition per 100 g. Serving-size maths is done by a fixed backend
-- function (§4.11), never trusted from the client. 1:1 with foods.
create table if not exists food_nutrition (
  food_id       uuid primary key references foods (id) on delete cascade,
  calories_kcal numeric(7, 2) not null,
  protein_g     numeric(6, 2) not null,
  fat_g         numeric(6, 2) not null,
  carbs_g       numeric(6, 2) not null,
  fiber_g       numeric(6, 2),
  sugar_g       numeric(6, 2),
  sodium_mg     numeric(8, 2),
  updated_at    timestamptz not null default now(),

  constraint chk_fn_calories check (calories_kcal >= 0 and calories_kcal <= 1000),
  constraint chk_fn_protein  check (protein_g >= 0 and protein_g <= 100),
  constraint chk_fn_fat      check (fat_g     >= 0 and fat_g     <= 100),
  constraint chk_fn_carbs    check (carbs_g   >= 0 and carbs_g   <= 100),
  constraint chk_fn_fiber    check (fiber_g is null or (fiber_g >= 0 and fiber_g <= 100)),
  constraint chk_fn_sugar    check (sugar_g is null or (sugar_g >= 0 and sugar_g <= 100)),
  constraint chk_fn_sodium   check (sodium_mg is null or (sodium_mg >= 0 and sodium_mg <= 100000))
);

create trigger trg_food_nutrition_updated_at
  before update on food_nutrition
  for each row execute function set_updated_at();

alter table food_nutrition enable row level security;

-- Nutrition visibility mirrors the parent food's visibility.
create policy food_nutrition_select_visible
  on food_nutrition for select
  using (exists (
    select 1 from foods f
    where f.id = food_id and (f.is_official or f.owner_user_id = auth.uid())
  ));

-- Write only for the caller's own private foods.
create policy food_nutrition_insert_own
  on food_nutrition for insert
  with check (exists (
    select 1 from foods f
    where f.id = food_id and f.owner_user_id = auth.uid() and not f.is_official
  ));

create policy food_nutrition_update_own
  on food_nutrition for update
  using (exists (
    select 1 from foods f
    where f.id = food_id and f.owner_user_id = auth.uid() and not f.is_official
  ))
  with check (exists (
    select 1 from foods f
    where f.id = food_id and f.owner_user_id = auth.uid() and not f.is_official
  ));

create policy food_nutrition_delete_own
  on food_nutrition for delete
  using (exists (
    select 1 from foods f
    where f.id = food_id and f.owner_user_id = auth.uid() and not f.is_official
  ));

-- ---------------------------- food_barcodes ----------------------------------
create table if not exists food_barcodes (
  id         uuid primary key default gen_random_uuid(),
  food_id    uuid not null references foods (id) on delete cascade,
  barcode    text not null,
  created_at timestamptz not null default now(),

  constraint chk_barcode_format check (barcode ~ '^[0-9]{8,14}$'),
  constraint uq_food_barcode unique (food_id, barcode)
);

create index if not exists idx_food_barcodes_barcode on food_barcodes (barcode);

alter table food_barcodes enable row level security;

create policy food_barcodes_select_visible
  on food_barcodes for select
  using (exists (
    select 1 from foods f
    where f.id = food_id and (f.is_official or f.owner_user_id = auth.uid())
  ));

create policy food_barcodes_insert_own
  on food_barcodes for insert
  with check (exists (
    select 1 from foods f
    where f.id = food_id and f.owner_user_id = auth.uid() and not f.is_official
  ));

create policy food_barcodes_delete_own
  on food_barcodes for delete
  using (exists (
    select 1 from foods f
    where f.id = food_id and f.owner_user_id = auth.uid() and not f.is_official
  ));
