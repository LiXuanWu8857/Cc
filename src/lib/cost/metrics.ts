/**
 * Food-spending efficiency metrics (§2.3), computed by fixed backend functions.
 *
 * Derived ratios are NOT stored — they are recomputed from the purchase's
 * price and its snapshot nutrition totals whenever needed, so there is a single
 * source of truth and no stale denormalised value.
 */

export interface PurchaseCostInputs {
  price: number;
  totalCaloriesKcal?: number | null;
  totalProteinG?: number | null;
}

export interface PurchaseCostMetrics {
  /** Currency units per 100 kcal, or null when calories are unknown/zero. */
  costPer100Kcal: number | null;
  /** Currency units per 10 g protein, or null when protein is unknown/zero. */
  costPer10gProtein: number | null;
}

export function costPer100Kcal(price: number, totalCaloriesKcal?: number | null): number | null {
  if (!isPositive(price) || !isPositive(totalCaloriesKcal)) return null;
  return round2((price * 100) / (totalCaloriesKcal as number));
}

export function costPer10gProtein(price: number, totalProteinG?: number | null): number | null {
  if (!isPositive(price) || !isPositive(totalProteinG)) return null;
  return round2((price * 10) / (totalProteinG as number));
}

export function purchaseCostMetrics(input: PurchaseCostInputs): PurchaseCostMetrics {
  return {
    costPer100Kcal: costPer100Kcal(input.price, input.totalCaloriesKcal),
    costPer10gProtein: costPer10gProtein(input.price, input.totalProteinG),
  };
}

function isPositive(n: number | null | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
