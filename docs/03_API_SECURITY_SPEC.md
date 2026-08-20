# 03 — API Security Spec

> 每個 endpoint 的 actor、request/response schema、validation、authorization、
> rate limit、audit event、錯誤碼與 idempotency。目前涵蓋 **Phase 2** 三個 endpoint。

## 通用管線

所有 endpoint 經 `withPipeline()`（`src/lib/api/pipeline.ts`）：

```
Rate Limit(per-IP + per-user) → Auth(getUser) → Schema(zod .strict)
→ Authorization(RLS-bound client) → Logic → DB+RLS → Audit(RPC) → Minimal Response
```

### 錯誤碼（`src/lib/api/errors.ts`）

| code | HTTP | 意義 |
|---|---:|---|
| `rate_limited` | 429 | 超過限流 |
| `unauthenticated` | 401 | 無有效 session |
| `forbidden` | 403 | 已登入但無權 |
| `validation_failed` | 422 | schema 驗證失敗（附 field details） |
| `not_found` | 404 | 資源不存在或不屬於呼叫者 |
| `conflict` | 409 | 唯一性 / 狀態衝突 |
| `internal_error` | 500 | 未預期錯誤（不洩漏內部訊息） |

回應形狀：`{ "error": { "code", "message", "details?" }, "requestId" }`。

### 限流政策（`rate-limit.ts`）

| 政策 | 限制 |
|---|---|
| `default`（讀取） | 60 req / 60s |
| `write`（寫入） | 30 req / 60s |

> 上傳 / OCR / AI 的專屬配額待 Phase 5（交接文件 §4.12）。

### Idempotency

Phase 2 的寫入為 upsert（profile）或天然單筆 append（body_metric）/ 每日唯一（target），
尚未引入 `Idempotency-Key`。重放造成重複寫入的防護（Threat Model #7）將於支出／掃描寫入端點引入 idempotency key + 交易。

---

## `GET /api/profile`

- **Actor**：`USER`（已登入）。
- **Request**：無 body。
- **Authorization**：RLS 只回 `auth.uid()` 的 row。
- **Response 200**：`{ "profile": { user_id, display_name, sex, birth_date, height_cm, activity_level, goal, created_at, updated_at } | null }`。
- **Rate**：default。**Audit**：無（唯讀）。

## `PUT /api/profile`

- **Actor**：`USER`。
- **Request（zod `upsertProfileSchema`, strict）**：
  ```json
  { "displayName?": "string(1..80)", "sex": "male|female|other|prefer_not_to_say",
    "birthDate": "YYYY-MM-DD(≤today, ≥1900)", "heightCm": "number(0..300)",
    "activityLevel": "sedentary|light|moderate|active|very_active",
    "goal": "lose_fat|maintain|gain_muscle|gain_weight" }
  ```
  **拒絕**：未知欄位、`user_id`、`role` 等（strict）。
- **Authorization**：`user_id = session user`；RLS `WITH CHECK` 二次保證。
- **Response 200**：`{ "ok": true }`。
- **Rate**：write。**Audit**：`profile.upsert`。
- **錯誤**：422（驗證）、401（未登入）、429。

## `GET /api/body-metrics`

- **Actor**：`USER`。**Request**：無 body。
- **Authorization**：RLS 限本人；回最多 200 筆，`measured_at desc`。
- **Response 200**：`{ "metrics": [ { id, measured_at, weight_kg, body_fat_pct, note } ] }`。
- **分級**：Sensitive —— 最小欄位、不寫入 log。
- **Rate**：default。**Audit**：無（唯讀）。

## `POST /api/body-metrics`

- **Actor**：`USER`。
- **Request（`createBodyMetricSchema`, strict）**：
  ```json
  { "weightKg?": "number(0..700)", "bodyFatPct?": "number(0..100)",
    "measuredAt?": "ISO datetime(≤now)", "note?": "string(≤500)" }
  ```
  至少一項 `weightKg` / `bodyFatPct`。
- **語意**：時間序列 append，永不覆寫歷史。
- **Response 201**：`{ "id": "uuid" }`。
- **Rate**：write。**Audit**：`body_metric.create`。

## `GET /api/nutrition-targets`

- **Actor**：`USER`。**Request**：無 body。
- **Authorization**：RLS 限本人；回 `is_active = true` 且最新 `effective_date` 一筆。
- **Response 200**：`{ "target": { ...system, ...override, ...effective, source, is_active } | null }`。
- **Rate**：default。**Audit**：無（唯讀）。

## `POST /api/nutrition-targets`

- **Actor**：`USER`。
- **Request（`recomputeTargetsSchema`, strict）**：
  ```json
  { "overrides?": { "caloriesKcal?": "int(0..20000)", "proteinG?": "number(0..2000)",
                    "fatG?": "number(0..2000)", "carbsG?": "number(0..2000)" } }
  ```
  **不接受** system 計算值 —— 後端一律以 profile + 最新體重重算（§4.11）。
- **Logic**：讀本人 profile + 最新 `weight_kg` → `calcTargets()` → 停用今日既有 active → insert 新 active row。
- **Authorization**：全程 RLS-bound；`user_id = session user`。
- **Response 201**：`{ "target": { ... } }`。
- **錯誤**：422（profile 未完成 / 無體重紀錄）、401、429。
- **Rate**：write。**Audit**：`nutrition_target.recompute`（`risk_meta.source`）。

---

## Phase 3 — 食品與餐點

### `GET /api/foods?q=`
- **Actor**：`USER`。**Request**：query `q`（字串；空則回 `[]`）。
- **Authorization**：RLS `foods_select_visible`（官方 + 本人）；名稱 `ilike`（參數化，非字串拼接；並移除 `%`/`_` wildcard），上限 25 筆。
- **Response 200**：`{ "foods": [ { id, name, brand, is_official, default_serving_g, food_nutrition:{...} } ] }`。

### `POST /api/foods`
- **Actor**：`USER`。**Request（`createFoodSchema`, strict）**：
  ```json
  { "name": "1..200", "brand?": "...", "defaultServingG?": "num",
    "barcode?": "8..14 digits",
    "nutritionPer100g": { "caloriesKcal":0..1000, "proteinG":0..100,
      "fatG":0..100, "carbsG":0..100, "fiberG?":.., "sugarG?":.., "sodiumMg?":.. } }
  ```
- **Validation**：schema 邊界 + `validateNutritionPer100g`（熱量 vs 巨量營養素交叉檢查）；不符回 422 要求修正（§4.11，不靜默寫入）。
- **語意**：僅能建立**私有**食品（`owner = session user`, `is_official = false`）；經 `create_user_food` RPC 原子建立 food + nutrition + 選填 barcode。
- **Response 201**：`{ "id": "uuid" }`。**Audit**：`food.create`。**Rate**：write。

### `GET /api/foods/barcode/:barcode`
- **Actor**：`USER`。**Request**：path `barcode`（8–14 位數，否則 422）；query `external=0` 可關閉外部查詢。
- **順序**：(1) 本地目錄（RLS 限官方 + 本人）；(2) 查無 → **OpenFoodFacts**（免費）。
- **外部資料為候選，不寫入**（§4.10）：回傳候選供前端預填，使用者確認後才經 `POST /api/foods` 建立（後端二次驗證）。OpenFoodFacts 為不可信社群資料，fail-soft（網路錯誤/查無 → 404，不 500）。
- **Response 200**：
  - 本地命中：`{ "source":"local", "match":{ barcode, foods:{ ..., food_nutrition:{...} } } }`
  - 外部命中：`{ "source":"openfoodfacts", "candidate":{ name, brand?, barcode, defaultServingG?, nutritionPer100g:{...}, warnings:[...] } }`（`warnings` 為熱量交叉檢查等提示，供 UI 標示；使用者確認時仍會二次驗證）
- **Provider 可抽換**：`src/lib/foods/openFoodFacts.ts`；換付費條碼庫只需換此 provider。

### `POST /api/meals`
- **Actor**：`USER`。**Request（`createMealSchema`, strict）**：`{ mealType, consumedOn?, note? }`。
- **Response 201**：`{ "id": "uuid" }`。**Audit**：`meal.create`。**Rate**：write。

### `GET /api/meals?date=YYYY-MM-DD`
- **Actor**：`USER`。預設今日。RLS 限本人；回該日 meals 及其 items。
- **Response 200**：`{ "meals": [ { id, meal_type, consumed_on, note, meal_items:[...] } ] }`。

### `POST /api/meal-items`
- **Actor**：`USER`。**Request（`addMealItemSchema`, strict）**：`{ mealId, foodId, quantityG, servingLabel? }`。
  **不接受** 熱量/巨量營養素 —— 後端從 `food_nutrition` 讀取並依 `quantityG` 換算。
- **Authorization**：先確認 meal 屬本人（RLS-scoped 讀，否則 404）；food 須本人可見；RLS `WITH CHECK` 二次確認 meal 歸屬。
- **語意**：寫入**營養快照**（§2.2），日後食品變更不改寫。
- **Response 201**：`{ "item": { id, calories_kcal, protein_g, fat_g, carbs_g } }`。**Audit**：`meal_item.create`。

### `DELETE /api/meal-items/:id`
- **Actor**：`USER`。RLS 限本人；影響 0 列 → 404（不揭露是否存在）。
- **Response 200**：`{ "ok": true }`。**Audit**：`meal_item.delete`。

### `GET /api/dashboard?date=YYYY-MM-DD`
- **Actor**：`USER`。預設今日。
- **語意**：由 `meal_items` **快照**加總（不從 foods 重算），對照 active target 算進度。
- **Response 200**：`{ date, totals, perMeal:{breakfast,lunch,dinner,snack}, target, progress:{caloriesPct,...}, spending:null } }`（spending 待 Phase 4）。

---

## Phase 4 — 支出與成本分析

### `GET/POST /api/expense-categories`
- **Actor**：`USER`。GET 回本人分類。POST（`createExpenseCategorySchema`）：`{ name }`；名稱重複 → 409（unique）。**Audit**：`expense_category.create`。

### `GET /api/expenses?from=&to=`
- **Actor**：`USER`。預設當月。RLS 限本人。
- **Response 200**：`{ from, to, expenses:[...], totalsByCurrency:{TWD:..} }`（依幣別分開加總）。

### `POST /api/expenses`
- **Actor**：`USER`。**Request（`createExpenseSchema`, strict）**：`{ amount, currency?, spentOn?, categoryId?, merchant?, note? }`。
- **Authorization**：RLS `WITH CHECK` 確認 `categoryId`（若有）屬本人；未知分類 → 422/policy 錯誤。
- **Response 201**：`{ id }`。**Audit**：`expense.create`。**Rate**：write。

### `POST /api/food-purchases`
- **Actor**：`USER`。**Request（`createFoodPurchaseSchema`, strict）**：`{ quantityG, price, currency?, purchasedOn?, foodId?, expenseId? }`。
  **不接受** 成本比率或營養總量。
- **語意**：若連結 `foodId`（本人可見），後端讀 `food_nutrition` 依 `quantityG` 換算，**快照** `total_calories_kcal` / `total_protein_g`。RLS `WITH CHECK` 確認 linked expense/food 歸屬。
- **Response 201**：`{ id, cost:{ costPer100Kcal, costPer10gProtein } }`（成本後端計算）。**Audit**：`food_purchase.create`。

### `GET /api/food-purchases?from=&to=`
- **Actor**：`USER`。預設當月。RLS 限本人。
- **Response 200**：`{ from, to, purchases:[ { ..., cost:{ costPer100Kcal, costPer10gProtein } } ] }`（成本由 price + 快照營養即時計算，不入庫）。

### `GET /api/dashboard`（更新）
- `spending` 欄位已接上：`{ byCurrency:{TWD:..}, count }` —— 當日支出依幣別加總。

---

## Phase 5 — 掃描（影像 → OCR → AI 候選 → 確認）

> OCR/AI 供應商**尚未設定**（可抽換介面預留）。`process` 在供應商接上前回 501 並退還已預留的預算。

### `POST /api/scans`
- **Actor**：`USER`。**Request（`createScanSchema`）**：`{ kind: nutrition_label|receipt }`。
- **語意**：後端生成私有 `object_path`（client 不可指定，§4.8），建立 `scan_records`，回短效 **signed upload URL**；storage RLS 另限制上傳到本人 uid 前綴。
- **Response 201**：`{ scanId, upload:{ bucket, path, signedUrl, token } }`。**Audit**：`scan.create`。

### `GET /api/scans` / `GET /api/scans/:id`
- **Actor**：`USER`。RLS 限本人。回掃描狀態、候選、驗證問題；非本人 → 404。

### `POST /api/scans/:id/process`
- **Actor**：`USER`。**管線順序**：載入（RLS）→ **原子預留 AI 預算**（超額 → 429，未呼叫任何 provider）→ 讀私有圖 → `validateImageBytes`（magic bytes/尺寸/大小，§4.8）→ OCR → AI parse → 候選經 `validateNutritionPer100g`。
- **候選只存不自動升級為食品**（§4.10）。
- **目前**：供應商未設定 → **501**（`not_implemented`），並 `settle_ai_cost(0)` 退還預留。
- **Audit**：`scan.process`。

### `POST /api/scans/:id/confirm`
- **Actor**：`USER`。**Request（`confirmScanSchema`）**：使用者最終確認/修正的候選（`{ name, brand?, barcode?, defaultServingG?, nutritionPer100g }`）。
- **語意**：**人在迴路** —— 唯有使用者確認才經 `validateNutritionPer100g` + `create_user_food` 建立**私有**食品並連結 `confirmed_food_id`；AI 永不自行寫食品資料。
- **Response 201**：`{ scanId, foodId, status:"confirmed" }`。**Audit**：`scan.confirm`。

---

## 待補（後續階段）

- 接上實際 OCR/AI 供應商（實作 `OcrProvider` / `NutritionParser`，金鑰只在 server env）。
- API 整合測試：未登入、過期 session、偽造 role/id、重放、跨帳號存取、prompt injection。
