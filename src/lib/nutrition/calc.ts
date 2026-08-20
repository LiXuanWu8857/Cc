/**
 * Fixed, server-side nutrition calculations.
 *
 * Per 01_SECURITY_ARCHITECTURE.md §4.5 / §4.11, derived values (BMR, TDEE,
 * calorie & macro targets) are ALWAYS computed here on the backend from
 * trusted inputs. The client never sends these numbers; if it does, they are
 * ignored and recomputed. This module is pure and unit-tested.
 */

export type Sex = "male" | "female" | "other" | "prefer_not_to_say";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";
export type Goal = "lose_fat" | "maintain" | "gain_muscle" | "gain_weight";

export interface TargetInputs {
  sex: Sex;
  /** Whole years. */
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goal: Goal;
}

export interface NutritionTargets {
  bmr: number;
  tdee: number;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Calorie multiplier applied to TDEE for each goal. */
const GOAL_CALORIE_FACTOR: Record<Goal, number> = {
  lose_fat: 0.8,
  maintain: 1.0,
  gain_muscle: 1.1,
  gain_weight: 1.15,
};

/** Protein grams per kg of bodyweight, by goal. */
const GOAL_PROTEIN_PER_KG: Record<Goal, number> = {
  lose_fat: 2.0,
  maintain: 1.8,
  gain_muscle: 2.0,
  gain_weight: 1.8,
};

/** Fraction of daily calories allocated to fat. Remainder goes to carbs. */
const FAT_CALORIE_FRACTION = 0.25;

const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARB = 4;
const KCAL_PER_G_FAT = 9;

/**
 * Basal Metabolic Rate — Mifflin-St Jeor.
 * For non-binary / undisclosed sex we use the average of the male (+5) and
 * female (-161) constants (-78) rather than guessing.
 */
export function calcBmr(input: Pick<TargetInputs, "sex" | "ageYears" | "heightCm" | "weightKg">): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.ageYears;
  const sexConstant =
    input.sex === "male" ? 5 : input.sex === "female" ? -161 : -78;
  return round1(base + sexConstant);
}

export function calcTdee(bmr: number, activityLevel: ActivityLevel): number {
  return round1(bmr * ACTIVITY_FACTOR[activityLevel]);
}

/**
 * Full target set from raw inputs. Macro split:
 *   protein = perKg * bodyweight
 *   fat     = 25% of calories
 *   carbs   = the remaining calories
 * Carbs are floored at 0 so an aggressive protein/fat split can never yield a
 * negative macro (which the DB constraints would reject anyway).
 */
export function calcTargets(input: TargetInputs): NutritionTargets {
  const bmr = calcBmr(input);
  const tdee = calcTdee(bmr, input.activityLevel);
  const caloriesKcal = Math.round(tdee * GOAL_CALORIE_FACTOR[input.goal]);

  const proteinG = round1(GOAL_PROTEIN_PER_KG[input.goal] * input.weightKg);
  const fatG = round1((caloriesKcal * FAT_CALORIE_FRACTION) / KCAL_PER_G_FAT);

  const remainingKcal =
    caloriesKcal - proteinG * KCAL_PER_G_PROTEIN - fatG * KCAL_PER_G_FAT;
  const carbsG = round1(Math.max(0, remainingKcal) / KCAL_PER_G_CARB);

  return { bmr, tdee, caloriesKcal, proteinG, fatG, carbsG };
}

/** Whole-year age from an ISO birth date, relative to `on` (default: now). */
export function ageFromBirthDate(birthDateIso: string, on: Date = new Date()): number {
  const b = new Date(birthDateIso);
  let age = on.getUTCFullYear() - b.getUTCFullYear();
  const monthDiff = on.getUTCMonth() - b.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && on.getUTCDate() < b.getUTCDate())) {
    age -= 1;
  }
  return age;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
