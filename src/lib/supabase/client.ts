"use client";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client for auth only (sign in/up/out, session).
 * Uses the public anon key — the only Supabase value allowed in the browser
 * (§4.3). All DATA access goes through the backend API routes (RLS-bound),
 * never direct table queries from here.
 */
let cached: ReturnType<typeof createBrowserClient> | null = null;

export function getBrowserSupabase() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Supabase public env vars are not configured");
  cached = createBrowserClient(url, anon);
  return cached;
}
