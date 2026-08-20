# 02 — Database Schema

> 目前實作範圍：**Phase 2**（Auth + 個人資料基線）。
> Migrations 位於 `supabase/migrations/`，依序套用。後續階段的表格於文末列為 TODO。

## 慣例

- 主鍵：surrogate `uuid`（`gen_random_uuid()`），除 `user_profiles` 以 `user_id` 為 PK。
- 所有個人表 `user_id uuid references auth.users(id) on delete cascade`。
- 時間欄位 `timestamptz`，`updated_at` 由 `set_updated_at()` trigger 維護。
- 每張個人表：啟用 RLS，四個 policy（select/insert/update/delete），皆 `auth.uid() = user_id`。
- 金額／重量／營養值：`numeric` + 非負與合理上限 CHECK constraint。

## 0001 — Extensions / Enums / Helpers

- Extensions：`pgcrypto`。
- Enums：`sex_t`、`activity_level_t`、`goal_t`、`target_source_t`、`audit_result_t`。
- `set_updated_at()`：BEFORE UPDATE trigger 函式。
- `audit_logs`（見下）+ `log_audit_event(...)` SECURITY DEFINER 寫入函式。

## `user_profiles` （Personal）

一位使用者一列。體重／體脂**不**存這裡（時間序列存 `body_metrics`）。

| 欄位 | 型別 | 說明 / 約束 |
|---|---|---|
| `user_id` | uuid PK | → `auth.users(id)` on delete cascade |
| `display_name` | text | 可空 |
| `sex` | `sex_t` | enum |
| `birth_date` | date | `chk_birth_date_past`（≤ today）、`chk_birth_date_sane`（≥ 1900-01-01） |
| `height_cm` | numeric(5,2) | `chk_height_range`（0 < h ≤ 300） |
| `activity_level` | `activity_level_t` | enum |
| `goal` | `goal_t` | enum |
| `created_at` / `updated_at` | timestamptz | trigger 維護 |

**RLS**：`user_profiles_{select,insert,update,delete}_own`，`auth.uid() = user_id`（insert/update 帶 `WITH CHECK`）。

## `body_metrics` （Sensitive · 時間序列）

歷史保存，永不覆寫（§2.1）。

| 欄位 | 型別 | 說明 / 約束 |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | → auth.users |
| `measured_at` | timestamptz | `chk_measured_at_not_future` |
| `weight_kg` | numeric(5,2) | `chk_weight_range`（0 < w ≤ 700） |
| `body_fat_pct` | numeric(5,2) | `chk_body_fat_range`（0–100） |
| `note` | text | |
| `created_at` | timestamptz | |
| — | — | `chk_metric_present`：weight 或 body_fat 至少一項 |

Index：`idx_body_metrics_user_time (user_id, measured_at desc)`。
**RLS**：四 policy，`auth.uid() = user_id`。

## `nutrition_targets` （Personal）

同時保留系統計算值與使用者覆寫值；effective 由 DB 決定（generated column）。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | → auth.users |
| `effective_date` | date | 目標生效日 |
| `bmr` / `tdee` | numeric(7,2) | 計算快照 |
| `calories_system` | integer | 後端計算（source of truth） |
| `protein_g_system` / `fat_g_system` / `carbs_g_system` | numeric(6,2) | 後端計算 |
| `*_override` | 對應型別，可空 | 使用者覆寫，NULL = 用系統值 |
| `*_effective` | generated stored | `coalesce(override, system)` |
| `source` | `target_source_t` | `system` / `user_override` |
| `is_active` | boolean | 目前生效目標 |
| `created_at` / `updated_at` | timestamptz | |

約束：所有 `*_system` 與 `*_override` 皆非負且有合理上限（見 migration）。
Index：`idx_nutrition_targets_user_active`；`uq_nutrition_targets_active`（partial unique：每人每日至多一列 `is_active`）。
**RLS**：四 policy，`auth.uid() = user_id`。

## `audit_logs` （§4.14）

Append-only。RLS 開啟且無一般角色 policy（deny-by-default）；`revoke update, delete`。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `actor_user_id` | uuid | → auth.users，on delete set null |
| `event_type` | text | 例：`profile.upsert` |
| `target_type` / `target_id` | text | 目標資源 |
| `result` | `audit_result_t` | success / failure / denied |
| `request_id` | text | 關聯 trace |
| `risk_meta` | jsonb | **僅最小非敏感 metadata**；禁存 request body / JWT / 原圖 |
| `created_at` | timestamptz | |

寫入僅經 `log_audit_event(...)`（SECURITY DEFINER，`grant execute ... to authenticated`）。

## TODO（後續階段）

- **Phase 3**：`foods`、`food_nutrition`、`food_barcodes`、`meals`、`meal_items`（含營養快照）。
- **Phase 4**：`expenses`、`expense_categories`、`food_purchases`。
- **Phase 5**：`scan_records`、Storage bucket 與 OCR/AI 候選資料流。
