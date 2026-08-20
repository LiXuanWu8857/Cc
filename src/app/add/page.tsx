"use client";
import { useEffect, useState } from "react";
import { api, ApiError, foodNutrition, type BarcodeExternal, type BarcodeLocal, type Food, type NutritionPer100g } from "@/lib/client/api";
import { BarcodeScanner, isBarcodeScanSupported } from "@/components/BarcodeScanner";

type Tab = "barcode" | "search" | "manual";
interface Chosen { id: string; name: string; per100g: NutritionPer100g; defaultServingG?: number }
const MEALS: [string, string][] = [["breakfast", "早餐"], ["lunch", "午餐"], ["dinner", "晚餐"], ["snack", "點心"]];

const today = () => new Date().toISOString().slice(0, 10);

export default function AddPage() {
  const [tab, setTab] = useState<Tab>("barcode");
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function pickFood(f: Food) {
    const n = foodNutrition(f);
    if (!n) { setErr("這筆食品缺少營養資料"); return; }
    setChosen({
      id: f.id, name: f.name,
      per100g: { caloriesKcal: n.calories_kcal, proteinG: n.protein_g, fatG: n.fat_g, carbsG: n.carbs_g },
      defaultServingG: f.default_serving_g ?? undefined,
    });
    setErr(null);
  }

  return (
    <main className="app">
      <div className="page-head">
        <p className="eyebrow">加入餐點</p>
        <h1>加入食物</h1>
      </div>

      {flash && <div className="ok-note">{flash}</div>}
      {err && <div className="err">{err}</div>}

      {chosen ? (
        <AddToMeal chosen={chosen} onDone={(msg) => { setChosen(null); setFlash(msg); }} onCancel={() => setChosen(null)} />
      ) : (
        <>
          <div className="seg" style={{ marginBottom: 16 }}>
            <button className={tab === "barcode" ? "on" : ""} onClick={() => setTab("barcode")} type="button">條碼</button>
            <button className={tab === "search" ? "on" : ""} onClick={() => setTab("search")} type="button">搜尋</button>
            <button className={tab === "manual" ? "on" : ""} onClick={() => setTab("manual")} type="button">手動</button>
          </div>
          {tab === "barcode" && <BarcodeTab onFood={pickFood} onError={setErr} />}
          {tab === "search" && <SearchTab onPick={pickFood} onError={setErr} />}
          {tab === "manual" && <ManualTab onCreated={setChosen} onError={setErr} />}
        </>
      )}
    </main>
  );
}

/* --------------------------- Barcode --------------------------- */
function BarcodeTab({ onFood, onError }: { onFood: (f: Food) => void; onError: (m: string) => void }) {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<BarcodeExternal["candidate"] | null>(null);
  // Guard the camera button behind mount so SSR (no BarcodeDetector) and the
  // client render agree — avoids a hydration mismatch.
  const [canScan, setCanScan] = useState(false);
  useEffect(() => { setCanScan(isBarcodeScanSupported()); }, []);

  async function lookup(raw: string) {
    const bc = raw.trim();
    if (!/^[0-9]{8,14}$/.test(bc)) { onError("條碼需為 8–14 位數字"); return; }
    setBusy(true);
    setCandidate(null);
    try {
      const r = await api.get<BarcodeLocal | BarcodeExternal>(`/api/foods/barcode/${bc}`);
      if (r.source === "local") onFood(r.match.foods);
      else setCandidate(r.candidate);
    } catch (e) {
      onError(e instanceof ApiError && e.status === 404 ? "查無此條碼，試試搜尋或手動輸入。" : "查詢失敗");
    } finally {
      setBusy(false);
    }
  }

  if (candidate) {
    return (
      <div className="card">
        <p className="card-title">來自 OpenFoodFacts · 請確認</p>
        {candidate.warnings.length > 0 && <div className="err">標示可能有誤，請核對：{candidate.warnings[0]}</div>}
        <ConfirmNutrition
          initialName={candidate.name}
          initialBrand={candidate.brand}
          initialBarcode={candidate.barcode}
          initialDefaultServingG={candidate.defaultServingG}
          initial={candidate.nutritionPer100g}
          onCreated={onFood}
          onError={onError}
        />
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setCandidate(null)}>取消</button>
      </div>
    );
  }

  return (
    <div className="card">
      <p className="card-title">掃描或輸入條碼</p>
      {scanning ? (
        <BarcodeScanner onDetect={(c) => { setScanning(false); setCode(c); lookup(c); }} onClose={() => setScanning(false)} />
      ) : (
        canScan && (
          <button className="btn" type="button" onClick={() => setScanning(true)} style={{ marginBottom: 12 }}>📷 開啟相機掃描</button>
        )
      )}
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="bc">條碼</label>
          <input id="bc" className="input" inputMode="numeric" placeholder="4710…" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <button className="btn btn-primary" style={{ flex: "0 0 auto", width: "auto" }} disabled={busy} onClick={() => lookup(code)}>
          {busy ? "查詢…" : "查詢"}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>本地查不到時會自動查 OpenFoodFacts（免費）。</p>
    </div>
  );
}

/* --------------------------- Search --------------------------- */
function SearchTab({ onPick, onError }: { onPick: (f: Food) => void; onError: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Food[]>([]);
  const [busy, setBusy] = useState(false);

  async function search() {
    if (q.trim().length === 0) return;
    setBusy(true);
    try {
      const r = await api.get<{ foods: Food[] }>(`/api/foods?q=${encodeURIComponent(q.trim())}`);
      setResults(r.foods);
    } catch { onError("搜尋失敗"); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <p className="card-title">搜尋你的食品</p>
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="row" style={{ marginBottom: 8 }}>
        <input className="input" placeholder="輸入食品名稱" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary" style={{ flex: "0 0 auto", width: "auto" }} disabled={busy} type="submit">搜尋</button>
      </form>
      {results.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>搜尋官方與你自己建立的食品。</p>
      ) : (
        <div className="list">
          {results.map((f) => {
            const n = foodNutrition(f);
            return (
              <button key={f.id} className="list-row" onClick={() => onPick(f)} style={{ background: "none", border: 0, borderBottom: "1px solid var(--border)", textAlign: "left", cursor: "pointer", width: "100%" }}>
                <div className="main">
                  <div className="t">{f.name} {f.is_official && <span className="badge">官方</span>}</div>
                  <div className="s">{f.brand ?? ""}</div>
                </div>
                <div className="num">{n ? Math.round(n.calories_kcal) : "—"}<br /><span className="muted" style={{ fontSize: 11 }}>kcal/100g</span></div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Manual --------------------------- */
function ManualTab({ onCreated, onError }: { onCreated: (c: Chosen) => void; onError: (m: string) => void }) {
  return (
    <div className="card">
      <p className="card-title">手動新增食品（每 100g）</p>
      <ConfirmNutrition
        initialName=""
        initial={{ caloriesKcal: 0, proteinG: 0, fatG: 0, carbsG: 0 }}
        onCreated={(f) => {
          const n = foodNutrition(f)!;
          onCreated({ id: f.id, name: f.name, per100g: { caloriesKcal: n.calories_kcal, proteinG: n.protein_g, fatG: n.fat_g, carbsG: n.carbs_g }, defaultServingG: f.default_serving_g ?? undefined });
        }}
        onError={onError}
      />
    </div>
  );
}

/* ---- shared nutrition form: creates a private food via POST /api/foods ---- */
function ConfirmNutrition({
  initialName, initialBrand, initialBarcode, initialDefaultServingG, initial, onCreated, onError,
}: {
  initialName: string; initialBrand?: string; initialBarcode?: string; initialDefaultServingG?: number;
  initial: NutritionPer100g; onCreated: (f: Food) => void; onError: (m: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [brand, setBrand] = useState(initialBrand ?? "");
  const [cal, setCal] = useState(String(initial.caloriesKcal));
  const [pro, setPro] = useState(String(initial.proteinG));
  const [fat, setFat] = useState(String(initial.fatG));
  const [carb, setCarb] = useState(String(initial.carbsG));
  const [busy, setBusy] = useState(false);

  async function create() {
    if (name.trim().length === 0) { onError("請輸入名稱"); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        nutritionPer100g: { caloriesKcal: Number(cal), proteinG: Number(pro), fatG: Number(fat), carbsG: Number(carb) },
      };
      if (brand.trim()) body.brand = brand.trim();
      if (initialBarcode) body.barcode = initialBarcode;
      if (initialDefaultServingG) body.defaultServingG = initialDefaultServingG;
      const { id } = await api.post<{ id: string }>("/api/foods", body);
      onCreated({
        id, name: name.trim(), brand: brand.trim() || null, is_official: false,
        default_serving_g: initialDefaultServingG ?? null,
        food_nutrition: { calories_kcal: Number(cal), protein_g: Number(pro), fat_g: Number(fat), carbs_g: Number(carb) },
      });
    } catch (e) {
      onError(e instanceof ApiError ? firstDetail(e) ?? e.message : "建立失敗");
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="field"><label>名稱</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>品牌（選填）</label><input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} /></div>
      <div className="row">
        <div className="field"><label>熱量 kcal</label><input className="input" inputMode="decimal" value={cal} onChange={(e) => setCal(e.target.value)} /></div>
        <div className="field"><label>蛋白 g</label><input className="input" inputMode="decimal" value={pro} onChange={(e) => setPro(e.target.value)} /></div>
      </div>
      <div className="row">
        <div className="field"><label>脂肪 g</label><input className="input" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} /></div>
        <div className="field"><label>碳水 g</label><input className="input" inputMode="decimal" value={carb} onChange={(e) => setCarb(e.target.value)} /></div>
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={create}>{busy ? "建立中…" : "確認並選份量"}</button>
    </div>
  );
}

/* --------------------------- Add to meal --------------------------- */
function AddToMeal({ chosen, onDone, onCancel }: { chosen: Chosen; onDone: (msg: string) => void; onCancel: () => void }) {
  const [mealType, setMealType] = useState("lunch");
  const [qty, setQty] = useState(String(chosen.defaultServingG ?? 100));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const grams = Number(qty) || 0;
  const factor = grams / 100;
  const kcal = Math.round(chosen.per100g.caloriesKcal * factor);

  async function add() {
    setErr(null);
    setBusy(true);
    try {
      // find-or-create the meal for this type today, then append the item.
      const { meals } = await api.get<{ meals: { id: string; meal_type: string }[] }>(`/api/meals?date=${today()}`);
      let mealId = meals.find((m) => m.meal_type === mealType)?.id;
      if (!mealId) {
        const r = await api.post<{ id: string }>("/api/meals", { mealType });
        mealId = r.id;
      }
      await api.post("/api/meal-items", { mealId, foodId: chosen.id, quantityG: grams });
      onDone(`已加入${MEALS.find(([k]) => k === mealType)?.[1]}：${chosen.name} · ${kcal} kcal`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "加入失敗");
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 10 }}>
        <p className="card-title" style={{ margin: 0 }}>{chosen.name}</p>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>換一個</button>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="field">
        <label>餐別</label>
        <div className="seg">
          {MEALS.map(([k, l]) => <button key={k} type="button" className={mealType === k ? "on" : ""} onClick={() => setMealType(k)}>{l}</button>)}
        </div>
      </div>
      <div className="field">
        <label htmlFor="qty">份量 (g)</label>
        <input id="qty" className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>
      <div className="spread" style={{ margin: "4px 0 14px" }}>
        <span className="muted">這份約</span>
        <span className="mono" style={{ fontSize: 20, fontWeight: 500 }}>{kcal} kcal</span>
      </div>
      <button className="btn btn-primary" disabled={busy || grams <= 0} onClick={add}>{busy ? "加入中…" : "加入餐點"}</button>
    </div>
  );
}

function firstDetail(e: ApiError): string | null {
  const d = e.details as Record<string, string[]> | undefined;
  if (!d) return null;
  const first = Object.values(d)[0];
  return Array.isArray(first) ? first[0] ?? null : null;
}
