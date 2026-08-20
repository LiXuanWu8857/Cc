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
