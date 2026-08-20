# FoodTrack：產品、資料與後端資安交接文件

> 文件版本：V1.0  
> 目的：供 Claude（及後續工程團隊）作為 FoodTrack 的單一產品與安全基線。  
> 原則：先遵守本文件的安全與資料模型，再延伸 UI、API 與資料庫實作。

---

## 1. 產品定位

FoodTrack 是「飲食紀錄＋營養分析＋食品支出記帳」的 App／Web App。它要回答三個問題：

1. 我今天吃了什麼、攝取多少熱量與營養？
2. 我的攝取是否符合個人目標？
3. 我在食品上花了多少錢，營養與價格的效益如何？

核心使用流程：

```text
建立個人資料 → 建立每日目標 → 掃條碼／拍營養標示
→ 確認食品與份量 → 加入某一餐 → 更新每日營養與支出
```

第一版的完整核心 Loop：

> 掃一下 → 選吃多少 → 加入午餐 → 熱量更新 → 支出完成。

---

## 2. MVP 產品需求

### 2.1 個人與營養目標

首次使用需收集：性別、出生日期／年齡、身高、體重、活動程度、目標（減脂、維持、增肌、增重）。

系統依資料計算 BMR、TDEE 與建議的熱量、蛋白質、脂肪、碳水目標；同時保留「系統計算值」與「使用者手動覆寫值」。體重與體脂必須以歷史紀錄保存，不能只覆寫在使用者主檔。

### 2.2 飲食與食品

- 餐別：早餐、午餐、晚餐、點心。
- 使用者可透過條碼、食品資料庫、掃描營養標示或手動輸入新增食品。
- 輸入食用重量／份數後，系統依結構化營養資料計算該餐與當日總計。
- `meal_items` 儲存當次營養快照，避免食品資料日後變更而改寫歷史紀錄。

### 2.3 記帳與分析

- 支出可記錄日期、金額、分類、商家、備註與收據影像。
- 食品可關聯購買／支出資料，支援食品支出、每 100 kcal 成本、每 10g 蛋白質成本等分析。
- Dashboard 顯示每日熱量與三大營養素進度、各餐摘要與當日支出。
- 統計頁預留營養、體重／體脂與食物支出的日、週、月趨勢。

### 2.4 建議資料模型

```text
auth.users / users
├── user_profiles
├── body_metrics
├── nutrition_targets
├── meals ── meal_items ── foods ── food_nutrition
│                              └── food_barcodes
├── expenses ── expense_categories
├── food_purchases
├── scan_records
└── audit_logs
```

主要表格責任：

| 表格 | 責任 |
|---|---|
| `user_profiles` | 個人基本資料、活動量與目標 |
| `body_metrics` | 體重、體脂等敏感的時間序列 |
| `nutrition_targets` | 每日／期間目標與計算快照 |
| `foods`、`food_nutrition` | 公開或受控的食品與營養資料 |
| `food_barcodes` | 條碼到食品的快速對應 |
| `meals`、`meal_items` | 使用者餐次與營養快照 |
| `expenses`、`food_purchases` | 支出、食品購買與可選的庫存延伸 |
| `scan_records` | 掃描狀態、候選資料、確認結果與來源 |
| `audit_logs` | 安全與重要操作的最小必要軌跡 |

---

## 3. 食品照片與辨識架構

不要讓 AI 僅憑食品照片「猜」熱量。優先使用包裝上的結構化營養標示；AI 的作用是協助 OCR 結果解析、正規化與比對。

```text
條碼掃描 ─────→ Barcode / Food DB ─┐
                                    ├→ 食品候選資料 → 使用者確認 → 加入餐點
食品營養標示照片 → OCR → AI Parser ─┘
                                  ↓
                           Nutrition Validation
```

照片流程：

```text
已登入使用者 → 受控上傳 → 私有儲存 → OCR → AI Parser
→ 候選食品／候選營養 → 後端驗證 → 使用者確認／修正
→ 正式個人餐點或受審核的食品資料
```

OCR 常見誤讀（如 `1l0` 與 `110`）不可自動當成正式資料。AI 只能建立 **Candidate**，不是真實來源（Truth）。對未知食品的共享食品庫寫入必須進入審核／受控匯入流程。

---

# 4. FoodTrack Backend Security Architecture V1

## 4.1 核心安全原則（不可違反）

| # | 原則 | 規則 |
|---:|---|---|
| 01 | Frontend 不可信 | 任何瀏覽器傳入的欄位、角色、ID、檔案與計算結果都未驗證。 |
| 02 | Backend 是唯一可信入口 | 所有資料寫入、敏感讀取、OCR 與 AI 呼叫必須由後端執行。 |
| 03 | 身分不可由前端決定 | 使用者 ID 必須從已驗證的 session/JWT 取得。 |
| 04 | 登入不等於授權 | 每個資源操作都須確認該使用者有權操作該筆資源。 |
| 05 | DB 再防一次 | PostgreSQL RLS 與約束是應用程式授權之外的最後防線。 |
| 06 | 最小權限 | 預設使用受 RLS 約束的身分；`service_role` 僅限例外系統工作。 |
| 07 | Secrets 永不進瀏覽器 | DB、Storage、OCR、AI、加密與服務金鑰僅存在 server environment。 |
| 08 | AI 不是可信資料來源 | AI 可解析、建議、標記信心度；不可直接寫入正式 Food Data。 |
| 09 | 上傳一律不可信 | 同時驗證大小、MIME、magic bytes、影像格式／尺寸與路徑歸屬。 |
| 10 | 安全可測試 | 每個資源、政策與 API 都須有越權、輸入、上傳與濫用測試。 |

## 4.2 Trust Boundary

```text
Internet（不可信）
        │ HTTPS
        ▼
Cloudflare：WAF、Bot 防護、DDoS、Rate Limit
        ▼
Frontend：Next.js / React（不可信）
        │ 只可呼叫公開定義的 HTTPS API
        ▼
╔══════════════ Backend Trust Boundary ══════════════╗
║ Authentication → Input Validation → Authorization   ║
║ → Business Logic → Audit → 最小化回應                ║
╚═══════════════╤═══════════════════════╤═════════════╝
                ▼                       ▼
        PostgreSQL + RLS         Private Storage
                │                       │
                └───────── Server-only ─┘
                            OCR / AI
```

應把「使用者可在 DevTools 修改 request、重送 request、猜 ID、重放請求」視為正常操作環境，而不是例外攻擊情境。

## 4.3 Frontend 不可信模型

前端可以知道 API endpoint、公開 request／response schema、公開食品資料與自己的資料。前端一定不可取得：

```text
DATABASE_URL / password
SUPABASE_SERVICE_ROLE_KEY
AI、OCR、Storage 管理金鑰
JWT signing secret、內部加密金鑰
後端授權邏輯與私有資料庫連線資訊
```

不可相信 request 中的 `user_id`、`role`、`is_admin`、`storage_path`、價格、營養計算結果或任何 client side flag。後端應自行取得使用者身分、生成物件路徑、重算衍生資料並做授權。

## 4.4 API 標準順序

所有 API 使用下列固定管線：

```text
Request → Rate Limit → Authentication → Schema Validation
→ Authorization → Business Logic → DB + RLS → Audit → Minimal Response
```

回應不得回傳祕密、完整第三方錯誤、非必要的個資或其他使用者資料。所有寫入 API 需採用嚴格 schema、欄位白名單與一致的錯誤碼。

## 4.5 Authentication 與 Authorization

- 使用受驗證 session/JWT；後端驗證簽章、到期時間、issuer／audience 與撤銷策略。
- `user_id` 從 authenticated context（例如 `auth.uid()`）讀取，絕不從 request body 讀取。
- 角色分為 `PUBLIC`、`USER`、`SYSTEM`、`ADMIN`；角色為伺服器端宣告／受控 claims，不接受前端傳值。
- `USER` 只可處理自己的 profile、body metrics、targets、meals、expenses、scan records 與私有檔案。
- `SYSTEM` 僅供受控背景工作，例如 OCR、匯入與內部資料維護；`ADMIN` 操作必須獨立授權、完整稽核。
- 任何以資源 ID 讀取、更新、刪除或簽發下載 URL 的操作，必須檢查資源歸屬，不能只依「已登入」。

## 4.6 PostgreSQL RLS 與資料庫約束

採取三層防禦：應用程式授權 → RLS → DB constraints／FK／資料型別。

- 所有個人表格啟用 RLS，`SELECT/INSERT/UPDATE/DELETE` 都有 policy。
- policy 以 `auth.uid()` 與資料列的 `user_id`（或透過安全 join）判斷；`WITH CHECK` 必須防止 insert/update 把資料歸給他人。
- 公開食品資料僅開放必要 `SELECT`；官方食品的寫入不可提供一般使用者。
- 對金額、重量與營養值設定非負值、合理上限、精度、enum、FK、唯一性與時間欄位約束。
- 外鍵關係和刪除策略必須避免跨使用者資料連結與孤兒資料。
- RLS 不是後端授權的替代品；兩者皆需存在。

## 4.7 Service Role 最小權限

`service_role` 是例外而非預設。一般使用者請求應使用可攜帶使用者身份、受 RLS 保護的資料庫 client。

只有下列受控系統工作可使用高權限：OCR ingestion、受審核的官方食品匯入、資料修復／migration、嚴格審核後的管理作業。要求：

- 金鑰僅存 server-side secret manager／環境變數，永不打包到 client。
- 封裝為狹窄職責的 service，不可任意傳 SQL 或表名。
- 逐項驗證輸入與資源歸屬，仍記錄 audit event。
- 盡可能以專用低權限 credentials 取代全域 service role。

## 4.8 Private Storage 與圖片上傳安全

食品掃描圖、收據與健康相關圖片一律放在 **Private Bucket**。物件路徑由後端生成，例如：

```text
users/{authenticated_user_id}/food-scans/{uuid}.jpg
users/{authenticated_user_id}/receipts/{uuid}.jpg
```

不得接受使用者指定任何 storage path。下載採短效、用途限定的 signed URL，簽發前再次檢查物件歸屬。上傳需要：

- 驗證已登入者、頻率與每人每日配額。
- 限制允許格式、真實 MIME / magic bytes、檔案大小、像素尺寸、解碼可行性與必要時的重編碼／移除 metadata。
- 拒絕 SVG／HTML／可執行格式、雙副檔名、惡意壓縮包、過大或 decompression-bomb 圖檔。
- 上傳至隔離的暫存區；通過驗證與掃毒（若採用）後才移至正式私有位置。
- 不使用可猜測檔名、公開 bucket 或永久 URL。

## 4.9 OCR / AI Server-only

前端只上傳受控圖片，不能直接持有或呼叫 OCR／LLM provider。後端才可：取用私有圖片、建立短效 provider input、呼叫 OCR／AI、記錄成本與結果狀態。

AI prompt 必須清楚限制任務為「擷取／正規化結構化資料」，並將 OCR／圖片中出現的文字視為不可信資料，而非指令。禁止讓模型決定權限、執行工具、選擇任意外部 URL 或接觸祕密。

## 4.10 AI 不可直接寫正式 Food Data

Critical Rule：

```text
錯誤：Photo → AI → foods
正確：Photo → OCR → AI Parser → Candidate → Validation
       → 使用者確認／受控審核 → 正式資料
```

AI 輸出必須是符合 JSON schema 的候選資料，附來源、信心度與可追溯的 scan record。未確認候選可供使用者建立自己的餐點，但不可自動污染共享／官方食品庫。

## 4.11 Nutrition Validation

後端對候選營養資料做 schema 與合理性檢查：

- 所有數值、單位、basis（每份／每 100g）與 serving size 必須存在且可解析。
- 營養、重量與價格不可為負，且須符合已定義的合理上限。
- 熱量與巨量營養素估算值（蛋白質、碳水各 4 kcal/g；脂肪 9 kcal/g）差距過大時標記異常。
- 單位轉換、百分比與 serving 倍數必須以後端固定函式計算。
- 缺欄位、低信心度、異常數值或衝突條碼時，要求使用者修正或人工審核，而非靜默寫入。

## 4.12 Rate Limit 與 AI Cost Guard

限流至少包含 IP、帳號與 endpoint 維度，並由 WAF 與後端共同實施。

| 類型 | 最低控制 |
|---|---|
| 一般 API | per-IP + per-user rate limit |
| 認證端點 | 反暴力破解、漸進延遲、bot 防護 |
| 上傳 | per-user 分鐘限額、大小與每日容量配額 |
| OCR | 每使用者每分鐘與每日次數配額 |
| AI | 每使用者每日請求／token／成本配額 |

AI Cost Guard 必須在呼叫 provider **之前** 原子性地檢查並保留預算；超額應直接拒絕或排入使用者已同意的低優先隊列。記錄估計與實際成本，並對異常尖峰警示。

## 4.13 Data Classification

| 等級 | 範例 | 基本規則 |
|---|---|---|
| Public | 已發布食品、條碼、公開營養資料 | 僅公開讀取；受控寫入。 |
| Personal | meals、expenses、掃描紀錄 | per-user RLS、最小 API 回應。 |
| Sensitive | body metrics、健康／穿戴資料、收據影像 | Private Storage、嚴格存取、避免寫入 log。 |
| Secret | API key、DB credentials、JWT／加密金鑰、service role | 僅 server-side secret store；輪替、最小存取與不記錄。 |

健康相關資料應以資料最小化、明確目的與保留期限設計；任何第三方整合需獨立同意、可撤銷並可刪除。

## 4.14 Audit Log

建立 append-only 或受嚴格限制的 `audit_logs`，至少記錄：登入／登出、帳號與設定變更、個人資料敏感操作、餐點／支出刪除、掃描、AI 請求、權限拒絕、高權限操作與管理操作。

每筆事件包含 actor、事件類型、目標類型與 ID、時間、結果、request／trace ID、最小必要的風險 metadata。不得寫入完整 request body、JWT、API key、完整健康資料或原始圖片。Audit log 的讀取限管理者且本身受稽核。

## 4.15 Security Testing

每個模組的測試至少包含：

- User A 可 CRUD 自己資源；不能讀、改、刪 User B 資源。
- 偽造／置換 `user_id`、role、resource ID、價格、熱量、storage path 無效。
- 未登入、過期 session、權限不足、RLS 繞過嘗試皆被拒絕。
- 私有圖片不可猜 path 下載；signed URL 過期失效；偽 MIME、超大檔、惡意檔、跨帳號路徑均拒絕。
- OCR／AI 超額、重放請求、格式不符、prompt injection 與異常輸出安全失敗。
- migration、RLS policy、管理端點、錯誤處理與 audit event 均有整合／端對端測試。

---

# 5. 下一階段：Threat Model（25 項）

在實作資料庫與 API 前，針對每項威脅指定 owner、控制措施、測試案例與剩餘風險：

| # | 威脅 | 主要防護 |
|---:|---|---|
| 1 | 偽造 `user_id` 建立／改寫資料 | 身分自 session、RLS `WITH CHECK` |
| 2 | IDOR 讀取他人餐點／支出 | 資源歸屬授權＋RLS |
| 3 | IDOR 修改或刪除他人資料 | 資源歸屬、RLS、審計 |
| 4 | 前端偽造 admin／system role | server-side claims、獨立 admin 授權 |
| 5 | JWT 偽造、過期或 token replay | 正確驗證、短時效、撤銷／rotation |
| 6 | 帳密暴力破解／credential stuffing | WAF、rate limit、MFA／bot 防護策略 |
| 7 | API 大量重放造成重複寫入 | idempotency key、交易與頻率限制 |
| 8 | SQL injection／不安全 query | 參數化、ORM、schema validation |
| 9 | Mass assignment 覆寫敏感欄位 | DTO 白名單、拒絕未知欄位 |
| 10 | RLS policy 遺漏或錯誤 | policy test、migration review、deny-by-default |
| 11 | service role key 外洩至 client／log | server-only secrets、secret scan、rotation |
| 12 | 高權限服務被濫用 | 窄介面、審計、最小權限 credentials |
| 13 | 猜測私有 Storage path | UUID 路徑、private bucket、授權簽 URL |
| 14 | 使用者指定他人 Storage path | server 生成 path、owner check |
| 15 | 惡意檔、偽 MIME、圖片炸彈 | magic bytes、解碼、尺寸／大小限制、隔離 |
| 16 | 公開或長效下載 URL 外洩 | private bucket、短效 signed URL、最小 TTL |
| 17 | OCR／AI API key 外洩 | server-only 呼叫、secret manager、輪替 |
| 18 | Prompt injection 影響 AI 行為 | 不信任輸入隔離、固定 schema、無授權工具 |
| 19 | AI hallucination 污染食品庫 | Candidate、validation、使用者確認／人工審核 |
| 20 | 營養單位／計算操弄 | 後端計算、合理性／熱量交叉驗證 |
| 21 | AI/OCR 成本濫用 | 前置配額、原子預算保留、告警 |
| 22 | 針對掃描／上傳的 DoS | WAF、檔案／請求限制、queue、timeouts |
| 23 | 敏感健康資料進入 logs／analytics | data minimization、redaction、存取分級 |
| 24 | 管理端點或 audit log 被濫用 | 強身份驗證、最小角色、完整稽核 |
| 25 | 第三方 OCR／AI／食品資料供應鏈風險 | vendor review、scope/egress 限制、timeout、fallback |

---

# 6. 建議技術分層

```text
Frontend (Next.js / React / TypeScript)
        ↓ HTTPS
API Gateway / Route Layer
  Auth · Rate Limit · Schema Validation · Authorization
        ↓
Service Layer
  Food · Meal · Exercise · Expense · Energy · Scan
        ↓                    ↓
PostgreSQL + RLS       Private Storage
        ↓                    ↓
     Constraints          OCR / AI（Server Only）
```

可行的第一版方向：Next.js + TypeScript、Tailwind CSS、PostgreSQL、Supabase Auth／Storage、後端 API／service layer、條碼食品資料來源（例如公開資料庫＋自建資料庫），及受控的 OCR + LLM parser。實際供應商選定前不得將任何金鑰或 provider-specific 權限設計放進前端。

---

# 7. Claude 交接指示

Claude 在此文件基礎上工作時，請遵守以下要求：

1. 把本文件當成產品需求與安全基線；安全規則和 RLS 不可因快速開發而省略。
2. 先產出／確認三份規格，再寫 UI 或 CRUD：
   - `01_SECURITY_ARCHITECTURE.md`：本文件安全架構、威脅模型與測試矩陣。
   - `02_DATABASE_SCHEMA.md`：所有 table、欄位、PK/FK、index、constraint、enum、trigger、每張個人表的 RLS policy。
   - `03_API_SECURITY_SPEC.md`：每個 endpoint 的 actor、request／response schema、validation、authorization、rate limit、audit event、錯誤碼與 idempotency。
3. 前端只負責顯示與操作；所有 secrets、AI/OCR、私有檔案授權、營養重算和寫入均由後端負責。
4. 實作任何資料表或 endpoint 時，同時提供其 RLS policy 和 User A／User B 越權測試；沒有測試不可視為完成。
5. 食品照片與 OCR／AI 結果必須走「候選 → 驗證 → 使用者確認／受控審核」；不得自動寫入官方食品資料。
6. 避免將完整敏感資料寫進 log、錯誤訊息或 analytics；回應使用最小必要資料。
7. 如需求與本文件有衝突，停止假設，明確提出風險與可選方案，再請產品 owner 決定。

## 建議實作順序

1. 完成資料分類、威脅模型與 security/API/database specs。
2. 建立 Auth、RLS、個人資料、body metrics、nutrition targets 與安全測試基線。
3. 建立食品、條碼、餐點、餐點營養快照與 Dashboard API。
4. 建立支出與食品購買關聯。
5. 最後接上私有圖片上傳、OCR、AI parser、成本控管與審核流程。

## MVP 完成條件

使用者可安全地建立個人資料與目標、透過條碼或受驗證的食品資料新增餐點與支出、看到當日營養／支出摘要；跨使用者資料、私有影像與任何 AI／OCR secret 都無法由瀏覽器直接存取。
