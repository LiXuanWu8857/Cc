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
