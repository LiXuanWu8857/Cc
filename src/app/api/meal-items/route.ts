import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { RATE_POLICIES } from "@/lib/api/rate-limit";
import { ApiError } from "@/lib/api/errors";
import { addMealItemSchema } from "@/lib/validation/schemas";
import { scaleNutrition } from "@/lib/nutrition/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/meal-items — add a food to a meal.
 *
 * The client sends only { mealId, foodId, quantityG }. The backend:
 *   1. verifies the meal is the caller's (RLS-scoped read; 404 otherwise),
 *   2. reads the food's per-100g nutrition (RLS: official or own; 404 else),
 *   3. scales it to quantityG with the fixed function,
 *   4. stores the result as an immutable snapshot (§2.2).
 * Calories/macros are never taken from the client.
 */
export const POST = withPipeline(
  { schema: addMealItemSchema, rate: RATE_POLICIES.write },
  async ({ db, user, body, requestId }) => {
    // 1. Meal must exist AND be the caller's (RLS hides others' meals).
    const { data: meal, error: mealErr } = await db
      .from("meals")
      .select("id")
      .eq("id", body.mealId)
      .maybeSingle();
    if (mealErr) throw mealErr;
    if (!meal) throw ApiError.notFound();

    // 2. Food must be visible to the caller (official or own).
    const { data: food, error: foodErr } = await db
      .from("foods")
      .select("id, name, food_nutrition(calories_kcal, protein_g, fat_g, carbs_g)")
      .eq("id", body.foodId)
      .maybeSingle();
    if (foodErr) throw foodErr;
    // The embedded 1:1 relation may arrive as an object or a single-element
    // array depending on how supabase-js resolves it; normalize both.
    type FN = { calories_kcal: number; protein_g: number; fat_g: number; carbs_g: number };
    const rawFn = food?.food_nutrition as FN | FN[] | null | undefined;
    const nutrition = Array.isArray(rawFn) ? rawFn[0] : rawFn;
    if (!food || !nutrition) throw ApiError.notFound();

    // 3. Scale on the backend.
    const scaled = scaleNutrition(
      {
        caloriesKcal: Number(nutrition.calories_kcal),
        proteinG: Number(nutrition.protein_g),
        fatG: Number(nutrition.fat_g),
        carbsG: Number(nutrition.carbs_g),
      },
      body.quantityG,
    );

    // 4. Store the snapshot. RLS WITH CHECK re-verifies meal ownership.
    const { data: inserted, error: insErr } = await db
      .from("meal_items")
      .insert({
        meal_id: body.mealId,
        user_id: user.id, // from session
        food_id: body.foodId,
        food_name: food.name,
        quantity_g: body.quantityG,
        serving_label: body.servingLabel ?? null,
        calories_kcal: scaled.caloriesKcal,
        protein_g: scaled.proteinG,
        fat_g: scaled.fatG,
        carbs_g: scaled.carbsG,
      })
      .select("id, calories_kcal, protein_g, fat_g, carbs_g")
      .single();
    if (insErr) throw insErr;

    await db.rpc("log_audit_event", {
      p_event_type: "meal_item.create",
      p_target_type: "meal_items",
      p_target_id: inserted.id,
      p_result: "success",
      p_request_id: requestId,
    });

    return NextResponse.json({ item: inserted }, { status: 201 });
  },
);
