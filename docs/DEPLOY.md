# 雲端部署（Vercel + Supabase，免費）

部署後你會得到一個真實網址（例如 `foodtrack-xxx.vercel.app`），手機與電腦都能開。
免費版執行時**只需要兩個公開環境變數**，`service_role` key 用不到。

分兩部分：先架好 **Supabase（資料庫）**，再部署 **Vercel（前端）**。

---

## Part A — Supabase（資料庫）

### A1. 建立專案
1. 到 <https://supabase.com> 註冊、登入。
2. **New project** → 填名稱（例：foodtrack）、資料庫密碼（**記下來**）、地區選離你近的（例：Singapore / Tokyo）。
3. 等 1–2 分鐘建置完成。

### A2. 取得連線資訊
到 **Project Settings → API**，記下：
- **Project URL**（例：`https://abcdxyz.supabase.co`）→ 就是 `NEXT_PUBLIC_SUPABASE_URL`
- **anon public** key → 就是 `NEXT_PUBLIC_SUPABASE_ANON_KEY`

（**Project ref** = URL 中 `abcdxyz` 那段，下一步會用到。）

### A3. 套用 migrations（建立所有表、RLS、函式）
在你自己的電腦（有 Node 即可，不需 Docker）：

```bash
# 於專案資料夾
npx supabase login                          # 依指示在瀏覽器授權
npx supabase link --project-ref <你的 ref>   # 會要輸入 A1 的資料庫密碼
npx supabase db push                         # 把 supabase/migrations 全部套到雲端
```

> 沒有本機環境也行：改用 Supabase 網站的 **SQL Editor**，依序貼上
> `supabase/migrations/0001…0012` 的內容各執行一次（順序不可亂）。

### A4. 放官方食品 seed（可選，建議）
Supabase 網站 → **SQL Editor** → 貼上 `supabase/seed.sql` 內容 → Run。
（讓首次使用就有「白飯、雞胸肉、牛奶、香蕉、雞蛋」可搜/掃。）

### A5. Auth 設定
**Authentication → Providers → Email**：
- 為了方便先關掉 **Confirm email**（註冊後直接登入）。日後要更嚴謹再打開。

**Authentication → URL Configuration**：
- **Site URL** 先留空或填 `http://localhost:3000`；等 Part B 拿到 Vercel 網址後回來改成正式網址。

---

## Part B — Vercel（前端）

### B1. 匯入 repo
1. 到 <https://vercel.com> 用 GitHub 登入。
2. **Add New… → Project** → 匯入 `LiXuanWu8857/Cc`。
3. **Production Branch**：目前程式在分支 `claude/read-conversation-content-pld5ko`。
   - 最簡單：在 Vercel 專案 **Settings → Git** 把 Production Branch 設成該分支；
   - 或先把該分支合併到 `main` 再讓 Vercel 用 `main`。

### B2. 環境變數
匯入時（或 **Settings → Environment Variables**）加入：

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | A2 的 Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | A2 的 anon key |

（`SUPABASE_SERVICE_ROLE_KEY` 免費版不需要；未來接受控系統工作再加。）

### B3. 部署
按 **Deploy**。Framework 會自動偵測為 Next.js，不用改設定。完成後得到網址。

### B4. 回填 Auth 網址
回 Supabase **Authentication → URL Configuration**：
- **Site URL** = 你的 Vercel 網址（例 `https://foodtrack-xxx.vercel.app`）
- **Redirect URLs** 加入同一網址。

---

## 完成後怎麼用
1. 開 Vercel 網址 → `/login` 註冊帳號。
2. 進 `/onboarding` 填基本資料 → 算每日目標。
3. `/dashboard` 看進度；`/add` 掃條碼或搜尋加食物；`/expenses` 記帳。

## 常見狀況
- **相機掃描**只在 HTTPS（Vercel 是 HTTPS ✅）且支援 `BarcodeDetector` 的瀏覽器可用；不支援時退回手動輸入條碼。
- **登入後又被踢回 login**：多半是 Auth 的 Site URL / Redirect 沒設成 Vercel 網址（見 B4）。
- **查無條碼**：OpenFoodFacts 沒有該品項是正常的，改用搜尋或手動新增。
- 之後升級 AI 付費版：在 Vercel 加 OCR/AI 的金鑰環境變數並實作 provider，其餘不動。
