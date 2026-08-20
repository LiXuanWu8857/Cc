import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withPipeline } from "@/lib/api/pipeline";
import { RATE_POLICIES } from "@/lib/api/rate-limit";
import { ApiError } from "@/lib/api/errors";
import { reserveAiBudget, settleAiCost } from "@/lib/ai/costGuard";
import { getOcrProvider, ProviderNotConfiguredError } from "@/lib/ocr/provider";
import { getNutritionParser, ParserNotConfiguredError } from "@/lib/ai/nutritionParser";
import { validateImageBytes } from "@/lib/upload/validateImage";
import { validateNutritionPer100g } from "@/lib/nutrition/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCANS_BUCKET = "scans";

/**
 * POST /api/scans/:id/process — run the server-only OCR -> AI -> candidate
 * pipeline for an uploaded image (§4.9, §4.10, §4.12).
 *
 * Order matters:
 *   1. Load the scan (RLS: own only).
 *   2. Reserve AI budget ATOMICALLY *before* any provider call. Over budget
 *      -> deny (429) without calling anything.
 *   3. Read the private image (RLS-scoped) and re-validate its bytes.
 *   4. OCR -> parse -> candidate -> backend nutrition validation.
 *   5. Store the candidate (never auto-promote to a food); user confirms later.
 *
 * No provider is configured yet, so step 4 returns 501 and the reserved budget
 * is refunded. Wiring a provider (see src/lib/ocr, src/lib/ai) makes this live
 * with no other changes.
 */
export const POST = withPipeline(
  { rate: RATE_POLICIES.write },
  async ({ req, db, requestId }) => {
    const id = req.nextUrl.pathname.split("/").slice(-2)[0] ?? "";
    if (!UUID.test(id)) throw ApiError.validation({ id: ["Invalid id"] });

    // 1. Load (RLS ensures it is the caller's).
    const { data: scan, error: loadErr } = await db
      .from("scan_records")
      .select("id, kind, status, object_path")
      .eq("id", id)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!scan) throw ApiError.notFound();
    if (scan.status === "confirmed") throw ApiError.conflict("Scan already confirmed");

    // 2. Reserve budget before touching any provider.
    const reserved = await reserveAiBudget(db);
    if (!reserved) throw ApiError.rateLimited(); // daily AI/OCR budget exhausted

    try {
      // 3. Fetch the private image and re-validate its bytes.
      const { data: blob, error: dlErr } = await db.storage
        .from(SCANS_BUCKET)
        .download(scan.object_path);
      if (dlErr || !blob) {
        await markFailed(db, id, "upload_missing");
        throw ApiError.validation({ upload: ["Image not found; upload it first"] });
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const imgCheck = validateImageBytes(bytes);
      if (!imgCheck.ok) {
        await markFailed(db, id, "invalid_image", imgCheck.errors);
        throw ApiError.validation({ image: imgCheck.errors });
      }

      await db.from("scan_records").update({ status: "processing" }).eq("id", id);

      // 4. OCR -> AI parse. Not configured yet -> 501 (budget refunded below).
      const ocr = getOcrProvider();
      const mime = imgCheck.format === "png" ? "image/png" : "image/jpeg";
      const ocrResult = await ocr.extractText(bytes, mime);

      const parser = getNutritionParser();
      const parsed = await parser.parse(ocrResult.text);

      // 5. Backend validation of the candidate; store, never auto-promote.
      const errors = validateNutritionPer100g(parsed.candidate.nutritionPer100g);
      const status = errors.length > 0 ? "needs_review" : "parsed";
      const totalCost = (ocrResult.costUsd ?? 0) + (parsed.costUsd ?? 0);

      await db
        .from("scan_records")
        .update({
          status,
          candidate: parsed.candidate,
          confidence: parsed.candidate.confidence ?? null,
          validation_errors: errors.length > 0 ? errors : null,
          provider: `${ocrResult.provider}+${parsed.provider}`,
          ocr_cost: ocrResult.costUsd ?? null,
          ai_cost: parsed.costUsd ?? null,
          error_code: null,
        })
        .eq("id", id);
      await settleAiCost(db, totalCost);

      await db.rpc("log_audit_event", {
        p_event_type: "scan.process",
        p_target_type: "scan_records",
        p_target_id: id,
        p_result: "success",
        p_request_id: requestId,
        p_risk_meta: { status },
      });

      return NextResponse.json({ scanId: id, status });
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError || err instanceof ParserNotConfiguredError) {
        // No provider call happened -> refund the reservation and report 501.
        await settleAiCost(db, 0);
        await markFailed(db, id, "provider_not_configured", undefined, "uploaded");
        throw ApiError.notImplemented("OCR/AI provider not configured");
      }
      // Anything else already-shaped stays as-is; refund best-effort.
      await settleAiCost(db, 0).catch(() => {});
      throw err;
    }
  },
);

async function markFailed(
  db: SupabaseClient,
  id: string,
  errorCode: string,
  validationErrors?: string[],
  status: "failed" | "uploaded" = "failed",
) {
  await db
    .from("scan_records")
    .update({
      status,
      error_code: errorCode,
      validation_errors: validationErrors ?? null,
    })
    .eq("id", id);
}
