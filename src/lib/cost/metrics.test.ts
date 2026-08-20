import { describe, expect, it } from "vitest";
import { costPer100Kcal, costPer10gProtein, purchaseCostMetrics } from "./metrics";

describe("costPer100Kcal", () => {
  it("computes price per 100 kcal", () => {
    // $60 for 1200 kcal -> per 100 kcal = 60 * 100 / 1200 = 5
    expect(costPer100Kcal(60, 1200)).toBe(5);
  });
  it("returns null when calories are missing or zero", () => {
    expect(costPer100Kcal(60, 0)).toBeNull();
    expect(costPer100Kcal(60, null)).toBeNull();
    expect(costPer100Kcal(60, undefined)).toBeNull();
  });
});

describe("costPer10gProtein", () => {
  it("computes price per 10 g protein", () => {
    // $50 for 100 g protein -> per 10 g = 50 * 10 / 100 = 5
    expect(costPer10gProtein(50, 100)).toBe(5);
  });
  it("returns null when protein is missing or zero", () => {
    expect(costPer10gProtein(50, 0)).toBeNull();
    expect(costPer10gProtein(50, null)).toBeNull();
  });
});

describe("purchaseCostMetrics", () => {
  it("returns both metrics", () => {
    expect(purchaseCostMetrics({ price: 60, totalCaloriesKcal: 1200, totalProteinG: 120 })).toEqual({
      costPer100Kcal: 5,
      costPer10gProtein: 5,
    });
  });
  it("degrades gracefully with no nutrition", () => {
    expect(purchaseCostMetrics({ price: 60 })).toEqual({
      costPer100Kcal: null,
      costPer10gProtein: null,
    });
  });
});
