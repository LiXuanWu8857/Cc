import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * AI / OCR cost guard client (§4.12).
 *
 * Budget is reserved ATOMICALLY in the database (reserve_ai_budget) BEFORE any
 * provider is called. If the reservation is denied the request must not call
 * the provider. Actual cost is reconciled afterwards via settle_ai_cost.
 *
 * Policy lives here so limits are declared in one place. Tune per environment.
 */
export const AI_COST_POLICY = {
  /** Max OCR+AI-backed requests per user per day. */
  maxRequestsPerDay: 50,
  /** Max estimated spend (provider currency units) per user per day. */
  maxCostPerDay: 2.0,
  /** Estimated cost reserved per scan before the call. */
  estCostPerRequest: 0.02,
} as const;

/** Reserve budget for one AI/OCR request. Returns true if the caller may
 *  proceed, false if over budget (deny before calling any provider). */
export async function reserveAiBudget(
  db: SupabaseClient,
  reqCost: number = AI_COST_POLICY.estCostPerRequest,
): Promise<boolean> {
  const { data, error } = await db.rpc("reserve_ai_budget", {
    p_max_requests: AI_COST_POLICY.maxRequestsPerDay,
    p_max_cost: AI_COST_POLICY.maxCostPerDay,
    p_req_cost: reqCost,
  });
  if (error) throw error;
  return data === true;
}

/** Reconcile the reserved estimate with the provider's actual cost. */
export async function settleAiCost(
  db: SupabaseClient,
  actualCost: number,
  reservedCost: number = AI_COST_POLICY.estCostPerRequest,
): Promise<void> {
  const { error } = await db.rpc("settle_ai_cost", {
    p_actual_cost: actualCost,
    p_reserved_cost: reservedCost,
  });
  if (error) throw error;
}
