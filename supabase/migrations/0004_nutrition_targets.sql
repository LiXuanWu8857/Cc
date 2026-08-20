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
