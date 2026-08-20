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
