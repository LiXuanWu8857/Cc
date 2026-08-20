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
