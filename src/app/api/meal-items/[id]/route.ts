import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { RATE_POLICIES } from "@/lib/api/rate-limit";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/meal-items/:id — remove one of the caller's meal items.
 * RLS restricts the delete to the caller's own rows; if it affects zero rows
 * (not found or not owned) we return 404 without revealing which.
 */
export const DELETE = withPipeline(
  { rate: RATE_POLICIES.write },
  async ({ req, db, user, requestId }) => {
    const id = req.nextUrl.pathname.split("/").pop() ?? "";
    if (!UUID.test(id)) throw ApiError.validation({ id: ["Invalid id"] });

    const { data, error } = await db
      .from("meal_items")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw ApiError.notFound();

    await db.rpc("log_audit_event", {
      p_event_type: "meal_item.delete",
      p_target_type: "meal_items",
      p_target_id: id,
      p_result: "success",
      p_request_id: requestId,
    });

    return NextResponse.json({ ok: true });
  },
);
