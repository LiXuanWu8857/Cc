import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { ApiError } from "@/lib/api/errors";
import { lookupOpenFoodFacts } from "@/lib/foods/openFoodFacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/foods/barcode/:barcode — resolve a scanned barcode.
 *
 * Order:
 *   1. Local catalogue (RLS: official + own). A hit is authoritative.
 *   2. Miss -> OpenFoodFacts (free). Returns a CANDIDATE only — nothing is
 *      written (§4.10). The client pre-fills the "add food" form with it and
 *      the user confirms via POST /api/foods, which re-validates server-side.
 *
 * External lookup can be skipped with ?external=0 (e.g. offline / privacy).
 */
export const GET = withPipeline({}, async ({ req, db }) => {
  const barcode = req.nextUrl.pathname.split("/").pop() ?? "";
  if (!/^[0-9]{8,14}$/.test(barcode)) throw ApiError.validation({ barcode: ["Invalid barcode"] });

  // 1. Local first.
  const { data, error } = await db
    .from("food_barcodes")
    .select(
      "barcode, foods(id, name, brand, is_official, default_serving_g, food_nutrition(calories_kcal, protein_g, fat_g, carbs_g))",
    )
    .eq("barcode", barcode)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data) return NextResponse.json({ source: "local", match: data });

  // 2. External fallback (opt-out with ?external=0).
  if (req.nextUrl.searchParams.get("external") !== "0") {
    const candidate = await lookupOpenFoodFacts(barcode);
    if (candidate) return NextResponse.json({ source: "openfoodfacts", candidate });
  }

  throw ApiError.notFound();
});
