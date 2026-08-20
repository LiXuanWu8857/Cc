import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { RATE_POLICIES } from "@/lib/api/rate-limit";
import { createScanSchema } from "@/lib/validation/schemas";
import { scanObjectPath } from "@/lib/storage/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCANS_BUCKET = "scans";

/** GET /api/scans — the caller's recent scans (minimal projection). */
export const GET = withPipeline({}, async ({ db }) => {
  const { data, error } = await db
    .from("scan_records")
    .select("id, kind, status, confidence, confirmed_food_id, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return NextResponse.json({ scans: data ?? [] });
});

/**
 * POST /api/scans — start a scan.
 *
 * The backend generates the private object path (client never chooses it,
 * §4.8), creates the scan_records row, and returns a short-lived signed UPLOAD
 * url the client posts the image to directly. Storage RLS also constrains the
 * upload to the caller's own uid prefix.
 */
export const POST = withPipeline(
  { schema: createScanSchema, rate: RATE_POLICIES.write },
  async ({ db, user, body, requestId }) => {
    const objectPath = scanObjectPath(user.id, body.kind);

    const { data: scan, error } = await db
      .from("scan_records")
      .insert({
        user_id: user.id, // from session
        kind: body.kind,
        status: "awaiting_upload",
        object_path: objectPath,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: signed, error: signErr } = await db.storage
      .from(SCANS_BUCKET)
      .createSignedUploadUrl(objectPath);
    if (signErr) throw signErr;

    await db.rpc("log_audit_event", {
      p_event_type: "scan.create",
      p_target_type: "scan_records",
      p_target_id: scan.id,
      p_result: "success",
      p_request_id: requestId,
    });

    return NextResponse.json(
      {
        scanId: scan.id,
        upload: { bucket: SCANS_BUCKET, path: objectPath, signedUrl: signed.signedUrl, token: signed.token },
      },
      { status: 201 },
    );
  },
);
