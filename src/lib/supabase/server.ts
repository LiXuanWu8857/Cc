import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Request-scoped Supabase client bound to the caller's session.
 *
 * This client uses the ANON key and carries the user's JWT, so EVERY query it
 * runs is subject to RLS (§4.6). It is the default identity for all
 * user-facing requests. It can never see another user's rows, because the
 * database enforces `auth.uid() = user_id`.
 *
 * Do NOT reach for the service-role client to "make a query work" — that
 * bypasses RLS and violates least privilege (§4.7).
 */
export function createRlsClient() {
  const cookieStore = cookies();
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `set` throws in a pure Server Component render; safe to ignore
          // because session refresh is handled in middleware / route handlers.
        }
      },
    },
  });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
