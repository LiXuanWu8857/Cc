"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

/**
 * Hard weekly gate. If the user has not logged a body metric in the last 7
 * days, they are forced to the weekly check-in before they can use anything
 * else. Combined with hiding the nav on /checkin, this makes the weekly
 * re-entry unavoidable.
 */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const EXEMPT = new Set(["/login", "/onboarding", "/checkin"]);

export function WeeklyGate() {
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (EXEMPT.has(path)) return;
    let cancelled = false;
    api
      .get<{ metrics: { measured_at: string }[] }>("/api/body-metrics")
      .then((m) => {
        if (cancelled) return;
        const latest = m.metrics?.[0];
        const due = !latest || Date.now() - new Date(latest.measured_at).getTime() > WEEK_MS;
        if (due) router.replace("/checkin");
      })
      .catch(() => {
        // 401 (not signed in) etc. — middleware handles auth; do nothing here.
      });
    return () => {
      cancelled = true;
    };
  }, [path, router]);

  return null;
}
