import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { RATE_POLICIES } from "@/lib/api/rate-limit";
import { createBodyMetricSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/body-metrics — the caller's own measurement history (Sensitive
 * data, §4.13). RLS restricts rows to the caller; we still return a minimal
 * projection and a bounded page.
 */
export const GET = withPipeline({}, async ({ db }) => {
  const { data, error } = await db
    .from("body_metrics")
    .select("id, measured_at, weight_kg, body_fat_pct, note")
    .order("measured_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  return NextResponse.json({ metrics: data ?? [] });
});

/**
 * POST /api/body-metrics — append a measurement. Time series: we always insert
 * a new row, never overwrite history (§2.1).
 */
export const POST = withPipeline(
  { schema: createBodyMetricSchema, rate: RATE_POLICIES.write },
  async ({ db, user, body, requestId }) => {
    const { data, error } = await db
      .from("body_metrics")
      .insert({
        user_id: user.id, // from session
        weight_kg: body.weightKg ?? null,
        body_fat_pct: body.bodyFatPct ?? null,
        measured_at: body.measuredAt ?? undefined,
        note: body.note ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;

    await db.rpc("log_audit_event", {
      p_event_type: "body_metric.create",
      p_target_type: "body_metrics",
      p_target_id: data.id,
      p_result: "success",
      p_request_id: requestId,
    });

    return NextResponse.json({ id: data.id }, { status: 201 });
  },
);
