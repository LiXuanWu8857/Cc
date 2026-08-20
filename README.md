# FoodTrack

飲食紀錄 ＋ 營養分析 ＋ 食品支出記帳。後端優先（backend-first），嚴格遵循 V1 安全基線。

> 核心 Loop：`掃條碼／拍營養標示 → 選份量 → 加入某一餐 → 熱量更新 → 支出完成`

## 目前狀態：免費版 MVP（前端 + 後端可操作）

前端已完成免費版（登入 → 目標 → Dashboard → 條碼/搜尋/手動加入餐點 → 記帳），詳見下方「前端」。以下為完整後端能力：

### Phase 5（掃描 → OCR/AI 候選 → 確認；供應商可抽換，尚未接入）

已完成的後端：

- **DB schema + RLS**（`supabase/migrations/`）：
  - Phase 2：`user_profiles`、`body_metrics`、`nutrition_targets`、`audit_logs`。
  - Phase 3：`foods` / `food_nutrition` / `food_barcodes`（官方＝全員可讀、受控寫入；使用者食品私有）、`meals`、`meal_items`（營養快照）。
  - Phase 4：`expense_categories`、`expenses`、`food_purchases`（購買量營養快照供成本分析）。
  - Phase 5：`scan_records`、`ai_cost_budget`（AI Cost Guard）、私有 `scans` bucket + storage RLS。
  - 每張表都有完整 RLS 與 `WITH CHECK`。
- **越權測試**（`supabase/tests/`）：pgTAP 四組，涵蓋所有個人表、食品/餐點、支出/購買、掃描的 User A／User B 隔離、官方庫寫入防護、跨資源連結防護、預算原子預留。
- **安全 API 管線**（`src/lib/api/`）：固定順序 `RateLimit → Auth → Validation → Authorization → Logic → DB+RLS → Audit → Minimal Response`。
- **API**：
  - 個人：`/api/profile`、`/api/body-metrics`、`/api/nutrition-targets`。
  - 食品/餐點：`/api/foods`（搜尋/建立）、`/api/foods/barcode/[barcode]`、`/api/meals`、`/api/meal-items`（含 `[id]` 刪除）、`/api/dashboard`。
  - 支出：`/api/expense-categories`、`/api/expenses`、`/api/food-purchases`（含每 100 kcal／每 10g 蛋白質成本）。
  - 掃描：`/api/scans`（建立+signed upload URL）、`/api/scans/[id]`、`/api/scans/[id]/process`、`/api/scans/[id]/confirm`。
- **後端固定計算與安全函式**（`src/lib/`）：BMR/TDEE/巨量營養素、營養驗證（熱量交叉檢查）、serving 換算、成本比率、影像上傳驗證（magic bytes/尺寸/圖片炸彈），含單元測試（27 passing）。

> **OCR/AI 供應商尚未接入**：`src/lib/ocr/provider.ts` 與 `src/lib/ai/nutritionParser.ts` 是可抽換介面。`process` 端點在供應商接上前回 501 並退還已預留的預算。接入方式見下方 Roadmap。

### 前端（免費版 MVP，已完成）

Next.js App Router 頁面，走既有 API（cookie session + RLS），行動裝置優先：

| 路由 | 內容 |
|---|---|
| `/login` | Supabase Auth 登入／註冊 |
| `/onboarding` | 個人資料 + 體重 → 算每日目標 |
| `/dashboard` | 當日熱量/三大營養素進度、各餐、支出 |
| `/add` | 加入食物：**條碼掃描**（瀏覽器原生 `BarcodeDetector`，零相依）／搜尋／手動；查不到自動走 OpenFoodFacts 候選 → 確認 → 選餐別份量 |
| `/expenses` | 記一筆支出 + 當月清單、分類 |

- 頁面守衛在 `src/middleware.ts`：未登入導向 `/login`，API 維持自身 401。
- 只有公開 anon key 進瀏覽器；所有資料存取經後端 API（§4.3）。
- 相機掃描在裝置端進行，影像不上傳；不支援 `BarcodeDetector` 的瀏覽器自動退回手動輸入。

> **要實際跑起來需一個 Supabase 專案**：把 URL / anon key 填入 `.env.local`（見 `.env.example`），套用 `supabase/migrations`，即可 `npm run dev`。

### 免費版掃描（已接入，$0）

- **條碼 → 營養**：`GET /api/foods/barcode/[barcode]` 本地查不到時，自動查 **OpenFoodFacts**（免費、開放資料）。外部資料只回**候選**、不寫入；使用者經 `POST /api/foods` 確認後才建立（後端二次驗證）。provider 可抽換（`src/lib/foods/openFoodFacts.ts`）。
- **營養標示 OCR**：走**瀏覽器端 Tesseract.js**（前端，尚待前端實作）——影像不上傳伺服器、零 AI 成本；辨識出的候選一樣打 `POST /api/foods` 確認建立。後端不需新增端點。
- 之後要升級到 AI 付費版：只需實作 `OcrProvider` / `NutritionParser` 並設定金鑰，`process` 端點自動生效，**其餘程式與資料不動**（見下方 Roadmap）。

## 規格文件（先 spec 再 code）

| 文件 | 內容 |
|---|---|
| [`docs/00_PRODUCT_SECURITY_HANDOFF.md`](docs/00_PRODUCT_SECURITY_HANDOFF.md) | 產品 + 資安基線（來源交接文件，唯一真實來源） |
| [`docs/01_SECURITY_ARCHITECTURE.md`](docs/01_SECURITY_ARCHITECTURE.md) | 安全架構、威脅模型、測試矩陣（對映程式碼落點） |
| [`docs/02_DATABASE_SCHEMA.md`](docs/02_DATABASE_SCHEMA.md) | 所有表、欄位、約束、RLS policy |
| [`docs/03_API_SECURITY_SPEC.md`](docs/03_API_SECURITY_SPEC.md) | 每個 endpoint 的 actor / schema / authz / rate limit / audit / 錯誤碼 |

## 技術堆疊

Next.js 14（App Router）· TypeScript · PostgreSQL · Supabase（Auth / Storage / RLS）· zod · vitest · pgTAP。

## 開發

```bash
# 1. 安裝
npm install

# 2. 設定環境變數（切勿 commit secrets）
cp .env.example .env.local   # 填入 Supabase 專案值

# 3. 型別檢查與單元測試
npm run typecheck
npm test

# 4. 資料庫 migrations + RLS 越權測試（需本地 Supabase）
supabase start
supabase db reset      # 套用 migrations
supabase test db       # 執行 pgTAP 越權測試

# 5. 啟動
npm run dev
```

## 安全原則（節錄，完整見 docs/01）

1. **前端全不可信**：所有 id、role、價格、營養計算結果都在後端重新取得／重算。
2. **身分只從 session/JWT**：絕不讀 request body 的 `user_id`。
3. **DB 再防一次**：RLS + `WITH CHECK` + constraints 是應用程式授權外的最後防線。
4. **Secrets 永不進瀏覽器**：只有 `NEXT_PUBLIC_*` 兩個公開值。
5. **沒有測試不算完成**：新增 table / endpoint 必附 RLS policy 與越權測試。

## Roadmap

- **Phase 3（完成）**：foods / barcodes / meals / meal_items（營養快照）+ Dashboard API。
- **Phase 4（完成）**：expenses / food_purchases 與成本分析（每 100 kcal 成本、每 10g 蛋白質成本）。
- **Phase 5（骨架完成）**：Private Storage 上傳 → OCR → AI parser → 候選驗證 → 使用者確認，含 Cost Guard。**待接入 OCR/AI 供應商**：
  1. 實作 `OcrProvider`（`src/lib/ocr/provider.ts`）與 `NutritionParser`（`src/lib/ai/nutritionParser.ts`）。
  2. 金鑰只放 server-only env var（見 `.env.example`），永不進前端。
  3. AI parser 須遵守 prompt 契約：把 OCR 文字當**不可信資料**、固定輸出 schema、無授權工具（§4.9）。
  4. 接上後 `process` 端點即自動生效，無需改其他程式。
