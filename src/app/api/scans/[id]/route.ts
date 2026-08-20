import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/scans/:id — one scan with its candidate & validation status.
 * RLS restricts to the caller; a scan that is not theirs returns 404.
 */
export const GET = withPipeline({}, async ({ req, db }) => {
  const id = req.nextUrl.pathname.split("/").pop() ?? "";
  if (!UUID.test(id)) throw ApiError.validation({ id: ["Invalid id"] });

  const { data, error } = await db
    .from("scan_records")
    .select(
      "id, kind, status, candidate, confidence, validation_errors, confirmed_food_id, provider, error_code, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw ApiError.notFound();
  return NextResponse.json({ scan: data });
});
