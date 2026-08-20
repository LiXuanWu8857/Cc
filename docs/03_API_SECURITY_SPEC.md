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

## 待補（後續階段）

- API 整合測試：未登入、過期 session、偽造 role/id、重放、跨帳號存取。
- Phase 3+：foods / meals / expenses / scan endpoints，皆須補齊本文件對應章節與越權測試。
