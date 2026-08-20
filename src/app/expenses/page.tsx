"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";

interface Expense {
  id: string; spent_on: string; amount: number; currency: string;
  category_id: string | null; merchant: string | null; note: string | null;
}
interface Category { id: string; name: string }
interface ExpensesResp { from: string; to: string; expenses: Expense[]; totalsByCurrency: Record<string, number> }

export default function ExpensesPage() {
  const [data, setData] = useState<ExpensesResp | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [ex, ct] = await Promise.all([
        api.get<ExpensesResp>("/api/expenses"),
        api.get<{ categories: Category[] }>("/api/expense-categories"),
      ]);
      setData(ex);
      setCats(ct.categories);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "載入失敗");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <main className="app">
      <div className="page-head">
        <p className="eyebrow">記帳</p>
        <h1>食品支出</h1>
      </div>
      {err && <div className="err">{err}</div>}

      <AddExpense cats={cats} onCat={(c) => setCats((p) => [...p, c])} onAdded={load} />

      <div className="card">
        <div className="spread" style={{ marginBottom: 10 }}>
          <p className="card-title" style={{ margin: 0 }}>本月</p>
          {data && (
            <div className="mono" style={{ fontWeight: 500 }}>
              {Object.entries(data.totalsByCurrency).map(([c, a]) => `${c} ${a}`).join(" · ") || "—"}
            </div>
          )}
        </div>
        {loading ? <div className="empty">載入中…</div> :
          !data || data.expenses.length === 0 ? <div className="empty">本月還沒有支出。</div> : (
          <div className="list">
            {data.expenses.map((e) => (
              <div className="list-row" key={e.id}>
                <div className="main">
                  <div className="t">{e.merchant || e.note || "支出"}</div>
                  <div className="s">{e.spent_on}{e.category_id ? ` · ${cats.find((c) => c.id === e.category_id)?.name ?? ""}` : ""}</div>
                </div>
                <div className="num">{e.currency} {e.amount}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function AddExpense({ cats, onCat, onAdded }: { cats: Category[]; onCat: (c: Category) => void; onAdded: () => void }) {
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [newCat, setNewCat] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function addCategory() {
    if (newCat.trim().length === 0) return;
    try {
      const { id } = await api.post<{ id: string }>("/api/expense-categories", { name: newCat.trim() });
      onCat({ id, name: newCat.trim() });
      setCategoryId(id);
      setNewCat("");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "分類建立失敗"); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const amt = Number(amount);
    if (!(amt > 0)) { setErr("金額需大於 0"); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { amount: amt };
      if (merchant.trim()) body.merchant = merchant.trim();
      if (note.trim()) body.note = note.trim();
      if (categoryId) body.categoryId = categoryId;
      await api.post("/api/expenses", body);
      setAmount(""); setMerchant(""); setNote("");
      onAdded();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "新增失敗");
    } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit}>
      <p className="card-title">記一筆</p>
      {err && <div className="err">{err}</div>}
      <div className="row">
        <div className="field"><label>金額 (TWD)</label><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
        <div className="field"><label>商家（選填）</label><input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} /></div>
      </div>
      <div className="field">
        <label>分類（選填）</label>
        <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">未分類</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ marginBottom: 0 }}><label>新增分類</label><input className="input" placeholder="例：外食" value={newCat} onChange={(e) => setNewCat(e.target.value)} /></div>
        <button type="button" className="btn btn-sm" style={{ width: "auto", flex: "0 0 auto" }} onClick={addCategory}>加分類</button>
      </div>
      <div className="field" style={{ marginTop: 14 }}><label>備註（選填）</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? "新增中…" : "新增支出"}</button>
    </form>
  );
}
