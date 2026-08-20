import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { RATE_POLICIES } from "@/lib/api/rate-limit";
import { ApiError } from "@/lib/api/errors";
import { createExpenseSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/expenses?from=&to= — the caller's expenses in a date range
 * (defaults to the current month). RLS scopes rows to the caller.
 */
export const GET = withPipeline({}, async ({ req, db }) => {
  const now = new Date();
  const from = req.nextUrl.searchParams.get("from") ?? firstOfMonth(now);
  const to = req.nextUrl.searchParams.get("to") ?? now.toISOString().slice(0, 10);
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    throw ApiError.validation({ range: ["from/to must be YYYY-MM-DD"] });
  }

  const { data, error } = await db
    .from("expenses")
    .select("id, spent_on, amount, currency, category_id, merchant, note")
    .gte("spent_on", from)
    .lte("spent_on", to)
    .order("spent_on", { ascending: false })
    .limit(500);
  if (error) throw error;

  const rows = data ?? [];
  // Totals per currency (mixing currencies into one sum would be wrong).
  const totals: Record<string, number> = {};
  for (const r of rows) {
    totals[r.currency] = round2((totals[r.currency] ?? 0) + Number(r.amount));
  }

  return NextResponse.json({ from, to, expenses: rows, totalsByCurrency: totals });
});

/** POST /api/expenses — record an expense. */
export const POST = withPipeline(
  { schema: createExpenseSchema, rate: RATE_POLICIES.write },
  async ({ db, user, body, requestId }) => {
    const { data, error } = await db
      .from("expenses")
      .insert({
        user_id: user.id, // from session
        amount: body.amount,
        currency: body.currency ?? "TWD",
        spent_on: body.spentOn ?? undefined,
        category_id: body.categoryId ?? null,
        merchant: body.merchant ?? null,
        note: body.note ?? null,
      })
      .select("id")
      .single();
    // 23503 = foreign_key_violation (category doesn't exist). RLS WITH CHECK
    // already blocks another user's category, surfacing as a policy error.
    if (error?.code === "23503") throw ApiError.validation({ categoryId: ["Unknown category"] });
    if (error) throw error;

    await db.rpc("log_audit_event", {
      p_event_type: "expense.create",
      p_target_type: "expenses",
      p_target_id: data.id,
      p_result: "success",
      p_request_id: requestId,
    });

    return NextResponse.json({ id: data.id }, { status: 201 });
  },
);

function firstOfMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
