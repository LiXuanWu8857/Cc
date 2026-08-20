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
