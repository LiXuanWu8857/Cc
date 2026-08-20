import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { RATE_POLICIES } from "@/lib/api/rate-limit";
import { ApiError } from "@/lib/api/errors";
import { confirmScanSchema } from "@/lib/validation/schemas";
import { validateNutritionPer100g } from "@/lib/nutrition/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/scans/:id/confirm — the user accepts (and may have corrected) the
 * candidate. Only now does it become a PRIVATE user food (§4.10) — the AI never
 * writes food data on its own, and never the shared catalogue. The confirmed
 * values are validated again on the backend before storage.
 */
export const POST = withPipeline(
  { schema: confirmScanSchema, rate: RATE_POLICIES.write },
  async ({ req, db, body, requestId }) => {
    const id = req.nextUrl.pathname.split("/").slice(-2)[0] ?? "";
    if (!UUID.test(id)) throw ApiError.validation({ id: ["Invalid id"] });

    const { data: scan, error: loadErr } = await db
      .from("scan_records")
      .select("id, status, confirmed_food_id")
      .eq("id", id)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!scan) throw ApiError.notFound();
    if (scan.confirmed_food_id) throw ApiError.conflict("Scan already confirmed");

    const errors = validateNutritionPer100g(body.nutritionPer100g);
    if (errors.length > 0) throw ApiError.validation({ nutrition: errors });

    const n = body.nutritionPer100g;
    const { data: foodId, error: foodErr } = await db.rpc("create_user_food", {
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
    if (foodErr) throw foodErr;

    const { error: updErr } = await db
      .from("scan_records")
      .update({ status: "confirmed", confirmed_food_id: foodId as string, validation_errors: null })
      .eq("id", id);
    if (updErr) throw updErr;

    await db.rpc("log_audit_event", {
      p_event_type: "scan.confirm",
      p_target_type: "scan_records",
      p_target_id: id,
      p_result: "success",
      p_request_id: requestId,
      p_risk_meta: { food_id: foodId },
    });

    return NextResponse.json({ scanId: id, foodId, status: "confirmed" }, { status: 201 });
  },
);
