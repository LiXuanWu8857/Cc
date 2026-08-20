"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setNote(null);
    setBusy(true);
    try {
      const supabase = getBrowserSupabase();
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(next);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          router.push("/onboarding");
          router.refresh();
        } else {
          setNote("註冊成功，請至信箱點擊確認連結後再登入。");
          setMode("in");
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "發生錯誤");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-narrow">
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div className="brand">FoodTrack</div>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
          飲食紀錄 · 營養分析 · 食品記帳
        </p>
      </div>

      <div className="seg" style={{ marginBottom: 18 }}>
        <button className={mode === "in" ? "on" : ""} onClick={() => setMode("in")} type="button">登入</button>
        <button className={mode === "up" ? "on" : ""} onClick={() => setMode("up")} type="button">註冊</button>
      </div>

      {err && <div className="err">{err}</div>}
      {note && <div className="ok-note">{note}</div>}

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">密碼</label>
          <input id="password" className="input" type="password" required minLength={6}
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? "處理中…" : mode === "in" ? "登入" : "建立帳號"}
        </button>
      </form>
    </main>
  );
}
