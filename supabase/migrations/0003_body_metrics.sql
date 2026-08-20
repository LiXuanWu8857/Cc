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
