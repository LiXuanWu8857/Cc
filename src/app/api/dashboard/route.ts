import { NextResponse } from "next/server";
import { withPipeline } from "@/lib/api/pipeline";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ItemRow {
  meal_type: string;
  calories_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
}

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

/**
 * GET /api/dashboard?date=YYYY-MM-DD — the day's nutrition summary.
 * Totals are summed from the immutable meal_item snapshots (not recomputed
 * from foods), then compared against the caller's active target. RLS scopes
 * every row to the caller. Expenses arrive in Phase 4.
 */
export const GET = withPipeline({}, async ({ req, db }) => {
  const date = req.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!ISO_DATE.test(date)) throw ApiError.validation({ date: ["Expected YYYY-MM-DD"] });

  // Flatten meal_items for the day via their parent meal (RLS-scoped).
  const { data: meals, error: mealsErr } = await db
    .from("meals")
    .select("meal_type, meal_items(calories_kcal, protein_g, fat_g, carbs_g)")
    .eq("consumed_on", date);
  if (mealsErr) throw mealsErr;

  const rows: ItemRow[] = [];
  for (const meal of meals ?? []) {
    const items = (meal.meal_items ?? []) as Omit<ItemRow, "meal_type">[];
    for (const it of items) rows.push({ meal_type: meal.meal_type as string, ...it });
  }

  const totals = sum(rows);
  const perMeal = Object.fromEntries(
    MEAL_TYPES.map((t) => [t, sum(rows.filter((r) => r.meal_type === t))]),
  );

  // Active target for progress bars (may be null if not computed yet).
  const { data: target, error: targetErr } = await db
    .from("nutrition_targets")
    .select("calories_effective, protein_g_effective, fat_g_effective, carbs_g_effective")
    .eq("is_active", true)
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (targetErr) throw targetErr;

  const progress = target
    ? {
        caloriesPct: pct(totals.caloriesKcal, Number(target.calories_effective)),
        proteinPct: pct(totals.proteinG, Number(target.protein_g_effective)),
        fatPct: pct(totals.fatG, Number(target.fat_g_effective)),
        carbsPct: pct(totals.carbsG, Number(target.carbs_g_effective)),
      }
    : null;

  return NextResponse.json({
    date,
    totals,
    perMeal,
    target: target ?? null,
    progress,
    // Expenses summary placeholder until Phase 4.
    spending: null,
  });
});

function sum(rows: Array<Omit<ItemRow, "meal_type">>) {
  return rows.reduce(
    (acc, r) => ({
      caloriesKcal: round1(acc.caloriesKcal + Number(r.calories_kcal)),
      proteinG: round1(acc.proteinG + Number(r.protein_g)),
      fatG: round1(acc.fatG + Number(r.fat_g)),
      carbsG: round1(acc.carbsG + Number(r.carbs_g)),
    }),
    { caloriesKcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
  );
}

function pct(consumed: number, target: number): number {
  if (!target || target <= 0) return 0;
  return Math.round((consumed / target) * 100);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
