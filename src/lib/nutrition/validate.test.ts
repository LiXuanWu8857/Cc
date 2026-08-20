import { describe, expect, it } from "vitest";
import { scaleNutrition, validateNutritionPer100g } from "./validate";

describe("validateNutritionPer100g", () => {
  it("accepts consistent nutrition", () => {
    // 20p*4 + 10c*4 + 5f*9 = 80 + 40 + 45 = 165 kcal
    expect(
      validateNutritionPer100g({ caloriesKcal: 165, proteinG: 20, fatG: 5, carbsG: 10 }),
    ).toEqual([]);
  });

  it("rejects negative values", () => {
    const errs = validateNutritionPer100g({ caloriesKcal: 100, proteinG: -1, fatG: 5, carbsG: 10 });
    expect(errs.some((e) => e.includes("proteinG"))).toBe(true);
  });

  it("rejects out-of-range calories", () => {
    const errs = validateNutritionPer100g({ caloriesKcal: 5000, proteinG: 10, fatG: 10, carbsG: 10 });
    expect(errs.some((e) => e.includes("caloriesKcal"))).toBe(true);
  });

  it("flags a calorie/macro mismatch (likely OCR/typo error)", () => {
    // macros imply ~165 kcal but label says 500 -> gap far beyond tolerance
    const errs = validateNutritionPer100g({ caloriesKcal: 500, proteinG: 20, fatG: 5, carbsG: 10 });
    expect(errs.some((e) => e.includes("do not match macros"))).toBe(true);
  });

  it("tolerates small rounding differences", () => {
    // macros = 160, label 170 -> within max(50, 20%) tolerance
    expect(
      validateNutritionPer100g({ caloriesKcal: 170, proteinG: 20, fatG: 5, carbsG: 15 }),
    ).toEqual([]);
  });
});

describe("scaleNutrition", () => {
  it("scales per-100g to the consumed grams", () => {
    const scaled = scaleNutrition(
      { caloriesKcal: 200, proteinG: 20, fatG: 10, carbsG: 5 },
      150,
    );
    expect(scaled).toEqual({ caloriesKcal: 300, proteinG: 30, fatG: 15, carbsG: 7.5 });
  });

  it("throws on non-positive grams", () => {
    expect(() => scaleNutrition({ caloriesKcal: 1, proteinG: 1, fatG: 1, carbsG: 1 }, 0)).toThrow();
  });
});
