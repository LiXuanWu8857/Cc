import type { NutritionPer100g } from "@/lib/nutrition/validate";
import { validateNutritionPer100g } from "@/lib/nutrition/validate";

/**
 * OpenFoodFacts barcode lookup — the FREE tier food data source (§6).
 *
 * This is a swappable provider, same pattern as the OCR/AI seams: to move to a
 * paid barcode database later, implement another `lookup*` returning an
 * ExternalFoodCandidate and switch the call site — nothing else changes.
 *
 * Trust model: OpenFoodFacts is community-sourced and UNTRUSTED. We never
 * auto-write it into our catalogue (§4.10). The lookup returns a CANDIDATE
 * only; the user confirms it (via POST /api/foods), which re-validates on the
 * backend before anything is stored.
 */

const OFF_ENDPOINT = "https://world.openfoodfacts.org/api/v2/product";
const OFF_FIELDS = "code,product_name,brands,nutriments,serving_quantity";
// OpenFoodFacts asks callers to identify themselves with a descriptive UA.
const USER_AGENT = "FoodTrack/0.1 (self-hosted; barcode lookup)";
const TIMEOUT_MS = 4000;

export interface ExternalFoodCandidate {
  source: "openfoodfacts";
  barcode: string;
  name: string;
  brand?: string;
  defaultServingG?: number;
  nutritionPer100g: NutritionPer100g;
  /** Non-fatal validation notes (e.g. calorie/macro mismatch) for the UI to
   *  flag; the user still confirms and can correct before saving. */
  warnings: string[];
}

/** Shape of the OpenFoodFacts v2 response we care about (all fields optional
 *  and possibly string-typed — OFF data is messy). */
interface OffResponse {
  status?: number;
  product?: {
    code?: string;
    product_name?: string;
    brands?: string;
    serving_quantity?: number | string;
    nutriments?: Record<string, number | string | undefined>;
  };
}

/**
 * Pure mapping from an OpenFoodFacts response to our candidate shape.
 * Returns null when the product is missing or lacks the four core nutrients /
 * a name — we cannot build a usable food from that.
 */
export function mapOffResponse(barcode: string, raw: OffResponse): ExternalFoodCandidate | null {
  if (raw.status !== 1 || !raw.product) return null;
  const p = raw.product;
  const n = p.nutriments ?? {};

  const name = firstNonEmpty(p.product_name, p.brands);
  if (!name) return null;

  const calories = num(n["energy-kcal_100g"]);
  const protein = num(n["proteins_100g"]);
  const fat = num(n["fat_100g"]);
  const carbs = num(n["carbohydrates_100g"]);
  if (calories === null || protein === null || fat === null || carbs === null) {
    return null; // core macros incomplete
  }

  const fiber = num(n["fiber_100g"]);
  const sugar = num(n["sugars_100g"]);
  // Prefer sodium; fall back to salt/2.5. OFF reports both in grams/100g.
  const sodiumG = num(n["sodium_100g"]);
  const saltG = num(n["salt_100g"]);
  const sodiumMg =
    sodiumG !== null ? sodiumG * 1000 : saltG !== null ? (saltG / 2.5) * 1000 : null;

  const nutritionPer100g: NutritionPer100g = {
    caloriesKcal: round1(calories),
    proteinG: round1(protein),
    fatG: round1(fat),
    carbsG: round1(carbs),
    ...(fiber !== null ? { fiberG: round1(fiber) } : {}),
    ...(sugar !== null ? { sugarG: round1(sugar) } : {}),
    ...(sodiumMg !== null ? { sodiumMg: round1(sodiumMg) } : {}),
  };

  const servingG = num(p.serving_quantity);

  return {
    source: "openfoodfacts",
    barcode,
    name: name.slice(0, 200),
    ...(firstNonEmpty(p.brands) ? { brand: p.brands!.slice(0, 120) } : {}),
    ...(servingG !== null && servingG > 0 && servingG <= 10000
      ? { defaultServingG: round1(servingG) }
      : {}),
    nutritionPer100g,
    // Advisory only — the confirm step re-validates and can reject.
    warnings: validateNutritionPer100g(nutritionPer100g),
  };
}

/**
 * Look up a barcode on OpenFoodFacts. Fails SOFT: any network error, timeout,
 * or missing product resolves to null (the caller returns 404), never a 500.
 * Production egress must allow world.openfoodfacts.org.
 */
export async function lookupOpenFoodFacts(barcode: string): Promise<ExternalFoodCandidate | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${OFF_ENDPOINT}/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as OffResponse;
    return mapOffResponse(barcode, raw);
  } catch {
    return null; // fail soft — treat as "not found"
  } finally {
    clearTimeout(timer);
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function firstNonEmpty(...vals: (string | undefined)[]): string | null {
  for (const v of vals) {
    if (v && v.trim().length > 0) return v.trim();
  }
  return null;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
