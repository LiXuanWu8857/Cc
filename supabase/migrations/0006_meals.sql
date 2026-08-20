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
