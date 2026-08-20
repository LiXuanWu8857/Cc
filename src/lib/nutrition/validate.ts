/**
 * Nutrition validation & scaling — fixed backend functions (§4.11).
 *
 * Used when a user creates a food (manual entry) and when an item is added to
 * a meal. The client never sends scaled/derived nutrition; the backend
 * validates the per-100g basis and computes the consumed amount itself.
 */

export interface NutritionPer100g {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
}

export interface ScaledNutrition {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARB = 4;
const KCAL_PER_G_FAT = 9;

/** Hard bounds, per 100 g. Mirror the DB CHECK constraints in 0005_foods.sql. */
const BOUNDS = {
  caloriesKcal: [0, 1000],
  proteinG: [0, 100],
  fatG: [0, 100],
  carbsG: [0, 100],
  fiberG: [0, 100],
  sugarG: [0, 100],
  sodiumMg: [0, 100_000],
} as const;

/**
 * Validate per-100g nutrition. Returns a list of human-readable errors; empty
 * means valid. Two kinds of check (§4.11):
 *   1. Hard bounds — non-negative, within range, finite.
 *   2. Calorie cross-check — declared calories must be within tolerance of the
 *      Atwater estimate (protein*4 + carbs*4 + fat*9). A large gap means the
 *      label was mis-read or mistyped and must be corrected, not stored
 *      silently.
 */
export function validateNutritionPer100g(n: NutritionPer100g): string[] {
  const errors: string[] = [];

  const required: [keyof typeof BOUNDS, number][] = [
    ["caloriesKcal", n.caloriesKcal],
    ["proteinG", n.proteinG],
    ["fatG", n.fatG],
    ["carbsG", n.carbsG],
  ];
  for (const [key, value] of required) {
    if (value === undefined || value === null || !Number.isFinite(value)) {
      errors.push(`${key} is required and must be a finite number`);
      continue;
    }
    const [min, max] = BOUNDS[key];
    if (value < min || value > max) errors.push(`${key} must be between ${min} and ${max} per 100g`);
  }

  const optional: [keyof typeof BOUNDS, number | undefined][] = [
    ["fiberG", n.fiberG],
    ["sugarG", n.sugarG],
    ["sodiumMg", n.sodiumMg],
  ];
  for (const [key, value] of optional) {
    if (value === undefined) continue;
    if (!Number.isFinite(value)) {
      errors.push(`${key} must be a finite number`);
      continue;
    }
    const [min, max] = BOUNDS[key];
    if (value < min || value > max) errors.push(`${key} must be between ${min} and ${max} per 100g`);
  }

  // Only run the cross-check if the core fields are individually valid.
  if (errors.length === 0) {
    const atwater =
      n.proteinG * KCAL_PER_G_PROTEIN +
      n.carbsG * KCAL_PER_G_CARB +
      n.fatG * KCAL_PER_G_FAT;
    // Tolerance: the larger of 50 kcal or 20% of the declared calories, to
    // allow for rounding, fibre, sugar alcohols, etc.
    const tolerance = Math.max(50, n.caloriesKcal * 0.2);
    if (Math.abs(atwater - n.caloriesKcal) > tolerance) {
      errors.push(
        `Calories (${n.caloriesKcal}) do not match macros (~${round1(atwater)} kcal); please re-check the label`,
      );
    }
  }

  return errors;
}

/** Scale canonical per-100g nutrition to the consumed amount in grams. */
export function scaleNutrition(per100g: NutritionPer100g, grams: number): ScaledNutrition {
  if (!Number.isFinite(grams) || grams <= 0) {
    throw new Error("grams must be a positive finite number");
  }
  const factor = grams / 100;
  return {
    caloriesKcal: round1(per100g.caloriesKcal * factor),
    proteinG: round1(per100g.proteinG * factor),
    fatG: round1(per100g.fatG * factor),
    carbsG: round1(per100g.carbsG * factor),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
