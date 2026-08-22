import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { RATE_POLICIES } from "@/lib/api/rate-limit";
import { ApiError } from "@/lib/api/errors";
import { createFoodPurchaseSchema } from "@/lib/validation/schemas";
import { scaleNutrition } from "@/lib/nutrition/validate";
import { purchaseCostMetrics } from "@/lib/cost/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/food-purchases?from=&to= — the caller's purchases with derived cost
 * metrics (cost per 100 kcal, cost per 10 g protein). Ratios are computed here
 * from price + snapshot nutrition, never stored.
 */
export const GET = withPipeline({}, async ({ req, db }) => {
  const now = new Date();
  const from = req.nextUrl.searchParams.get("from") ?? firstOfMonth(now);
  const to = req.nextUrl.searchParams.get("to") ?? now.toISOString().slice(0, 10);
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    throw ApiError.validation({ range: ["from/to must be YYYY-MM-DD"] });
  }

  const { data, error } = await db
    .from("food_purchases")
    .select("id, purchased_on, quantity_g, price, currency, food_id, expense_id, total_calories_kcal, total_protein_g, foods(name, brand)")
    .gte("purchased_on", from)
    .lte("purchased_on", to)
    .order("purchased_on", { ascending: false })
    .limit(500);
  if (error) throw error;

  const purchases = (data ?? []).map((p) => ({
    ...p,
    cost: purchaseCostMetrics({
      price: Number(p.price),
      totalCaloriesKcal: p.total_calories_kcal === null ? null : Number(p.total_calories_kcal),
      totalProteinG: p.total_protein_g === null ? null : Number(p.total_protein_g),
    }),
  }));

  return NextResponse.json({ from, to, purchases });
});

/**
 * POST /api/food-purchases — record a purchase. When a food is linked, the
 * backend reads its per-100g nutrition (RLS: official or own) and snapshots the
 * purchased quantity's calories & protein for stable cost analysis (§2.2).
 */
export const POST = withPipeline(
  { schema: createFoodPurchaseSchema, rate: RATE_POLICIES.write },
  async ({ db, user, body, requestId }) => {
    let totalCalories: number | null = null;
    let totalProtein: number | null = null;

    if (body.foodId) {
      const { data: food, error: foodErr } = await db
        .from("foods")
        .select("id, food_nutrition(calories_kcal, protein_g, fat_g, carbs_g)")
        .eq("id", body.foodId)
        .maybeSingle();
      if (foodErr) throw foodErr;
      type FN = { calories_kcal: number; protein_g: number; fat_g: number; carbs_g: number };
      const rawFn = food?.food_nutrition as FN | FN[] | null | undefined;
      const nutrition = Array.isArray(rawFn) ? rawFn[0] : rawFn;
      // A linked food must be visible; missing nutrition is a validation error.
      if (!food) throw ApiError.notFound();
      if (nutrition) {
        const scaled = scaleNutrition(
          {
            caloriesKcal: Number(nutrition.calories_kcal),
            proteinG: Number(nutrition.protein_g),
            fatG: Number(nutrition.fat_g),
            carbsG: Number(nutrition.carbs_g),
          },
          body.quantityG,
        );
        totalCalories = scaled.caloriesKcal;
        totalProtein = scaled.proteinG;
      }
    }

    const { data: inserted, error } = await db
      .from("food_purchases")
      .insert({
        user_id: user.id, // from session
        expense_id: body.expenseId ?? null,
        food_id: body.foodId ?? null,
        purchased_on: body.purchasedOn ?? undefined,
        quantity_g: body.quantityG,
        price: body.price,
        currency: body.currency ?? "TWD",
        total_calories_kcal: totalCalories,
        total_protein_g: totalProtein,
      })
      .select("id, total_calories_kcal, total_protein_g")
      .single();
    if (error?.code === "23503") throw ApiError.validation({ link: ["Unknown food or expense"] });
    if (error) throw error;

    await db.rpc("log_audit_event", {
      p_event_type: "food_purchase.create",
      p_target_type: "food_purchases",
      p_target_id: inserted.id,
      p_result: "success",
      p_request_id: requestId,
    });

    return NextResponse.json(
      {
        id: inserted.id,
        cost: purchaseCostMetrics({
          price: body.price,
          totalCaloriesKcal: totalCalories,
          totalProteinG: totalProtein,
        }),
      },
      { status: 201 },
    );
  },
);

function firstOfMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
