"use client";
import { useState } from "react";
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

export default function Onboarding() {
  const router = useRouter();
  const [sex, setSex] = useState("male");
  const [birthDate, setBirthDate] = useState("1995-01-01");
  const [heightCm, setHeightCm] = useState("170");
  const [weightKg, setWeightKg] = useState("65");
  const [activity, setActivity] = useState("moderate");
  const [goal, setGoal] = useState("maintain");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.put("/api/profile", {
        sex, birthDate, heightCm: Number(heightCm),
        activityLevel: activity, goal,
      });
      await api.post("/api/body-metrics", { weightKg: Number(weightKg) });
      await api.post("/api/nutrition-targets", {});
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "儲存失敗，請檢查欄位");
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <div className="page-head">
        <p className="eyebrow">歡迎</p>
        <h1>建立你的目標</h1>
      </div>
      {err && <div className="err">{err}</div>}
      <form onSubmit={submit} className="card">
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
        <div className="row">
          <div className="field">
            <label htmlFor="h">身高 (cm)</label>
            <input id="h" className="input" type="number" inputMode="decimal" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="w">目前體重 (kg)</label>
            <input id="w" className="input" type="number" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} required />
          </div>
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
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? "計算中…" : "算出我的每日目標"}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0, textAlign: "center" }}>
          熱量與營養目標由後端依 Mifflin-St Jeor 計算，可日後調整。
        </p>
      </form>
    </main>
  );
}
