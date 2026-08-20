# 01 — Security Architecture

> FoodTrack 後端安全基線。本文件是交接文件（V1.0）安全章節在**本 repo 實作**上的對映。
> 交接文件是「為什麼」，本文件是「在程式碼裡的哪裡」。

## 1. 核心安全原則（不可違反）

沿用交接文件 §4.1 的 10 條原則。在本 repo 的落點：

| # | 原則 | 落點 |
|---:|---|---|
| 01 | Frontend 不可信 | 所有寫入走 `src/lib/api/pipeline.ts` 的 schema 驗證；欄位白名單於 `src/lib/validation/schemas.ts`。 |
| 02 | Backend 唯一可信入口 | 所有 DB 存取在 API route handler / server 端；無 client 直連 DB。 |
| 03 | 身分不由前端決定 | `pipeline` 從 `db.auth.getUser()` 取 `user.id`；route 內一律用 `user.id`，不讀 body 的 id。 |
| 04 | 登入 ≠ 授權 | 資源歸屬由 RLS `auth.uid() = user_id` 強制；見 §4 與 migrations。 |
| 05 | DB 再防一次 | 每張個人表啟用 RLS + `WITH CHECK` + CHECK constraints。 |
| 06 | 最小權限 | 預設用 RLS-bound client（`createRlsClient`）；`service_role` 隔離於 `admin.ts` + `server-only`。 |
| 07 | Secrets 永不進瀏覽器 | 只有 `NEXT_PUBLIC_*` 兩個公開值；service key / DB URL 只在 server env（`.env.example` 標註）。 |
| 08 | AI 不是可信來源 | 候選存 `scan_records`；`validateNutritionPer100g` + 使用者 `confirm` 才建私有食品；provider 為可抽換介面（尚未接真實供應商）。 |
| 09 | 上傳一律不可信 | Private bucket + storage RLS（uid 前綴）+ `validateImageBytes`（magic bytes/尺寸/大小）+ AI Cost Guard；OCR/AI server-only。 |
| 10 | 安全可測試 | pgTAP 越權測試 `supabase/tests/`；calc 單元測試 `src/lib/nutrition/`。 |

## 2. Trust Boundary

```text
Internet（不可信）
  │ HTTPS
  ▼
Cloudflare：WAF / Bot / DDoS / Rate Limit   ← 部署層，尚未設定
  ▼
Next.js Frontend（不可信）
  │ 只能呼叫公開 HTTPS API
  ▼
╔════════════ Backend Trust Boundary（本 repo）════════════╗
║ src/middleware.ts        → session refresh                ║
║ src/lib/api/pipeline.ts  → RateLimit → Auth → Validation  ║
║ src/app/api/**/route.ts  → Authorization → Logic → Audit  ║
╚═════════════╤══════════════════════════════╤═════════════╝
              ▼                              ▼
     PostgreSQL + RLS                 Private Storage
     supabase/migrations/            （Phase 5，未接入）
```

假設攻擊者可在 DevTools 修改／重送 request、猜 ID、重放請求 —— 這是正常環境，不是例外。

## 3. API 標準管線（§4.4）

固定順序，於 `src/lib/api/pipeline.ts` 的 `withPipeline()` 強制：

```text
Request → Rate Limit → Authentication → Schema Validation
        → Authorization → Business Logic → DB + RLS → Audit → Minimal Response
```

- **Rate Limit**：per-IP 與 per-user 兩個維度（`rate-limit.ts`）。目前為 in-memory fixed window，多實例部署需換 Redis（介面已備）。
- **Authentication**：`db.auth.getUser()` 驗證 session；失敗回 401。
- **Schema Validation**：zod `.strict()`，未知欄位一律拒絕（mass assignment 防護）。
- **Authorization**：在 handler 內，由 RLS-bound client 天然限制到 `auth.uid()` 的資料列。
- **Audit**：`log_audit_event` RPC（SECURITY DEFINER，append-only）。
- **Minimal Response**：錯誤只回穩定錯誤碼 + 通用訊息（`errors.ts`），不洩漏內部細節。

## 4. 授權與 RLS（§4.5–4.6）

三層防禦：**應用程式授權 → RLS → DB constraints**。

- `user_id` 只從 session 取得，絕不從 request body。
- 每張個人表（`user_profiles`、`body_metrics`、`nutrition_targets`）：`SELECT/INSERT/UPDATE/DELETE` 四個 policy，皆以 `auth.uid() = user_id` 判斷，`WITH CHECK` 防止把資料歸給他人。
- `audit_logs` 鎖定：RLS 開啟但無一般角色 policy（deny-by-default），寫入僅經 SECURITY DEFINER 函式，讀取限管理／service。
- 角色 `PUBLIC / USER / SYSTEM / ADMIN` 為伺服器端 claims，不接受前端傳值。

## 5. Data Classification（§4.13）

| 等級 | 本 repo 範例 | 規則 |
|---|---|---|
| Public | `foods`、`food_barcodes`、`food_nutrition`（官方） | 僅公開讀取；受控寫入 |
| Personal | `user_profiles`、`nutrition_targets`、`meals`、`meal_items`、`expenses`、`food_purchases` | per-user RLS、最小回應 |
| Sensitive | `body_metrics`（體重／體脂）、收據影像（`receipt_object_path`） | RLS、Private Storage、避免寫入 log、最小回應 |
| Secret | service key、DB URL、JWT secret | 僅 server env；`.gitignore` 排除 `.env*` |

## 6. Threat Model → 控制 → 測試（節錄，對映交接文件 §5 的 25 項）

已由本階段程式碼涵蓋的項目：

| # | 威脅 | 控制 | 測試 |
|---:|---|---|---|
| 1 | 偽造 `user_id` 建立／改寫 | 身分自 session + RLS `WITH CHECK` | `0001_rls_personal_tables.test.sql`：A 無法 insert B 的 row |
| 2 | IDOR 讀他人資料 | RLS `SELECT` policy | 同上：A 查不到 B 的 body_metrics |
| 3 | IDOR 改／刪他人資料 | RLS `UPDATE/DELETE` policy | 同上：A 的 update/delete 影響 0 列 |
| 9 | Mass assignment | zod `.strict()` 白名單 | （API 整合測試，後續補） |
| 13 | 猜測私有 Storage path | UUID 路徑、private bucket、storage RLS（uid 前綴）、後端簽 URL | `0012_storage.sql` |
| 14 | 使用者指定他人 Storage path | 路徑後端生成（`scanObjectPath`）、storage RLS owner 前綴 | `0012_storage.sql` |
| 15 | 惡意檔/偽 MIME/圖片炸彈 | magic bytes、尺寸/大小上限、拒 SVG/HTML/未知格式 | `validateImage.test.ts` |
| 18 | Prompt injection 影響 AI | OCR/圖片文字視為不可信資料；固定候選 schema；provider 無授權工具 | provider 介面契約（`ocr/provider.ts`、`ai/nutritionParser.ts`） |
| 19 | AI/使用者食品污染官方庫 | official 食品 RLS 禁一般使用者寫；候選為私有 user food、須使用者確認 | `0002_rls_foods_meals.test.sql`、`0004_rls_scans.test.sql` |
| 20 | 營養單位/計算操弄 | 後端固定函式重算與換算，client 不傳衍生值；熱量交叉驗證 | `calc.test.ts`、`validate.test.ts` |
| 21 | AI/OCR 成本濫用 | 呼叫前原子預算保留（`reserve_ai_budget`）、對帳、每人每日配額 | `0004_rls_scans.test.sql`：第三次超額被拒 |
| 25 | 第三方食品資料（OpenFoodFacts）供應鏈風險 | 視為不可信、僅回候選不寫入、後端二次驗證、fail-soft（timeout/錯誤→404）、provider 可抽換 | `openFoodFacts.test.ts`：映射/缺欄位/交叉檢查 |

待後續階段涵蓋：#4–8、#10–12、#16–17、#22–25（Auth 強化、下載 URL TTL、供應鏈、DoS 深化等，多屬部署層與供應商接入）。

## 7. Security Testing（§4.15 / 交接指示 4）

- **DB 層**：pgTAP 越權測試，證明 User A/B 隔離。指令：`supabase test db`。
- **邏輯層**：nutrition calc 單元測試。指令：`npm test`。
- **待補**：API 整合測試（未登入／過期 session／偽 role／重放），需可運行的 Supabase 實例。
- 原則：**沒有測試不算完成**。新增任何 table 或 endpoint，必須同時附 RLS policy 與越權測試。
