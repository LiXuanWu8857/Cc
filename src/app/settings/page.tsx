"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

const SEX = [
  { v: "male", l: "男" }, { v: "female", l: "女" },
  { v: "other", l: "其他" }, { v: "prefer_not_to_say", l: "不透露" },
];
const ACTIVITY = [
  { v: "sedentary", l: "久坐" }, { v: "light", l: "輕度" }, { v: "moderate", l: "中度" },
  { v: "active", l: "高度" }, { v: "very_active", l: "非常高" },
];
const GOAL = [
  { v: "lose_fat", l: "減脂" }, { v: "maintain", l: "維持" },
  { v: "gain_muscle", l: "增肌" }, { v: "gain_weight", l: "增重" },
];

interface ProfileResp {
  profile: {
    sex: string | null; birth_date: string | null; height_cm: number | null;
    activity_level: string | null; goal: string | null;
  } | null;
}
interface MetricsResp {
  metrics: { measured_at: string; weight_kg: number | null; body_fat_pct: number | null }[];
}

export default function Settings() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  const [sex, setSex] = useState("male");
  const [birthDate, setBirthDate] = useState("1995-01-01");
  const [heightCm, setHeightCm] = useState("170");
  const [activity, setActivity] = useState("moderate");
  const [goal, setGoal] = useState("maintain");

  const [weightKg, setWeightKg] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [lastWeight, setLastWeight] = useState<{ w: number | null; at: string } | null>(null);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingMetric, setSavingMetric] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<ProfileResp>("/api/profile"),
      api.get<MetricsResp>("/api/body-metrics"),
    ])
      .then(([p, m]) => {
        const pr = p.profile;
        if (pr) {
          if (pr.sex) setSex(pr.sex);
          if (pr.birth_date) setBirthDate(pr.birth_date);
          if (pr.height_cm != null) setHeightCm(String(pr.height_cm));
          if (pr.activity_level) setActivity(pr.activity_level);
          if (pr.goal) setGoal(pr.goal);
        }
        const latest = m.metrics?.[0];
        if (latest) {
          setLastWeight({ w: latest.weight_kg, at: latest.measured_at.slice(0, 10) });
          if (latest.weight_kg != null) setWeightKg(String(latest.weight_kg));
        }
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setNote(null); setSavingProfile(true);
    try {
      await api.put("/api/profile", {
        sex, birthDate, heightCm: Number(heightCm), activityLevel: activity, goal,
      });
      await api.post("/api/nutrition-targets", {}); // recompute with new profile
      setNote("個人資料已更新，每日目標已重新計算。");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "儲存失敗，請檢查欄位");
    } finally {
      setSavingProfile(false);
    }
  }

  async function recordMetric(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setNote(null); setSavingMetric(true);
    try {
      const body: Record<string, number> = {};
      if (weightKg) body.weightKg = Number(weightKg);
      if (bodyFat) body.bodyFatPct = Number(bodyFat);
      if (body.weightKg == null && body.bodyFatPct == null) {
        throw new ApiError(422, "validation", "請至少填體重或體脂");
      }
      await api.post("/api/body-metrics", body);
      await api.post("/api/nutrition-targets", {}); // recompute with new weight
      setNote("身體數據已記錄，每日目標已更新。");
      setBodyFat("");
      setLastWeight({ w: body.weightKg ?? lastWeight?.w ?? null, at: new Date().toISOString().slice(0, 10) });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "儲存失敗");
    } finally {
      setSavingMetric(false);
    }
  }

  return (
    <main className="app">
      <div className="page-head">
        <p className="eyebrow">設定</p>
        <h1>個人資料</h1>
      </div>

      {err && <div className="err">{err}</div>}
      {note && <div className="ok-note">{note}</div>}
      {loading && <div className="empty">載入中…</div>}

      {!loading && (
        <>
          <form onSubmit={saveProfile} className="card">
            <p className="card-title">基本資料</p>
            <div className="field">
              <label>性別</label>
              <div className="seg">
                {SEX.map((s) => (
                  <button key={s.v} type="button" className={sex === s.v ? "on" : ""} onClick={() => setSex(s.v)}>{s.l}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="bd">出生日期</label>
              <input id="bd" className="input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="h">身高 (cm)</label>
              <input id="h" className="input" type="number" inputMode="decimal" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} required />
            </div>
            <div className="field">
              <label>活動程度</label>
              <select className="select" value={activity} onChange={(e) => setActivity(e.target.value)}>
                {ACTIVITY.map((a) => <option key={a.v} value={a.v}>{a.l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>目標</label>
              <div className="seg">
                {GOAL.map((g) => (
                  <button key={g.v} type="button" className={goal === g.v ? "on" : ""} onClick={() => setGoal(g.v)}>{g.l}</button>
                ))}
              </div>
            </div>
            <button className="btn btn-primary" disabled={savingProfile} type="submit">
              {savingProfile ? "儲存中…" : "儲存並重新計算目標"}
            </button>
          </form>

          <form onSubmit={recordMetric} className="card">
            <p className="card-title">身體數據</p>
            {lastWeight && (
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                最近一次：{lastWeight.w != null ? `${lastWeight.w} kg` : "—"}（{lastWeight.at}）
              </p>
            )}
            <div className="row">
              <div className="field">
                <label htmlFor="w">體重 (kg)</label>
                <input id="w" className="input" type="number" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="bf">體脂 (%)</label>
                <input id="bf" className="input" type="number" inputMode="decimal" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} placeholder="選填" />
              </div>
            </div>
            <button className="btn" disabled={savingMetric} type="submit">
              {savingMetric ? "記錄中…" : "記錄新數據"}
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              體重以歷史紀錄保存，不會覆蓋舊資料；記錄後每日目標會依最新體重重算。
            </p>
          </form>
        </>
      )}
    </main>
  );
}
