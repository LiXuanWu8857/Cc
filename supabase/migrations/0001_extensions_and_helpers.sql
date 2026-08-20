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
