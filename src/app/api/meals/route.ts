import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { RATE_POLICIES } from "@/lib/api/rate-limit";
import { ApiError } from "@/lib/api/errors";
import { createMealSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/meals?date=YYYY-MM-DD — the caller's meals (with items) for a day.
 * Defaults to today. RLS restricts both meals and meal_items to the caller.
 */
export const GET = withPipeline({}, async ({ req, db }) => {
  const date = req.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!ISO_DATE.test(date)) throw ApiError.validation({ date: ["Expected YYYY-MM-DD"] });

  const { data, error } = await db
    .from("meals")
    .select(
      "id, meal_type, consumed_on, consumed_at, note, meal_items(id, food_id, food_name, quantity_g, serving_label, calories_kcal, protein_g, fat_g, carbs_g)",
    )
    .eq("consumed_on", date)
    .order("consumed_at", { ascending: true });

  if (error) throw error;
  return NextResponse.json({ meals: data ?? [] });
});

/** POST /api/meals — create a meal for the caller. */
export const POST = withPipeline(
  { schema: createMealSchema, rate: RATE_POLICIES.write },
  async ({ db, user, body, requestId }) => {
    const { data, error } = await db
      .from("meals")
      .insert({
        user_id: user.id, // from session
        meal_type: body.mealType,
        consumed_on: body.consumedOn ?? undefined,
        note: body.note ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;

    await db.rpc("log_audit_event", {
      p_event_type: "meal.create",
      p_target_type: "meals",
      p_target_id: data.id,
      p_result: "success",
      p_request_id: requestId,
    });

    return NextResponse.json({ id: data.id }, { status: 201 });
  },
);
