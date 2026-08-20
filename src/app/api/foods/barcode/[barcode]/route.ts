import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/foods/barcode/:barcode — resolve a scanned barcode to a food the
 * caller may see (official or own). RLS on food_barcodes / foods enforces
 * visibility; a barcode belonging only to another user's private food returns
 * 404, never that user's data.
 */
export const GET = withPipeline({}, async ({ req, db }) => {
  const barcode = req.nextUrl.pathname.split("/").pop() ?? "";
  if (!/^[0-9]{8,14}$/.test(barcode)) throw ApiError.validation({ barcode: ["Invalid barcode"] });

  const { data, error } = await db
    .from("food_barcodes")
    .select(
      "barcode, foods(id, name, brand, is_official, default_serving_g, food_nutrition(calories_kcal, protein_g, fat_g, carbs_g))",
    )
    .eq("barcode", barcode)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw ApiError.notFound();
  return NextResponse.json({ match: data });
});
