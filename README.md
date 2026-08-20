# FoodTrack

飲食紀錄 ＋ 營養分析 ＋ 食品支出記帳。後端優先（backend-first），嚴格遵循 V1 安全基線。

> 核心 Loop：`掃條碼／拍營養標示 → 選份量 → 加入某一餐 → 熱量更新 → 支出完成`

## 目前狀態：Phase 2（Auth + 個人資料基線）

已完成的後端地基：

- **DB schema + RLS**（`supabase/migrations/`）：`user_profiles`、`body_metrics`、`nutrition_targets`、`audit_logs`，每張個人表都有完整 RLS 與 `WITH CHECK`。
- **越權測試**（`supabase/tests/`）：pgTAP 證明 User A／User B 租戶隔離。
- **安全 API 管線**（`src/lib/api/`）：固定順序 `RateLimit → Auth → Validation → Authorization → Logic → DB+RLS → Audit → Minimal Response`。
- **個人資料 API**：`/api/profile`、`/api/body-metrics`、`/api/nutrition-targets`。
- **後端固定營養計算**（`src/lib/nutrition/`）：BMR/TDEE/巨量營養素，含單元測試。

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

- **Phase 3**：foods / barcodes / meals / meal_items（營養快照）+ Dashboard API。
- **Phase 4**：expenses / food_purchases 與成本分析。
- **Phase 5**：Private Storage 上傳 → OCR → AI parser → 候選驗證 → 使用者確認，含 Cost Guard 與審核流程。
