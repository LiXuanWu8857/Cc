import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { RATE_POLICIES } from "@/lib/api/rate-limit";
import { ApiError } from "@/lib/api/errors";
import { recomputeTargetsSchema } from "@/lib/validation/schemas";
import { ageFromBirthDate, calcTargets } from "@/lib/nutrition/calc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET_COLUMNS =
  "id, effective_date, bmr, tdee, calories_system, protein_g_system, fat_g_system, carbs_g_system, calories_override, protein_g_override, fat_g_override, carbs_g_override, calories_effective, protein_g_effective, fat_g_effective, carbs_g_effective, source, is_active, updated_at";

/** GET /api/nutrition-targets — the caller's current active target. */
export const GET = withPipeline({}, async ({ db }) => {
  const { data, error } = await db
    .from("nutrition_targets")
    .select(TARGET_COLUMNS)
    .eq("is_active", true)
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return NextResponse.json({ target: data });
});

/**
 * POST /api/nutrition-targets — recompute today's target from the profile and
 * latest weight, applying any client overrides.
 *
 * The SYSTEM values are always recomputed here on the backend (§4.11); the
 * client cannot supply them. Only the final *effective* numbers may be
 * overridden, and those are range-checked by the schema and the DB.
 */
export const POST = withPipeline(
  { schema: recomputeTargetsSchema, rate: RATE_POLICIES.write },
  async ({ db, user, body, requestId }) => {
    // Gather trusted inputs — the caller's own profile + latest weight.
    const { data: profile, error: profErr } = await db
      .from("user_profiles")
      .select("sex, birth_date, height_cm, activity_level, goal")
      .maybeSingle();
    if (profErr) throw profErr;
    if (!profile || !profile.sex || !profile.birth_date || !profile.height_cm ||
        !profile.activity_level || !profile.goal) {
      throw ApiError.validation({ profile: ["Complete your profile before computing targets"] });
    }

    const { data: latest, error: metricErr } = await db
      .from("body_metrics")
      .select("weight_kg")
      .not("weight_kg", "is", null)
      .order("measured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (metricErr) throw metricErr;
    if (!latest?.weight_kg) {
      throw ApiError.validation({ weight: ["Log a body weight before computing targets"] });
    }

    const targets = calcTargets({
      sex: profile.sex,
      ageYears: ageFromBirthDate(profile.birth_date),
      heightCm: Number(profile.height_cm),
      weightKg: Number(latest.weight_kg),
      activityLevel: profile.activity_level,
      goal: profile.goal,
    });

    const overrides = body.overrides ?? {};
    const hasOverride =
      overrides.caloriesKcal !== undefined ||
      overrides.proteinG !== undefined ||
      overrides.fatG !== undefined ||
      overrides.carbsG !== undefined;

    // Supersede any existing active target for today, then insert the new one.
    // (uq_nutrition_targets_active enforces one active row per day.)
    const { error: deactErr } = await db
      .from("nutrition_targets")
      .update({ is_active: false })
      .eq("is_active", true)
      .eq("effective_date", new Date().toISOString().slice(0, 10));
    if (deactErr) throw deactErr;

    const { data: inserted, error: insErr } = await db
      .from("nutrition_targets")
      .insert({
        user_id: user.id, // from session
        bmr: targets.bmr,
        tdee: targets.tdee,
        calories_system: targets.caloriesKcal,
        protein_g_system: targets.proteinG,
        fat_g_system: targets.fatG,
        carbs_g_system: targets.carbsG,
        calories_override: overrides.caloriesKcal ?? null,
        protein_g_override: overrides.proteinG ?? null,
        fat_g_override: overrides.fatG ?? null,
        carbs_g_override: overrides.carbsG ?? null,
        source: hasOverride ? "user_override" : "system",
        is_active: true,
      })
      .select(TARGET_COLUMNS)
      .single();
    if (insErr) throw insErr;

    await db.rpc("log_audit_event", {
      p_event_type: "nutrition_target.recompute",
      p_target_type: "nutrition_targets",
      p_target_id: inserted.id,
      p_result: "success",
      p_request_id: requestId,
      p_risk_meta: { source: inserted.source },
    });

    return NextResponse.json({ target: inserted }, { status: 201 });
  },
);
