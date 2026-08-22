"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { WeightChart, type WeightPoint } from "@/components/WeightChart";

interface MetricsResp {
  metrics: { measured_at: string; weight_kg: number | null; body_fat_pct: number | null }[];
}

export default function Stats() {
  const [points, setPoints] = useState<WeightPoint[]>([]);
  const [latestFat, setLatestFat] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<MetricsResp>("/api/body-metrics")
      .then((r) => {
        const asc = [...r.metrics].reverse(); // API returns newest first
        const pts: WeightPoint[] = asc
          .filter((m) => m.weight_kg != null)
          .map((m) => ({ date: m.measured_at.slice(0, 10), weight: Number(m.weight_kg) }));
        setPoints(pts);
        const fat = r.metrics.find((m) => m.body_fat_pct != null)?.body_fat_pct;
        setLatestFat(fat != null ? Number(fat) : null);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, []);

  const first = points[0]?.weight;
  const last = points[points.length - 1]?.weight;
  const change = first != null && last != null ? Math.round((last - first) * 10) / 10 : null;

  return (
    <main className="app">
      <div className="page-head">
        <p className="eyebrow">趨勢</p>
        <h1>體重變化</h1>
      </div>

      {err && <div className="err">{err}</div>}
      {loading && <div className="empty">載入中…</div>}

      {!loading && points.length === 0 && (
        <div className="card"><p className="empty" style={{ padding: "20px 0" }}>還沒有體重紀錄。每週更新後就會在這裡看到趨勢。</p></div>
      )}

      {!loading && points.length > 0 && (
        <>
          <div className="card">
            <div className="stat-row">
              <Stat k="目前體重" v={`${last} kg`} />
              <Stat k="累積變化" v={change === null ? "—" : `${change > 0 ? "+" : ""}${change} kg`}
                tone={change === null || change === 0 ? "" : change < 0 ? "good" : "warn"} />
              <Stat k="紀錄數" v={`${points.length}`} />
            </div>
            <WeightChart data={points} />
          </div>

          {latestFat != null && (
            <div className="card">
              <p className="card-title">最新體脂</p>
              <div className="kcal-big"><span className="n">{latestFat}</span><span className="u">%</span></div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Stat({ k, v, tone = "" }: { k: string; v: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-k">{k}</div>
      <div className={`stat-v ${tone}`}>{v}</div>
    </div>
  );
}
