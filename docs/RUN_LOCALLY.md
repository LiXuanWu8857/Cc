# 在本機跑起來

> ⚠️ **為什麼不能在 Claude Code 雲端環境跑**：`supabase start` 需要 Docker 拉取
> Postgres/Auth/Storage 等 container image，而該環境的網路政策封鎖了 Docker 的
> image CDN（`production.cloudfront.docker.com` 回 403），連 `hello-world` 都拉
> 不動。因此 Supabase 只能在**你自己的機器**（有 Docker）或**雲端 Supabase 專案**
> （免 Docker）上跑。以下是本機步驟。

## 需求

- **Docker**（Desktop 或 Engine）並確認 daemon 有在跑
- **Node.js 18+**
- Supabase CLI 用 `npx supabase …` 即可，不必另外安裝

## 步驟

```bash
# 1. 安裝相依
npm install

# 2. 啟動本地 Supabase（第一次會拉 image，需幾分鐘）
npx supabase start

#    完成後會印出 API URL 與金鑰。若忘了可再看：
npx supabase status
#    需要的兩個值：
#      API URL        → 通常 http://127.0.0.1:54321
#      anon key       → 一段 JWT

# 3. 設定前端環境變數
cp .env.example .env.local
#    編輯 .env.local，填入上一步的值：
#      NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#      NEXT_PUBLIC_SUPABASE_ANON_KEY=<剛剛的 anon key>
#      SUPABASE_SERVICE_ROLE_KEY=<supabase status 的 service_role key，僅後端用>

# 4. 套用 migrations + seed（建立所有表、RLS 與幾筆官方食品）
npx supabase db reset

# 5. 跑越權測試（pgTAP，應全數通過）
npx supabase test db

# 6. 啟動前端
npm run dev
#    開 http://localhost:3000
```

## 第一次操作

1. `/login` → 切到「註冊」建立帳號（本地已關閉 email 確認，註冊後直接登入）。
2. 自動進 `/onboarding` → 填資料 → 算出每日目標。
3. `/dashboard` 看進度；`/add` 掃條碼或搜尋（seed 已放「白飯、雞胸肉、全脂牛奶、香蕉、雞蛋」，牛奶與雞蛋各有一個 demo 條碼）。
4. `/expenses` 記一筆支出。

## 其他

- **相機掃描**只在支援 `BarcodeDetector` 的瀏覽器（Chromium 系）且 **HTTPS 或 localhost** 下可用；不支援時會自動退回手動輸入條碼。
- **OpenFoodFacts** 查詢需要對外網路（`world.openfoodfacts.org`）。
- 停止：`npx supabase stop`。重置資料：`npx supabase db reset`。

## 用雲端 Supabase 專案（免 Docker）

1. 在 supabase.com 建立專案。
2. `npx supabase link --project-ref <ref>` 後 `npx supabase db push` 套用 migrations。
3. `.env.local` 填該專案的 URL 與 anon key。
4. seed 與 pgTAP 為本地開發用；雲端可自行在 SQL editor 執行 `supabase/seed.sql`。
