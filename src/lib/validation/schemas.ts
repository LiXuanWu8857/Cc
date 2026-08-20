import { z } from "zod";

/**
 * Request schemas. Every write schema is `.strict()` so unknown keys are
 * rejected (mass-assignment defence, Threat Model #9). Note what is ABSENT:
 * these never accept `user_id`, `role`, calorie/macro results, or any
 * server-derived value — the backend supplies those itself (§4.3).
 */

const sex = z.enum(["male", "female", "other", "prefer_not_to_say"]);
const activityLevel = z.enum([
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
]);
const goal = z.enum(["lose_fat", "maintain", "gain_muscle", "gain_weight"]);

/** ISO date (YYYY-MM-DD), not in the future, not absurdly old. */
const pastIsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((s) => {
    const d = Date.parse(s);
    return !Number.isNaN(d) && d <= Date.now() && d >= Date.parse("1900-01-01");
  }, "Date out of range");

export const upsertProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    sex,
    birthDate: pastIsoDate,
    heightCm: z.number().positive().max(300),
    activityLevel,
    goal,
  })
  .strict();
export type UpsertProfileInput = z.infer<typeof upsertProfileSchema>;

export const createBodyMetricSchema = z
  .object({
    weightKg: z.number().positive().max(700).optional(),
    bodyFatPct: z.number().min(0).max(100).optional(),
    // Optional client-supplied measurement time; must not be in the future.
    measuredAt: z
      .string()
      .datetime({ offset: true })
      .refine((s) => Date.parse(s) <= Date.now(), "measuredAt cannot be in the future")
      .optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.weightKg !== undefined || v.bodyFatPct !== undefined, {
    message: "Provide at least one of weightKg or bodyFatPct",
  });
export type CreateBodyMetricInput = z.infer<typeof createBodyMetricSchema>;

/**
 * Recompute-and-store targets. The client may OPTIONALLY override the final
 * numbers, but never the system calculation — that is always recomputed from
 * the profile + latest weight on the server.
 */
export const recomputeTargetsSchema = z
  .object({
    overrides: z
      .object({
        caloriesKcal: z.number().int().min(0).max(20000).optional(),
        proteinG: z.number().min(0).max(2000).optional(),
        fatG: z.number().min(0).max(2000).optional(),
        carbsG: z.number().min(0).max(2000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type RecomputeTargetsInput = z.infer<typeof recomputeTargetsSchema>;

// ---------------------------------------------------------------------------
// Phase 3 — foods & meals
// ---------------------------------------------------------------------------

export const mealType = z.enum(["breakfast", "lunch", "dinner", "snack"]);
const barcode = z.string().regex(/^[0-9]{8,14}$/, "Barcode must be 8-14 digits");

/** Per-100g nutrition supplied by the user for a manual food. Hard bounds
 *  here mirror the DB and the validate.ts checks; the calorie/macro
 *  cross-check runs in the route. */
const nutritionPer100g = z
  .object({
    caloriesKcal: z.number().min(0).max(1000),
    proteinG: z.number().min(0).max(100),
    fatG: z.number().min(0).max(100),
    carbsG: z.number().min(0).max(100),
    fiberG: z.number().min(0).max(100).optional(),
    sugarG: z.number().min(0).max(100).optional(),
    sodiumMg: z.number().min(0).max(100000).optional(),
  })
  .strict();

/** Create a private, user-owned food. Cannot create official foods, and
 *  never accepts owner_user_id / is_official — the backend sets those. */
export const createFoodSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    brand: z.string().trim().max(120).optional(),
    defaultServingG: z.number().positive().max(10000).optional(),
    barcode: barcode.optional(),
    nutritionPer100g,
  })
  .strict();
export type CreateFoodInput = z.infer<typeof createFoodSchema>;

export const createMealSchema = z
  .object({
    mealType,
    consumedOn: pastIsoDate.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type CreateMealInput = z.infer<typeof createMealSchema>;

/** Add a food to a meal. The backend resolves food_id -> per-100g nutrition
 *  (subject to RLS), scales by quantity and stores the snapshot itself. The
 *  client never sends the resulting calories/macros. */
export const addMealItemSchema = z
  .object({
    mealId: z.string().uuid(),
    foodId: z.string().uuid(),
    quantityG: z.number().positive().max(20000),
    servingLabel: z.string().trim().max(80).optional(),
  })
  .strict();
export type AddMealItemInput = z.infer<typeof addMealItemSchema>;

/** Query param schema for day-scoped reads (Dashboard, meals list). */
export const dayQuerySchema = z
  .object({ date: pastIsoDate.optional() })
  .strict();

// ---------------------------------------------------------------------------
// Phase 4 — expenses & food purchases
// ---------------------------------------------------------------------------

const currency = z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code");
const money = z.number().positive().max(1_000_000_000);

export const createExpenseCategorySchema = z
  .object({ name: z.string().trim().min(1).max(60) })
  .strict();
export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;

export const createExpenseSchema = z
  .object({
    amount: money,
    currency: currency.optional(),
    spentOn: pastIsoDate.optional(),
    categoryId: z.string().uuid().optional(),
    merchant: z.string().trim().max(120).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

/** Record a food purchase. If a food is linked, the backend snapshots the
 *  purchased quantity's nutrition; cost ratios are derived, never sent. */
export const createFoodPurchaseSchema = z
  .object({
    quantityG: z.number().positive().max(1_000_000),
    price: money,
    currency: currency.optional(),
    purchasedOn: pastIsoDate.optional(),
    foodId: z.string().uuid().optional(),
    expenseId: z.string().uuid().optional(),
  })
  .strict();
export type CreateFoodPurchaseInput = z.infer<typeof createFoodPurchaseSchema>;
