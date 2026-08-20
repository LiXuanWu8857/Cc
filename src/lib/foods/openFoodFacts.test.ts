import { describe, expect, it } from "vitest";
import { mapOffResponse } from "./openFoodFacts";

describe("mapOffResponse", () => {
  it("maps a well-formed product to a candidate", () => {
    const c = mapOffResponse("0123456789012", {
      status: 1,
      product: {
        product_name: "Greek Yogurt",
        brands: "BrandCo",
        serving_quantity: 150,
        nutriments: {
          "energy-kcal_100g": 59,
          proteins_100g: 10,
          fat_100g: 0.4,
          carbohydrates_100g: 3.6,
          fiber_100g: 0,
          sugars_100g: 3.2,
          sodium_100g: 0.05, // grams -> 50 mg
        },
      },
    });
    expect(c).not.toBeNull();
    expect(c!.name).toBe("Greek Yogurt");
    expect(c!.brand).toBe("BrandCo");
    expect(c!.defaultServingG).toBe(150);
    expect(c!.nutritionPer100g).toMatchObject({
      caloriesKcal: 59,
      proteinG: 10,
      fatG: 0.4,
      carbsG: 3.6,
      sodiumMg: 50,
    });
    expect(c!.source).toBe("openfoodfacts");
  });

  it("coerces string-typed nutriment values (OFF is messy)", () => {
    const c = mapOffResponse("1", {
      status: 1,
      product: {
        product_name: "X",
        nutriments: {
          "energy-kcal_100g": "89",
          proteins_100g: "1.1",
          fat_100g: "0.3",
          carbohydrates_100g: "23",
        },
      },
    });
    expect(c!.nutritionPer100g.caloriesKcal).toBe(89);
    expect(c!.nutritionPer100g.proteinG).toBe(1.1);
  });

  it("falls back to salt when sodium is absent (salt/2.5)", () => {
    const c = mapOffResponse("1", {
      status: 1,
      product: {
        product_name: "Salty",
        nutriments: {
          "energy-kcal_100g": 100,
          proteins_100g: 1,
          fat_100g: 1,
          carbohydrates_100g: 1,
          salt_100g: 2.5, // -> sodium 1 g -> 1000 mg
        },
      },
    });
    expect(c!.nutritionPer100g.sodiumMg).toBe(1000);
  });

  it("returns null when the product is not found", () => {
    expect(mapOffResponse("1", { status: 0 })).toBeNull();
  });

  it("returns null when core macros are incomplete", () => {
    const c = mapOffResponse("1", {
      status: 1,
      product: { product_name: "Incomplete", nutriments: { "energy-kcal_100g": 100 } },
    });
    expect(c).toBeNull();
  });

  it("returns null when there is no usable name", () => {
    const c = mapOffResponse("1", {
      status: 1,
      product: {
        nutriments: { "energy-kcal_100g": 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 },
      },
    });
    expect(c).toBeNull();
  });

  it("flags a calorie/macro mismatch as a warning (still returns candidate)", () => {
    const c = mapOffResponse("1", {
      status: 1,
      product: {
        product_name: "Suspicious",
        nutriments: {
          "energy-kcal_100g": 500, // macros imply ~44 kcal
          proteins_100g: 1,
          fat_100g: 1,
          carbohydrates_100g: 10,
        },
      },
    });
    expect(c).not.toBeNull();
    expect(c!.warnings.length).toBeGreaterThan(0);
  });
});
