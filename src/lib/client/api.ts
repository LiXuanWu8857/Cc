"use client";

/**
 * Thin client for our own backend API. Same-origin fetch sends the auth
 * cookies automatically, so every call runs under the user's RLS-bound
 * session. Never talks to the database or Supabase directly.
 */

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const e = body?.error ?? {};
    throw new ApiError(res.status, e.code ?? "error", e.message ?? "Request failed", e.details);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(data ?? {}) }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(data ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// ---- Shared response types (mirror the backend) ---------------------------

export interface Macro { caloriesKcal: number; proteinG: number; fatG: number; carbsG: number }
export interface FoodNutrition { calories_kcal: number; protein_g: number; fat_g: number; carbs_g: number }
export interface Food {
  id: string; name: string; brand: string | null; is_official: boolean;
  default_serving_g: number | null; food_nutrition: FoodNutrition | FoodNutrition[] | null;
}
export interface DashboardResp {
  date: string;
  totals: Macro;
  perMeal: Record<string, Macro>;
  target: {
    calories_effective: number; protein_g_effective: number;
    fat_g_effective: number; carbs_g_effective: number;
  } | null;
  progress: { caloriesPct: number; proteinPct: number; fatPct: number; carbsPct: number } | null;
  spending: { byCurrency: Record<string, number>; count: number };
}
export interface NutritionPer100g {
  caloriesKcal: number; proteinG: number; fatG: number; carbsG: number;
  fiberG?: number; sugarG?: number; sodiumMg?: number;
}
export interface BarcodeLocal { source: "local"; match: { barcode: string; foods: Food } }
export interface BarcodeExternal {
  source: "openfoodfacts";
  candidate: {
    name: string; brand?: string; barcode: string; defaultServingG?: number;
    nutritionPer100g: NutritionPer100g; warnings: string[];
  };
}

/** Normalize the embedded 1:1 nutrition relation (object or array). */
export function foodNutrition(f: Food): FoodNutrition | null {
  const n = f.food_nutrition;
  if (!n) return null;
  return Array.isArray(n) ? n[0] ?? null : n;
}

export interface PurchaseCost { costPer100Kcal: number | null; costPer10gProtein: number | null }
export interface FoodPurchase {
  id: string; purchased_on: string; quantity_g: number; price: number; currency: string;
  food_id: string | null; total_calories_kcal: number | null; total_protein_g: number | null;
  foods: { name: string; brand: string | null } | { name: string; brand: string | null }[] | null;
  cost: PurchaseCost;
}
export interface PurchasesResp { from: string; to: string; purchases: FoodPurchase[] }

/** Name of the food linked to a purchase (relation may be object or array). */
export function purchaseFoodName(p: FoodPurchase): string {
  const f = p.foods;
  const row = Array.isArray(f) ? f[0] : f;
  return row?.name ?? "未連結食品";
}
