"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

interface MetricsResp {
  metrics: { measured_at: string; weight_kg: number | null }[];
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Weekly check-in: re-enter body metrics so targets stay current. Enforced —
 *  the WeeklyGate sends users here and the nav is hidden until they submit. */
export default function CheckIn() {
  const router = useRouter();
  const [weightKg, setWeightKg] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [due, setDue] = useState(true); // assume required until we learn otherwise
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<MetricsResp>("/api/body-metrics")
      .then((m) => {
        const latest = m.metrics?.[0];
        if (latest) {
          setLastAt(latest.measured_at.slice(0, 10));
          if (latest.weight_kg != null) setWeightKg(String(latest.weight_kg));
          setDue(Date.now() - new Date(latest.measured_at).getTime() > WEEK_MS);
        }
      })
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const body: Record<string, number> = {};
      if (weightKg) body.weightKg = Number(weightKg);
      if (bodyFat) body.bodyFatPct = Number(bodyFat);
      if (body.weightKg == null && body.bodyFatPct == null) {
        throw new ApiError(422, "validation", "請至少填體重");
      }
      await api.post("/api/body-metrics", body);
      await api.post("/api/nutrition-targets", {});
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "儲存失敗");
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <div className="page-head">
        <p className="eyebrow">每週更新</p>
        <h1>更新本週身體數據</h1>
      </div>

      {err && <div className="err">{err}</div>}

      {due && (
        <div className="ok-note" style={{ background: "var(--accent-soft)" }}>
          本週尚未更新身體數據，請先完成更新才能繼續使用。
        </div>
      )}

      <form onSubmit={submit} className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
          {lastAt ? `上次更新：${lastAt}。` : ""}每週重新輸入一次，讓熱量與營養目標貼近你目前的身體狀況。
        </p>
        <div className="row">
          <div className="field">
            <label htmlFor="w">體重 (kg)</label>
            <input id="w" className="input" type="number" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="bf">體脂 (%)</label>
            <input id="bf" className="input" type="number" inputMode="decimal" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} placeholder="選填" />
          </div>
        </div>
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? "更新中…" : "更新並重算目標"}
        </button>
        {!due && (
          <Link href="/dashboard" className="btn btn-ghost" style={{ width: "100%", marginTop: 8 }}>
            返回今日
          </Link>
        )}
      </form>
    </main>
  );
}
