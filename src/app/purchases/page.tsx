"use client";
import { useEffect, useState } from "react";
import {
  api, ApiError, type Food, type FoodPurchase, type PurchasesResp, purchaseFoodName,
} from "@/lib/client/api";

/** Food purchase log + cost-efficiency analysis (§2.3). */
export default function Purchases() {
  const [purchases, setPurchases] = useState<FoodPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // add form
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Food[]>([]);
  const [picked, setPicked] = useState<Food | null>(null);
  const [grams, setGrams] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function load() {
    api.get<PurchasesResp>("/api/food-purchases")
      .then((r) => setPurchases(r.purchases))
      .catch((e) => setErr(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  // debounced food search
  useEffect(() => {
    if (picked) return;
    const term = q.trim();
    if (term.length === 0) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get<{ foods: Food[] }>(`/api/foods?q=${encodeURIComponent(term)}`)
        .then((r) => setResults(r.foods))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, picked]);

  async function addPurchase(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setNote(null);
    if (!picked) { setErr("請先選擇食品"); return; }
    setBusy(true);
    try {
      await api.post("/api/food-purchases", {
        foodId: picked.id,
        quantityG: Number(grams),
        price: Number(price),
      });
      setNote(`已記錄「${picked.name}」`);
      setPicked(null); setQ(""); setGrams(""); setPrice(""); setResults([]);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  }

  // Best protein value: lowest cost per 10 g protein.
  const withProtein = purchases.filter((p) => p.cost.costPer10gProtein != null);
  const bestProtein = withProtein.length
    ? withProtein.reduce((a, b) => (a.cost.costPer10gProtein! <= b.cost.costPer10gProtein! ? a : b))
    : null;

  return (
    <main className="app">
      <div className="page-head">
        <p className="eyebrow">分析</p>
        <h1>採購成本</h1>
      </div>

      {err && <div className="err">{err}</div>}
      {note && <div className="ok-note">{note}</div>}

      <form onSubmit={addPurchase} className="card">
        <p className="card-title">記一筆採購</p>
        {picked ? (
          <div className="spread" style={{ marginBottom: 12 }}>
            <div><div className="t" style={{ fontWeight: 600 }}>{picked.name}</div>
              {picked.brand && <div className="s muted" style={{ fontSize: 12 }}>{picked.brand}</div>}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(null)}>更換</button>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="q">食品</label>
            <input id="q" className="input" placeholder="搜尋食品名稱…" value={q} onChange={(e) => setQ(e.target.value)} />
            {results.length > 0 && (
              <div className="card" style={{ marginTop: 8, padding: 6 }}>
                {results.map((f) => (
                  <button key={f.id} type="button" className="pick-row" onClick={() => { setPicked(f); setResults([]); }}>
                    <span>{f.name}{f.is_official && <span className="badge" style={{ marginLeft: 8 }}>官方</span>}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="row">
          <div className="field">
            <label htmlFor="g">數量 (g)</label>
            <input id="g" className="input" type="number" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="p">價格</label>
            <input id="p" className="input" type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </div>
        </div>
        <button className="btn btn-primary" disabled={busy || !picked} type="submit">
          {busy ? "記錄中…" : "記錄採購"}
        </button>
      </form>

      {bestProtein && (
        <div className="card" style={{ background: "var(--accent-soft)", borderColor: "color-mix(in srgb, var(--accent) 30%, transparent)" }}>
          <p className="card-title" style={{ color: "var(--accent)" }}>本期最划算的蛋白質</p>
          <div className="spread">
            <span style={{ fontWeight: 600 }}>{purchaseFoodName(bestProtein)}</span>
            <span className="mono">{bestProtein.cost.costPer10gProtein} / 10g 蛋白</span>
          </div>
        </div>
      )}

      <div className="card">
        <p className="card-title">本月採購</p>
        {loading ? (
          <p className="empty">載入中…</p>
        ) : purchases.length === 0 ? (
          <p className="empty">還沒有採購紀錄。搜尋食品、填數量與價格記一筆吧。</p>
        ) : (
          <div className="list">
            {purchases.map((p) => (
              <div className="list-row" key={p.id}>
                <div className="main">
                  <div className="t">{purchaseFoodName(p)}</div>
                  <div className="s">
                    {p.quantity_g}g · {p.price} {p.currency}
                    {p.cost.costPer100Kcal != null && <> · {p.cost.costPer100Kcal}/100kcal</>}
                  </div>
                </div>
                <div className="num">
                  {p.cost.costPer10gProtein != null
                    ? <>{p.cost.costPer10gProtein}<span className="muted" style={{ fontSize: 11 }}>/10g蛋白</span></>
                    : <span className="muted" style={{ fontSize: 12 }}>—</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
