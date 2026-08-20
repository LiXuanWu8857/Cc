import { describe, expect, it } from "vitest";
import { ageFromBirthDate, calcBmr, calcTargets, calcTdee } from "./calc";

describe("calcBmr (Mifflin-St Jeor)", () => {
  it("computes male BMR", () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    expect(calcBmr({ sex: "male", ageYears: 30, heightCm: 180, weightKg: 80 })).toBe(1780);
  });

  it("computes female BMR", () => {
    // 10*60 + 6.25*165 - 5*28 - 161 = 600 + 1031.25 - 140 - 161 = 1330.25
    expect(calcBmr({ sex: "female", ageYears: 28, heightCm: 165, weightKg: 60 })).toBe(1330.3);
  });

  it("uses the averaged constant for undisclosed sex", () => {
    // 10*70 + 6.25*170 - 5*30 - 78 = 700 + 1062.5 - 150 - 78 = 1534.5
    expect(calcBmr({ sex: "prefer_not_to_say", ageYears: 30, heightCm: 170, weightKg: 70 })).toBe(1534.5);
  });
});

describe("calcTdee", () => {
  it("applies the activity factor", () => {
    expect(calcTdee(1780, "moderate")).toBe(2759); // 1780 * 1.55 = 2759
  });
});

describe("calcTargets", () => {
  it("produces non-negative, goal-adjusted targets", () => {
    const t = calcTargets({
      sex: "male",
      ageYears: 30,
      heightCm: 180,
      weightKg: 80,
      activityLevel: "moderate",
      goal: "lose_fat",
    });
    expect(t.bmr).toBe(1780);
    expect(t.tdee).toBe(2759);
    // lose_fat => 2759 * 0.8 = 2207.2 -> 2207
    expect(t.caloriesKcal).toBe(2207);
    // protein = 2.0 g/kg * 80 = 160
    expect(t.proteinG).toBe(160);
    expect(t.fatG).toBeGreaterThan(0);
    expect(t.carbsG).toBeGreaterThanOrEqual(0);
  });

  it("never returns a negative macro", () => {
    const t = calcTargets({
      sex: "female",
      ageYears: 25,
      heightCm: 150,
      weightKg: 45,
      activityLevel: "sedentary",
      goal: "lose_fat",
    });
    expect(t.caloriesKcal).toBeGreaterThan(0);
    expect(t.proteinG).toBeGreaterThanOrEqual(0);
    expect(t.fatG).toBeGreaterThanOrEqual(0);
    expect(t.carbsG).toBeGreaterThanOrEqual(0);
  });
});

describe("ageFromBirthDate", () => {
  it("computes whole-year age, accounting for month/day", () => {
    const on = new Date("2026-08-20T00:00:00Z");
    expect(ageFromBirthDate("1990-01-01", on)).toBe(36);
    expect(ageFromBirthDate("1990-12-31", on)).toBe(35); // birthday not yet reached
  });
});
