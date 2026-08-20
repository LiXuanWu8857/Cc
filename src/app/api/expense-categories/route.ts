import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { RATE_POLICIES } from "@/lib/api/rate-limit";
import { ApiError } from "@/lib/api/errors";
import { createExpenseCategorySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/expense-categories — the caller's own categories. */
export const GET = withPipeline({}, async ({ db }) => {
  const { data, error } = await db
    .from("expense_categories")
    .select("id, name, created_at")
    .order("name", { ascending: true });
  if (error) throw error;
  return NextResponse.json({ categories: data ?? [] });
});

/** POST /api/expense-categories — create a category (unique per user by name). */
export const POST = withPipeline(
  { schema: createExpenseCategorySchema, rate: RATE_POLICIES.write },
  async ({ db, user, body, requestId }) => {
    const { data, error } = await db
      .from("expense_categories")
      .insert({ user_id: user.id, name: body.name })
      .select("id")
      .single();
    // 23505 = unique_violation -> category name already exists for this user.
    if (error?.code === "23505") throw ApiError.conflict("Category already exists");
    if (error) throw error;

    await db.rpc("log_audit_event", {
      p_event_type: "expense_category.create",
      p_target_type: "expense_categories",
      p_target_id: data.id,
      p_result: "success",
      p_request_id: requestId,
    });

    return NextResponse.json({ id: data.id }, { status: 201 });
  },
);
