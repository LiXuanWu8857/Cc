"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Top-right hamburger menu. Rendered globally; hidden on the auth/onboarding
 * screens. Shows the signed-in user and links to profile / weekly check-in /
 * logout.
 */
export function MenuDrawer() {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  const hidden = path === "/login" || path === "/onboarding" || path === "/checkin";

  useEffect(() => {
    if (hidden) return;
    getBrowserSupabase()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? null))
      .catch(() => setEmail(null));
  }, [hidden]);

  // Close on route change and on Escape.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (hidden) return null;

  async function logout() {
    await getBrowserSupabase().auth.signOut();
    setOpen(false);
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <button className="menu-btn" aria-label="開啟選單" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="drawer-overlay" onClick={() => setOpen(false)}>
          <aside className="drawer" role="dialog" aria-label="選單" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div className="avatar" aria-hidden="true">{(email ?? "?").slice(0, 1).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div className="drawer-name">已登入</div>
                <div className="drawer-email">{email ?? "—"}</div>
              </div>
              <button className="drawer-x" aria-label="關閉" onClick={() => setOpen(false)}>✕</button>
            </div>

            <nav className="drawer-nav">
              <Link href="/dashboard">今日總覽</Link>
              <Link href="/stats">體重趨勢</Link>
              <Link href="/settings">個人資料</Link>
              <Link href="/checkin">每週更新數據</Link>
              <Link href="/expenses">食品支出</Link>
              <Link href="/purchases">採購成本</Link>
            </nav>

            <div className="drawer-foot">
              <button className="btn btn-danger" style={{ width: "100%" }} onClick={logout}>登出</button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
