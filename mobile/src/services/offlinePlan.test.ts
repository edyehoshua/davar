// Bun provides this test module at runtime; Expo's resolver does not index it.
// eslint-disable-next-line import/no-unresolved
import { describe, expect, test } from "bun:test";
import { getBundleUpdatePlan } from "./offlinePlan";

describe("getBundleUpdatePlan", () => {
  test("does not advertise TS2009 as an English offline bundle", () => {
    const plan = getBundleUpdatePlan(
      "en",
      { ts2009: 1 },
      { ts2009: 2, tanaj: 3 },
    );

    expect(plan.translationDataset).toBeNull();
    expect(plan.needs.translation).toBe(false);
  });

  test("keeps Spanish TTH in the offline bundle plan", () => {
    const plan = getBundleUpdatePlan("es", { tth: 1 }, { tth: 2 });

    expect(plan.translationDataset).toBe("tth");
    expect(plan.needs.translation).toBe(true);
  });
});
