import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { RATE_POLICIES } from "@/lib/api/rate-limit";
import { upsertProfileSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/profile — the caller's own profile.
 * Authorization is implicit: the RLS-bound client can only return the row
 * where user_id = auth.uid().
 */
export const GET = withPipeline({}, async ({ db }) => {
  const { data, error } = await db
    .from("user_profiles")
    .select("user_id, display_name, sex, birth_date, height_cm, activity_level, goal, created_at, updated_at")
    .maybeSingle();

  if (error) throw error;
  return NextResponse.json({ profile: data });
});

/**
 * PUT /api/profile — create or update the caller's own profile.
 * user_id is taken from the verified session, never from the body. RLS
 * WITH CHECK guarantees the row can only be the caller's own.
 */
export const PUT = withPipeline(
  { schema: upsertProfileSchema, rate: RATE_POLICIES.write },
  async ({ db, user, body, requestId }) => {
    const { error } = await db.from("user_profiles").upsert(
      {
        user_id: user.id, // from session, not from client input
        display_name: body.displayName ?? null,
        sex: body.sex,
        birth_date: body.birthDate,
        height_cm: body.heightCm,
        activity_level: body.activityLevel,
        goal: body.goal,
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;

    await db.rpc("log_audit_event", {
      p_event_type: "profile.upsert",
      p_target_type: "user_profiles",
      p_target_id: user.id,
      p_result: "success",
      p_request_id: requestId,
    });

    return NextResponse.json({ ok: true });
  },
);
