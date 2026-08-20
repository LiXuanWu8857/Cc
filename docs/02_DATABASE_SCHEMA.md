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

## 0005 — foods · food_nutrition · food_barcodes （Public，受控寫入）

食品目錄有兩種可見性等級並存（§4.6、§4.13）：

- **官方（official）**：`owner_user_id IS NULL`、`is_official = true`。全員可讀，只有受控系統工作（service_role 繞過 RLS）可寫。
- **使用者（user）**：`owner_user_id = 建立者`、`is_official = false`。僅建立者可讀寫；不可污染官方庫（§4.10）。

### `foods`

| 欄位 | 型別 | 說明 / 約束 |
|---|---|---|
| `id` | uuid PK | |
| `owner_user_id` | uuid null | → auth.users；NULL ⟺ 官方食品 |
| `is_official` | boolean | 預設 false |
| `name` | text | `chk_name_present` |
| `brand` | text | |
| `source` | `food_source_t` | official / user_manual / barcode_import / scan_candidate |
| `default_serving_g` | numeric(7,2) | `chk_default_serving`（0 < s ≤ 10000） |
| `created_at` / `updated_at` | timestamptz | |
| — | — | `chk_official_ownership`：official ⟺ 無 owner；user ⟺ 有 owner |

Index：`idx_foods_owner`、`idx_foods_official`（partial）、`idx_foods_name_lower`。
**RLS**：`select` 官方或本人；`insert/update/delete` 僅本人非官方（`WITH CHECK owner = auth.uid() AND is_official = false`）—— 阻止建立官方食品或指派給他人。

### `food_nutrition` （每 100g 正規基準，1:1 於 foods）

`calories_kcal` / `protein_g` / `fat_g` / `carbs_g`（not null）+ 選填 `fiber_g` / `sugar_g` / `sodium_mg`。皆非負且有上限 CHECK。serving 換算由後端固定函式做（§4.11），不存多基準。
**RLS**：可見性鏡射父 food；寫入僅本人非官方食品。

### `food_barcodes`

`barcode text`（`chk_barcode_format` = `^[0-9]{8,14}$`）→ `food_id`。`uq_food_barcode(food_id, barcode)`、`idx_food_barcodes_barcode`。
**RLS**：可見性鏡射父 food；寫入僅本人非官方食品。

## 0006 — meals · meal_items （Personal）

### `meals`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | → auth.users |
| `meal_type` | `meal_type_t` | breakfast / lunch / dinner / snack |
| `consumed_on` | date | 歸屬日（Dashboard 分組用）；`chk_consumed_on_sane` |
| `consumed_at` | timestamptz | 實際時間 |
| `note` | text | |

Index：`idx_meals_user_day (user_id, consumed_on desc, meal_type)`。**RLS**：四 policy，本人。

### `meal_items` （營養快照 §2.2）

當次 insert 時就把識別與營養**快照**寫死，日後食品變更/刪除不改寫歷史。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `meal_id` | uuid | → meals on delete cascade |
| `user_id` | uuid | 反正規化 owner（RLS 用） |
| `food_id` | uuid null | → foods on delete **set null**（保留快照） |
| `food_name` | text | 快照 |
| `quantity_g` | numeric(7,2) | `chk_mi_qty`（0 < q ≤ 20000） |
| `serving_label` | text | |
| `calories_kcal` / `protein_g` / `fat_g` / `carbs_g` | numeric | 已換算的當次快照，非負 |

**RLS**：`select/delete` 本人；`insert/update` `WITH CHECK` 額外要求 `meal_id` 屬於本人（子查詢 `exists meals`）—— 阻止把 item 掛到他人餐點（TM #1/#3）。

## 0007 — 函式

- `create_user_food(...)`：SECURITY **INVOKER**，單一交易內建立 food + food_nutrition + 選填 barcode，避免孤兒；RLS 照常套用（不能寫官方或他人）。

## TODO（後續階段）

- **Phase 4**：`expenses`、`expense_categories`、`food_purchases`。
- **Phase 5**：`scan_records`、Storage bucket 與 OCR/AI 候選資料流。
