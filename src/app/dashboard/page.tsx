"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError, type DashboardResp } from "@/lib/client/api";

const MEALS: [string, string][] = [
  ["breakfast", "早餐"], ["lunch", "午餐"], ["dinner", "晚餐"], ["snack", "點心"],
];

export default function Dashboard() {
  const [data, setData] = useState<DashboardResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The WeeklyGate redirects to /checkin when the weekly update is due, so
    // this page only renders once the user is current.
    api.get<DashboardResp>("/api/dashboard")
      .then(setData)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, []);

  const t = data?.totals;
  const target = data?.target;
  const p = data?.progress;
  const kcalTarget = target?.calories_effective ?? 0;
  const kcalPct = p?.caloriesPct ?? 0;
  const remaining = kcalTarget ? Math.max(0, Math.round(kcalTarget - (t?.caloriesKcal ?? 0))) : null;

  return (
    <main className="app">
      <div className="page-head">
        <p className="eyebrow">{data?.date ?? "今日"}</p>
        <h1>今日總覽</h1>
      </div>

      {err && <div className="err">{err}</div>}
      {loading && <div className="empty">載入中…</div>}

      {!loading && data && !target && (
        <div className="card">
          <p className="card-title">尚未設定目標</p>
          <p className="muted" style={{ marginTop: 0 }}>先建立個人資料與每日目標，才能追蹤進度。</p>
          <Link href="/onboarding" className="btn btn-primary" style={{ display: "flex" }}>建立目標</Link>
        </div>
      )}

      {!loading && data && (
        <>
          <div className="card">
            <p className="card-title">熱量</p>
            <div className="kcal-big">
              <span className="n">{Math.round(t?.caloriesKcal ?? 0)}</span>
              <span className="u">/ {kcalTarget || "—"} kcal</span>
            </div>
            {kcalTarget > 0 && (
              <>
                <div className="kcal-track"><i style={{ width: `${Math.min(100, kcalPct)}%` }} /></div>
                <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
                  {remaining !== null && remaining > 0 ? `還可攝取 ${remaining} kcal` : "已達今日目標"}
                </p>
              </>
            )}
            <div className="macro-grid">
              <MacroBar label="蛋白" color="var(--protein)" g={t?.proteinG} target={target?.protein_g_effective} pct={p?.proteinPct} />
              <MacroBar label="脂肪" color="var(--fat)" g={t?.fatG} target={target?.fat_g_effective} pct={p?.fatPct} />
              <MacroBar label="碳水" color="var(--carbs)" g={t?.carbsG} target={target?.carbs_g_effective} pct={p?.carbsPct} />
            </div>
          </div>

          <div className="card">
            <div className="spread" style={{ marginBottom: 4 }}>
              <p className="card-title" style={{ margin: 0 }}>各餐</p>
              <Link href="/add" className="btn btn-ghost btn-sm">+ 加入食物</Link>
            </div>
            {MEALS.map(([key, label]) => {
              const m = data.perMeal?.[key];
              const kcal = Math.round(m?.caloriesKcal ?? 0);
              return (
                <div className="list-row" key={key}>
                  <div className="main">
                    <div className="t">{label}</div>
                    <div className="s">{kcal > 0 ? `蛋白 ${fmt(m?.proteinG)} · 脂肪 ${fmt(m?.fatG)} · 碳水 ${fmt(m?.carbsG)} g` : "尚未記錄"}</div>
                  </div>
                  <div className="num">{kcal} kcal</div>
                </div>
              );
            })}
          </div>

          <div className="card">
            <p className="card-title">今日食品支出</p>
            {data.spending.count === 0 ? (
              <p className="muted" style={{ margin: 0 }}>今天還沒有支出紀錄。<Link href="/expenses" style={{ color: "var(--accent)" }}>記一筆</Link></p>
            ) : (
              <div className="stack">
                {Object.entries(data.spending.byCurrency).map(([cur, amt]) => (
                  <div className="spread" key={cur}>
                    <span className="muted">{cur}</span>
                    <span className="mono" style={{ fontSize: 18, fontWeight: 500 }}>{amt}</span>
                  </div>
                ))}
                <div className="muted" style={{ fontSize: 12 }}>{data.spending.count} 筆</div>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function MacroBar({ label, color, g, target, pct }:
  { label: string; color: string; g?: number; target?: number; pct?: number }) {
  return (
    <div className="macro">
      <div className="k">{label}</div>
      <div className="bar"><i style={{ width: `${Math.min(100, pct ?? 0)}%`, background: color }} /></div>
      <div className="v">{fmt(g)}<span className="muted" style={{ fontSize: 11 }}>/{target ? Math.round(target) : "—"}g</span></div>
    </div>
  );
}
function fmt(n?: number) { return n === undefined ? "0" : Math.round(n * 10) / 10; }
