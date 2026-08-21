-- =============================================================================
-- FoodTrack — one-shot hosted setup (paste into Supabase SQL Editor, run ONCE).
-- Concatenation of migrations 0001..0011 + seed.sql, in order.
-- NOTE: 0012 (private Storage bucket + policies) is intentionally EXCLUDED.
--   The free version never uploads images, so it is not needed. Apply it
--   later via the Storage UI / a separate run when enabling image uploads,
--   to avoid the hosted 'must be owner of storage.objects' pitfall.
-- Safe on a FRESH project. Do not run twice (policies would already exist).
-- =============================================================================


-- ################################################################
-- # supabase/migrations/0001_extensions_and_helpers.sql
-- ################################################################
-- =============================================================================
-- 0001  Extensions, enums and shared helpers
-- -----------------------------------------------------------------------------
-- Foundation for the FoodTrack personal-data tables. Everything here is
-- infrastructure that later migrations depend on: UUID generation, the
-- updated_at trigger, the shared enums, and the SECURITY DEFINER audit writer.
-- =============================================================================

-- gen_random_uuid() lives in pgcrypto on older PG; ships in core on PG13+ but
-- we require the extension explicitly so the migration is portable.
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums (see 02_DATABASE_SCHEMA.md). Enums are a DB-level constraint: the
-- browser cannot smuggle an out-of-range role or goal past them.
-- -----------------------------------------------------------------------------
do $$ begin
  create type sex_t as enum ('male', 'female', 'other', 'prefer_not_to_say');
exception when duplicate_object then null; end $$;

do $$ begin
  create type activity_level_t as enum
    ('sedentary', 'light', 'moderate', 'active', 'very_active');
exception when duplicate_object then null; end $$;

do $$ begin
  create type goal_t as enum ('lose_fat', 'maintain', 'gain_muscle', 'gain_weight');
exception when duplicate_object then null; end $$;

do $$ begin
  create type target_source_t as enum ('system', 'user_override');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_result_t as enum ('success', 'failure', 'denied');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- updated_at maintenance. Set in a trigger so the client can never lie about
-- modification time.
-- -----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- audit_logs (append-only). Defined here because the SECURITY DEFINER writer
-- below depends on it. See §4.14.
-- -----------------------------------------------------------------------------
create table if not exists audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type   text not null,
  target_type  text,
  target_id    text,
  result       audit_result_t not null default 'success',
  request_id   text,
  -- Minimal, non-sensitive risk metadata only. NEVER store full request
  -- bodies, JWTs, API keys, full health data or raw images here. §4.14.
  risk_meta    jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists idx_audit_logs_actor_time
  on audit_logs (actor_user_id, created_at desc);
create index if not exists idx_audit_logs_event_time
  on audit_logs (event_type, created_at desc);

-- audit_logs is locked down: RLS on, and NO policy for regular roles, so
-- authenticated users can neither read nor write it directly. Writes go
-- through the SECURITY DEFINER function below; reads are admin/service only.
alter table audit_logs enable row level security;
-- Make append-only for everyone except the table owner / service role by
-- withholding UPDATE/DELETE grants. (Supabase `authenticated` role never gets
-- table grants here.)
revoke update, delete on audit_logs from public;

-- Controlled audit writer. Runs as owner (bypasses RLS) but only ever INSERTs
-- into audit_logs and cannot be coerced into arbitrary SQL. Callable by the
-- authenticated role so API handlers can record events for the acting user.
create or replace function log_audit_event(
  p_event_type  text,
  p_target_type text default null,
  p_target_id   text default null,
  p_result      audit_result_t default 'success',
  p_request_id  text default null,
  p_risk_meta   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_logs
    (actor_user_id, event_type, target_type, target_id, result, request_id, risk_meta)
  values
    (auth.uid(), p_event_type, p_target_type, p_target_id, p_result, p_request_id, p_risk_meta);
end;
$$;

revoke all on function log_audit_event(text, text, text, audit_result_t, text, jsonb) from public;
grant execute on function log_audit_event(text, text, text, audit_result_t, text, jsonb) to authenticated;

-- ################################################################
-- # supabase/migrations/0002_user_profiles.sql
-- ################################################################
-- =============================================================================
-- 0002  user_profiles  (Personal data — per-user RLS)
-- -----------------------------------------------------------------------------
-- One row per user: identity, activity level and goal. Weight / body fat are
-- NOT stored here — they are a sensitive time series in body_metrics (§2.1).
-- =============================================================================

create table if not exists user_profiles (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  display_name   text,
  sex            sex_t,
  birth_date     date,
  height_cm      numeric(5, 2),
  activity_level activity_level_t,
  goal           goal_t,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Sanity constraints: the browser is untrusted, so the DB re-checks bounds.
  constraint chk_height_range
    check (height_cm is null or (height_cm > 0 and height_cm <= 300)),
  constraint chk_birth_date_past
    check (birth_date is null or birth_date <= current_date),
  constraint chk_birth_date_sane
    check (birth_date is null or birth_date >= date '1900-01-01')
);

create trigger trg_user_profiles_updated_at
  before update on user_profiles
  for each row execute function set_updated_at();

-- -------------------------------- RLS ----------------------------------------
alter table user_profiles enable row level security;

-- Owner may read their own profile.
create policy user_profiles_select_own
  on user_profiles for select
  using (auth.uid() = user_id);

-- Owner may create ONLY their own row. WITH CHECK stops a caller from
-- inserting a row owned by someone else.
create policy user_profiles_insert_own
  on user_profiles for insert
  with check (auth.uid() = user_id);

-- Owner may update their own row, and cannot re-assign it to another user.
create policy user_profiles_update_own
  on user_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Owner may delete their own row.
create policy user_profiles_delete_own
  on user_profiles for delete
  using (auth.uid() = user_id);

-- ################################################################
-- # supabase/migrations/0003_body_metrics.sql
-- ################################################################
-- =============================================================================
-- 0003  body_metrics  (Sensitive data — per-user RLS, time series)
-- -----------------------------------------------------------------------------
-- Historical weight / body-fat measurements. Kept as an append-style time
-- series so history is preserved and never overwritten on the profile (§2.1).
-- Classified Sensitive (§4.13): keep out of logs, minimal API responses.
-- =============================================================================

create table if not exists body_metrics (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  measured_at  timestamptz not null default now(),
  weight_kg    numeric(5, 2),
  body_fat_pct numeric(5, 2),
  note         text,
  created_at   timestamptz not null default now(),

  -- At least one measurement must be present.
  constraint chk_metric_present
    check (weight_kg is not null or body_fat_pct is not null),
  constraint chk_weight_range
    check (weight_kg is null or (weight_kg > 0 and weight_kg <= 700)),
  constraint chk_body_fat_range
    check (body_fat_pct is null or (body_fat_pct >= 0 and body_fat_pct <= 100)),
  constraint chk_measured_at_not_future
    check (measured_at <= now())
);

create index if not exists idx_body_metrics_user_time
  on body_metrics (user_id, measured_at desc);

-- -------------------------------- RLS ----------------------------------------
alter table body_metrics enable row level security;

create policy body_metrics_select_own
  on body_metrics for select
  using (auth.uid() = user_id);

create policy body_metrics_insert_own
  on body_metrics for insert
  with check (auth.uid() = user_id);

create policy body_metrics_update_own
  on body_metrics for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy body_metrics_delete_own
  on body_metrics for delete
  using (auth.uid() = user_id);

-- ################################################################
-- # supabase/migrations/0004_nutrition_targets.sql
-- ################################################################
-- =============================================================================
-- 0004  nutrition_targets  (Personal data — per-user RLS)
-- -----------------------------------------------------------------------------
-- Daily targets. Stores BOTH the system-calculated snapshot AND any user
-- override, per §2.1. The effective value is a generated column so the DB —
-- not the client — decides which one applies. Backend recomputes the *_system
-- values from a fixed function (§4.11); the client never sends them.
-- =============================================================================

create table if not exists nutrition_targets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  effective_date    date not null default current_date,

  -- Snapshot of the inputs used, so a target row is self-explaining and
  -- reproducible even after the profile / metrics change later.
  bmr               numeric(7, 2),
  tdee              numeric(7, 2),

  -- System-calculated values (source of truth = backend calc function).
  calories_system   integer not null,
  protein_g_system  numeric(6, 2) not null,
  fat_g_system      numeric(6, 2) not null,
  carbs_g_system    numeric(6, 2) not null,

  -- Optional user overrides. NULL means "use the system value".
  calories_override  integer,
  protein_g_override numeric(6, 2),
  fat_g_override     numeric(6, 2),
  carbs_g_override   numeric(6, 2),

  -- Effective = override when present, else system. Decided in the DB.
  calories_effective  integer      generated always as
    (coalesce(calories_override, calories_system)) stored,
  protein_g_effective numeric(6, 2) generated always as
    (coalesce(protein_g_override, protein_g_system)) stored,
  fat_g_effective     numeric(6, 2) generated always as
    (coalesce(fat_g_override, fat_g_system)) stored,
  carbs_g_effective   numeric(6, 2) generated always as
    (coalesce(carbs_g_override, carbs_g_system)) stored,

  source            target_source_t not null default 'system',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Non-negative / sane bounds on every stored macro & calorie figure.
  constraint chk_calories_system   check (calories_system between 0 and 20000),
  constraint chk_protein_system    check (protein_g_system  >= 0 and protein_g_system <= 2000),
  constraint chk_fat_system        check (fat_g_system      >= 0 and fat_g_system     <= 2000),
  constraint chk_carbs_system      check (carbs_g_system    >= 0 and carbs_g_system   <= 2000),
  constraint chk_calories_override check (calories_override is null or calories_override between 0 and 20000),
  constraint chk_protein_override  check (protein_g_override is null or (protein_g_override >= 0 and protein_g_override <= 2000)),
  constraint chk_fat_override      check (fat_g_override    is null or (fat_g_override     >= 0 and fat_g_override     <= 2000)),
  constraint chk_carbs_override    check (carbs_g_override  is null or (carbs_g_override   >= 0 and carbs_g_override   <= 2000))
);

create index if not exists idx_nutrition_targets_user_active
  on nutrition_targets (user_id, effective_date desc);

-- At most one active target per user per effective_date.
create unique index if not exists uq_nutrition_targets_active
  on nutrition_targets (user_id, effective_date)
  where is_active;

create trigger trg_nutrition_targets_updated_at
  before update on nutrition_targets
  for each row execute function set_updated_at();

-- -------------------------------- RLS ----------------------------------------
alter table nutrition_targets enable row level security;

create policy nutrition_targets_select_own
  on nutrition_targets for select
  using (auth.uid() = user_id);

create policy nutrition_targets_insert_own
  on nutrition_targets for insert
  with check (auth.uid() = user_id);

create policy nutrition_targets_update_own
  on nutrition_targets for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy nutrition_targets_delete_own
  on nutrition_targets for delete
  using (auth.uid() = user_id);

-- ################################################################
-- # supabase/migrations/0005_foods.sql
-- ################################################################
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

-- ################################################################
-- # supabase/migrations/0006_meals.sql
-- ################################################################
-- =============================================================================
-- 0006  meals · meal_items  (Personal — per-user RLS)
-- -----------------------------------------------------------------------------
-- A meal groups the foods eaten at one sitting. Each meal_item stores a
-- NUTRITION SNAPSHOT computed at add-time (§2.2): later edits/deletes to the
-- underlying food never rewrite a user's history. The food_id is kept only as
-- a soft reference (on delete set null) for provenance.
-- =============================================================================

do $$ begin
  create type meal_type_t as enum ('breakfast', 'lunch', 'dinner', 'snack');
exception when duplicate_object then null; end $$;

-- ------------------------------- meals ---------------------------------------
create table if not exists meals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  meal_type   meal_type_t not null,
  -- The day this meal belongs to (used for Dashboard grouping). Distinct from
  -- consumed_at so a late-night snack can still be filed under the right day.
  consumed_on date not null default current_date,
  consumed_at timestamptz not null default now(),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint chk_consumed_on_sane
    check (consumed_on >= date '2000-01-01' and consumed_on <= current_date + 1)
);

create index if not exists idx_meals_user_day
  on meals (user_id, consumed_on desc, meal_type);

create trigger trg_meals_updated_at
  before update on meals
  for each row execute function set_updated_at();

alter table meals enable row level security;

create policy meals_select_own on meals for select
  using (auth.uid() = user_id);
create policy meals_insert_own on meals for insert
  with check (auth.uid() = user_id);
create policy meals_update_own on meals for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy meals_delete_own on meals for delete
  using (auth.uid() = user_id);

-- ----------------------------- meal_items ------------------------------------
create table if not exists meal_items (
  id           uuid primary key default gen_random_uuid(),
  meal_id      uuid not null references meals (id) on delete cascade,
  -- Denormalised owner: lets RLS check ownership without a join on every row,
  -- and a WITH CHECK below still verifies the parent meal is the caller's.
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- Soft reference to the source food; nulled if the food is later deleted so
  -- the snapshot survives (§2.2). Not used to recompute nutrition.
  food_id      uuid references foods (id) on delete set null,

  -- Snapshot of identity + amount at add-time.
  food_name    text not null,
  quantity_g   numeric(7, 2) not null,
  serving_label text,

  -- Snapshot of nutrition for the amount consumed (already scaled). These are
  -- the numbers Dashboard sums; they never change when the food changes.
  calories_kcal numeric(8, 2) not null,
  protein_g     numeric(7, 2) not null,
  fat_g         numeric(7, 2) not null,
  carbs_g       numeric(7, 2) not null,

  created_at   timestamptz not null default now(),

  constraint chk_mi_name check (length(btrim(food_name)) > 0),
  constraint chk_mi_qty  check (quantity_g > 0 and quantity_g <= 20000),
  constraint chk_mi_cal  check (calories_kcal >= 0 and calories_kcal <= 50000),
  constraint chk_mi_pro  check (protein_g >= 0 and protein_g <= 5000),
  constraint chk_mi_fat  check (fat_g     >= 0 and fat_g     <= 5000),
  constraint chk_mi_carb check (carbs_g   >= 0 and carbs_g   <= 5000)
);

create index if not exists idx_meal_items_meal on meal_items (meal_id);
create index if not exists idx_meal_items_user on meal_items (user_id);

alter table meal_items enable row level security;

-- Read own items.
create policy meal_items_select_own on meal_items for select
  using (auth.uid() = user_id);

-- Insert: item must be the caller's AND attached to a meal the caller owns.
-- The meal-ownership subquery stops a user from appending items to another
-- user's meal (IDOR — TM #1/#3).
create policy meal_items_insert_own on meal_items for insert
  with check (
    auth.uid() = user_id and
    exists (select 1 from meals m where m.id = meal_id and m.user_id = auth.uid())
  );

create policy meal_items_update_own on meal_items for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id and
    exists (select 1 from meals m where m.id = meal_id and m.user_id = auth.uid())
  );

create policy meal_items_delete_own on meal_items for delete
  using (auth.uid() = user_id);

-- ################################################################
-- # supabase/migrations/0007_food_functions.sql
-- ################################################################
-- =============================================================================
-- 0007  create_user_food(...)  — atomic user-food creation
-- -----------------------------------------------------------------------------
-- Creates a private food + its per-100g nutrition (+ optional barcode) in one
-- transaction, so a failed nutrition insert can never leave an orphan food.
--
-- SECURITY INVOKER (the default): the function runs AS THE CALLER, so every
-- insert is still subject to RLS. It cannot be used to write official foods or
-- another user's data — the same WITH CHECK policies from 0005 apply. The
-- backend has already validated the nutrition (bounds + calorie cross-check,
-- §4.11) before calling this.
-- =============================================================================

create or replace function create_user_food(
  p_name             text,
  p_brand            text,
  p_default_serving_g numeric,
  p_calories         numeric,
  p_protein          numeric,
  p_fat              numeric,
  p_carbs            numeric,
  p_fiber            numeric,
  p_sugar            numeric,
  p_sodium           numeric,
  p_barcode          text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_food_id uuid;
begin
  insert into foods (owner_user_id, is_official, name, brand, source, default_serving_g)
  values (auth.uid(), false, p_name, p_brand, 'user_manual', p_default_serving_g)
  returning id into v_food_id;

  insert into food_nutrition
    (food_id, calories_kcal, protein_g, fat_g, carbs_g, fiber_g, sugar_g, sodium_mg)
  values
    (v_food_id, p_calories, p_protein, p_fat, p_carbs, p_fiber, p_sugar, p_sodium);

  if p_barcode is not null then
    insert into food_barcodes (food_id, barcode) values (v_food_id, p_barcode);
  end if;

  return v_food_id;
end;
$$;

revoke all on function create_user_food(text, text, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, text) from public;
grant execute on function create_user_food(text, text, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, text) to authenticated;

-- ################################################################
-- # supabase/migrations/0008_expenses.sql
-- ################################################################
-- =============================================================================
-- 0008  expense_categories · expenses  (Personal — per-user RLS)
-- -----------------------------------------------------------------------------
-- Food spending. Categories are per-user (no shared/official class here).
-- Receipt images are Sensitive (§4.13): only a Private-Storage object path is
-- ever stored (populated by the Phase-5 upload flow), never the image itself.
-- =============================================================================

-- -------------------------- expense_categories -------------------------------
create table if not exists expense_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),

  constraint chk_cat_name check (length(btrim(name)) > 0)
);

-- One category name per user (case-insensitive).
create unique index if not exists uq_expense_categories_user_name
  on expense_categories (user_id, lower(name));

alter table expense_categories enable row level security;

create policy expense_categories_select_own on expense_categories for select
  using (auth.uid() = user_id);
create policy expense_categories_insert_own on expense_categories for insert
  with check (auth.uid() = user_id);
create policy expense_categories_update_own on expense_categories for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy expense_categories_delete_own on expense_categories for delete
  using (auth.uid() = user_id);

-- ------------------------------- expenses ------------------------------------
create table if not exists expenses (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  spent_on            date not null default current_date,
  amount              numeric(12, 2) not null,
  currency            char(3) not null default 'TWD',
  category_id         uuid references expense_categories (id) on delete set null,
  merchant            text,
  note                text,
  -- Private-Storage object path only (server-generated in Phase 5). Never a
  -- public URL and never the image bytes.
  receipt_object_path text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint chk_amount        check (amount > 0 and amount <= 1000000000),
  constraint chk_currency      check (currency ~ '^[A-Z]{3}$'),
  constraint chk_spent_on_sane check (spent_on >= date '2000-01-01' and spent_on <= current_date + 1)
);

create index if not exists idx_expenses_user_day on expenses (user_id, spent_on desc);
create index if not exists idx_expenses_category on expenses (category_id);

create trigger trg_expenses_updated_at
  before update on expenses
  for each row execute function set_updated_at();

alter table expenses enable row level security;

create policy expenses_select_own on expenses for select
  using (auth.uid() = user_id);

-- Insert/update: row is the caller's, AND any linked category is the caller's
-- own (stops linking an expense to another user's category — TM #2).
create policy expenses_insert_own on expenses for insert
  with check (
    auth.uid() = user_id and (
      category_id is null or
      exists (select 1 from expense_categories c where c.id = category_id and c.user_id = auth.uid())
    )
  );
create policy expenses_update_own on expenses for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id and (
      category_id is null or
      exists (select 1 from expense_categories c where c.id = category_id and c.user_id = auth.uid())
    )
  );
create policy expenses_delete_own on expenses for delete
  using (auth.uid() = user_id);

-- ################################################################
-- # supabase/migrations/0009_food_purchases.sql
-- ################################################################
-- =============================================================================
-- 0009  food_purchases  (Personal — per-user RLS)
-- -----------------------------------------------------------------------------
-- Links a purchased food to its price so the app can derive food-spending
-- efficiency (cost per 100 kcal, cost per 10 g protein — §2.3). Nutrition
-- totals for the purchased quantity are SNAPSHOT at purchase time (§2.2) so a
-- later change to the food never rewrites historical cost metrics. Cost ratios
-- themselves are computed by fixed backend functions, not stored.
-- =============================================================================

create table if not exists food_purchases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- Optional links; nulled (not deleted) if the parent goes away, so the
  -- purchase record and its snapshot survive.
  expense_id   uuid references expenses (id) on delete set null,
  food_id      uuid references foods (id) on delete set null,

  purchased_on date not null default current_date,
  quantity_g   numeric(9, 2) not null,
  price        numeric(12, 2) not null,
  currency     char(3) not null default 'TWD',

  -- Snapshot of the purchased quantity's nutrition (already scaled). Nullable:
  -- a purchase may be a plain receipt line with no linked food.
  total_calories_kcal numeric(10, 2),
  total_protein_g     numeric(9, 2),

  created_at   timestamptz not null default now(),

  constraint chk_fp_qty      check (quantity_g > 0 and quantity_g <= 1000000),
  constraint chk_fp_price    check (price > 0 and price <= 1000000000),
  constraint chk_fp_currency check (currency ~ '^[A-Z]{3}$'),
  constraint chk_fp_cal      check (total_calories_kcal is null or total_calories_kcal >= 0),
  constraint chk_fp_pro      check (total_protein_g is null or total_protein_g >= 0)
);

create index if not exists idx_food_purchases_user_day on food_purchases (user_id, purchased_on desc);
create index if not exists idx_food_purchases_food on food_purchases (food_id);

alter table food_purchases enable row level security;

create policy food_purchases_select_own on food_purchases for select
  using (auth.uid() = user_id);

-- Insert/update: row is the caller's, AND any linked expense is the caller's
-- own, AND any linked food is visible to the caller (own or official).
create policy food_purchases_insert_own on food_purchases for insert
  with check (
    auth.uid() = user_id
    and (expense_id is null or exists (
      select 1 from expenses e where e.id = expense_id and e.user_id = auth.uid()))
    and (food_id is null or exists (
      select 1 from foods f where f.id = food_id and (f.is_official or f.owner_user_id = auth.uid())))
  );
create policy food_purchases_update_own on food_purchases for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (expense_id is null or exists (
      select 1 from expenses e where e.id = expense_id and e.user_id = auth.uid()))
    and (food_id is null or exists (
      select 1 from foods f where f.id = food_id and (f.is_official or f.owner_user_id = auth.uid())))
  );
create policy food_purchases_delete_own on food_purchases for delete
  using (auth.uid() = user_id);

-- ################################################################
-- # supabase/migrations/0010_scans.sql
-- ################################################################
-- =============================================================================
-- 0010  scan_records  (Personal — per-user RLS)
-- -----------------------------------------------------------------------------
-- Tracks the lifecycle of an image scan: upload -> OCR -> AI parse -> candidate
-- -> validation -> user confirmation (§3, §4.10). The AI/OCR output is stored
-- as a CANDIDATE (jsonb), never treated as truth: it can only become a user
-- food after backend validation AND explicit user confirmation. It must never
-- auto-write the shared/official catalogue.
-- =============================================================================

do $$ begin
  create type scan_kind_t as enum ('nutrition_label', 'receipt');
exception when duplicate_object then null; end $$;

do $$ begin
  create type scan_status_t as enum (
    'awaiting_upload',  -- record created, image not yet uploaded
    'uploaded',         -- image present, not yet processed
    'processing',       -- OCR/AI in flight
    'parsed',           -- candidate produced, validation passed
    'needs_review',     -- candidate produced but flagged (low confidence / anomaly)
    'confirmed',        -- user accepted -> became a user food
    'rejected',         -- user rejected the candidate
    'failed'            -- OCR/AI or upload error
  );
exception when duplicate_object then null; end $$;

create table if not exists scan_records (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  kind              scan_kind_t not null,
  status            scan_status_t not null default 'awaiting_upload',

  -- Server-generated private-storage path. The client never chooses this.
  object_path       text not null,

  -- AI/OCR structured output. A CANDIDATE only — not a source of truth.
  candidate         jsonb,
  confidence        numeric(4, 3),
  validation_errors jsonb,

  -- Result of a confirmed nutrition_label scan (a private user food).
  confirmed_food_id uuid references foods (id) on delete set null,

  -- Provenance / cost accounting (§4.12). No secrets, no raw image.
  provider          text,
  ocr_cost          numeric(10, 4),
  ai_cost           numeric(10, 4),
  error_code        text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint uq_scan_object_path unique (object_path),
  constraint chk_confidence check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists idx_scan_records_user_time on scan_records (user_id, created_at desc);
create index if not exists idx_scan_records_status on scan_records (user_id, status);

create trigger trg_scan_records_updated_at
  before update on scan_records
  for each row execute function set_updated_at();

alter table scan_records enable row level security;

create policy scan_records_select_own on scan_records for select
  using (auth.uid() = user_id);
create policy scan_records_insert_own on scan_records for insert
  with check (auth.uid() = user_id);
create policy scan_records_update_own on scan_records for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy scan_records_delete_own on scan_records for delete
  using (auth.uid() = user_id);

-- ################################################################
-- # supabase/migrations/0011_ai_cost_guard.sql
-- ################################################################
-- =============================================================================
-- 0011  AI / OCR cost guard  (§4.12)
-- -----------------------------------------------------------------------------
-- Per-user, per-day budget with ATOMIC reserve-before-call semantics: the
-- budget is checked and reserved in a single locked UPDATE, so concurrent
-- requests cannot both slip past the cap. Over-budget requests are denied by
-- the backend before any provider is called.
-- =============================================================================

create table if not exists ai_cost_budget (
  user_id     uuid not null references auth.users (id) on delete cascade,
  usage_date  date not null default current_date,
  requests    integer not null default 0,
  est_cost    numeric(12, 4) not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, usage_date),

  constraint chk_budget_nonneg check (requests >= 0 and est_cost >= 0)
);

alter table ai_cost_budget enable row level security;

-- Users may READ their own usage (for a "budget remaining" UI). Writes happen
-- only through the SECURITY DEFINER reservation function below — never direct.
create policy ai_cost_budget_select_own on ai_cost_budget for select
  using (auth.uid() = user_id);

-- Atomically reserve one request + its estimated cost against the caller's
-- daily budget. Returns true if reserved (proceed), false if over budget
-- (deny). SECURITY DEFINER so it can write the counter, but it only ever
-- touches the CALLER's own row (auth.uid()) — it cannot be aimed at another
-- user. Call this BEFORE invoking any OCR/AI provider.
create or replace function reserve_ai_budget(
  p_max_requests integer,
  p_max_cost     numeric,
  p_req_cost     numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;
  if p_req_cost < 0 or p_max_requests < 1 or p_req_cost > p_max_cost then
    return false;
  end if;

  -- Ensure today's row exists, then conditionally increment under row lock.
  insert into ai_cost_budget (user_id, usage_date)
    values (v_uid, current_date)
    on conflict (user_id, usage_date) do nothing;

  update ai_cost_budget
     set requests   = requests + 1,
         est_cost   = est_cost + p_req_cost,
         updated_at = now()
   where user_id = v_uid
     and usage_date = current_date
     and requests + 1 <= p_max_requests
     and est_cost + p_req_cost <= p_max_cost;

  return found;  -- true iff the guarded UPDATE actually applied
end;
$$;

revoke all on function reserve_ai_budget(integer, numeric, numeric) from public;
grant execute on function reserve_ai_budget(integer, numeric, numeric) to authenticated;

-- Reconcile the reserved estimate with the actual provider cost after the call
-- (best-effort accounting; never gates the request). Adjusts today's row.
create or replace function settle_ai_cost(p_actual_cost numeric, p_reserved_cost numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_delta numeric := coalesce(p_actual_cost, 0) - coalesce(p_reserved_cost, 0);
begin
  if v_uid is null then
    return;
  end if;
  update ai_cost_budget
     set est_cost = greatest(0, est_cost + v_delta),
         updated_at = now()
   where user_id = v_uid and usage_date = current_date;
end;
$$;

revoke all on function settle_ai_cost(numeric, numeric) from public;
grant execute on function settle_ai_cost(numeric, numeric) to authenticated;

-- ################################################################
-- # supabase/seed.sql
-- ################################################################
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
