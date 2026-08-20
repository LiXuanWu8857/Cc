import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { RATE_POLICIES } from "@/lib/api/rate-limit";
import { ApiError } from "@/lib/api/errors";
import { createFoodSchema } from "@/lib/validation/schemas";
import { validateNutritionPer100g } from "@/lib/nutrition/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/foods?q=... — search foods the caller may see (official + own).
 * RLS (`foods_select_visible`) does the visibility filtering; we just add a
 * name filter and a hard result cap.
 */
export const GET = withPipeline({}, async ({ req, db }) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length === 0) return NextResponse.json({ foods: [] });

  const { data, error } = await db
    .from("foods")
    .select(
      "id, name, brand, is_official, default_serving_g, food_nutrition(calories_kcal, protein_g, fat_g, carbs_g)",
    )
    // ilike arg is a parameter (not string-concatenated SQL), so this is not
    // an injection vector; we still strip % / _ wildcards from user input.
    .ilike("name", `%${q.replace(/[%_]/g, "")}%`)
    .order("is_official", { ascending: false })
    .limit(25);

  if (error) throw error;
  return NextResponse.json({ foods: data ?? [] });
});

/**
 * POST /api/foods — create a private, user-owned food.
 * Cannot create official foods (§4.10). Nutrition is validated on the backend
 * before storage; a calorie/macro mismatch is rejected for correction, not
 * stored silently (§4.11).
 */
export const POST = withPipeline(
  { schema: createFoodSchema, rate: RATE_POLICIES.write },
  async ({ db, user, body, requestId }) => {
    const errors = validateNutritionPer100g(body.nutritionPer100g);
    if (errors.length > 0) throw ApiError.validation({ nutrition: errors });

    const n = body.nutritionPer100g;
    const { data: foodId, error } = await db.rpc("create_user_food", {
      p_name: body.name,
      p_brand: body.brand ?? null,
      p_default_serving_g: body.defaultServingG ?? null,
      p_calories: n.caloriesKcal,
      p_protein: n.proteinG,
      p_fat: n.fatG,
      p_carbs: n.carbsG,
      p_fiber: n.fiberG ?? null,
      p_sugar: n.sugarG ?? null,
      p_sodium: n.sodiumMg ?? null,
      p_barcode: body.barcode ?? null,
    });
    if (error) throw error;

    await db.rpc("log_audit_event", {
      p_event_type: "food.create",
      p_target_type: "foods",
      p_target_id: foodId as string,
      p_result: "success",
      p_request_id: requestId,
    });

    return NextResponse.json({ id: foodId }, { status: 201 });
  },
);
