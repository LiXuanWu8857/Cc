"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Bottom tab bar. Hidden on the auth screen. */
export function TabBar() {
  const path = usePathname();
  if (path === "/login" || path === "/onboarding" || path === "/checkin") return null;

  const tabs = [
    { href: "/dashboard", label: "今日", icon: IconHome },
    { href: "/add", label: "加入", icon: IconPlus },
    { href: "/stats", label: "趨勢", icon: IconChart },
    { href: "/expenses", label: "支出", icon: IconWallet },
  ];

  return (
    <nav className="tabbar" aria-label="主導覽">
      {tabs.map((t) => {
        const active = path === t.href || path.startsWith(t.href + "/");
        const Icon = t.icon;
        return (
          <Link key={t.href} href={t.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            <Icon />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function IconHome() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 10.5 12 4l9 6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 9.5V20h14V9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" /><path d="M12 8.5v7M8.5 12h7" strokeLinecap="round" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 19V5M4 19h16" strokeLinecap="round" />
      <path d="M7 15l4-4 3 3 4-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconWallet() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M16 14h2" strokeLinecap="round" />
    </svg>
  );
}
