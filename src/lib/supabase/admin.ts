import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — BYPASSES RLS. This is the exception, not the
 * default (§4.7). Permitted callers: controlled system jobs only —
 *   - OCR ingestion
 *   - reviewed official-food import
 *   - data repair / migration
 *   - audited admin operations
 *
 * Guardrails:
 *   - `server-only` import poisons any attempt to bundle this into client code.
 *   - The key is read from the server environment and never shipped to the
 *     browser (principle #07).
 *   - Callers must still validate input and verify resource ownership
 *     themselves — service_role gives them no permission to skip authorization.
 *
 * If you are tempted to use this for a normal user request, use
 * `createRlsClient()` instead.
 */
export function createServiceRoleClient() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
