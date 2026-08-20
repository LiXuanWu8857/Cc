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
