import { describe, expect, it } from "vitest";
import {
  PLAN_IDS,
  PLANS,
  allowedCurrencies,
  checkQuota,
  currencyAllowed,
  hasFeature,
  minimumPlanFor,
  seatLimit,
} from "./plans";

describe("plans", () => {
  it("is monotonic: higher plans never lose features", () => {
    for (let i = 1; i < PLAN_IDS.length; i++) {
      const lower = PLANS[PLAN_IDS[i - 1]!].limits.features;
      const higher = PLANS[PLAN_IDS[i]!].limits.features;
      for (const feat of lower) expect(higher.has(feat)).toBe(true);
    }
  });

  it("enforces quotas", () => {
    expect(checkQuota("starter", "invoicesPerMonth", 4)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(checkQuota("starter", "invoicesPerMonth", 5)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(checkQuota("pro", "invoicesPerMonth", 10_000)).toMatchObject({
      allowed: true,
      limit: null,
    });
  });

  it("computes seats", () => {
    expect(seatLimit("business", 2)).toBe(5);
    expect(seatLimit("enterprise")).toBeNull();
  });

  it("finds the cheapest plan for a feature", () => {
    expect(minimumPlanFor("recurring")).toBe("pro");
    expect(minimumPlanFor("advanced_reports")).toBe("business");
    expect(minimumPlanFor("api")).toBe("enterprise");
    expect(hasFeature("starter", "ai_drafts")).toBe(true);
  });
});

describe("allowedCurrencies", () => {
  it("lets every plan bill in its home currency", () => {
    expect(currencyAllowed("starter", "GBP", "GBP")).toBe(true);
    expect(currencyAllowed("starter", "CHF", "CHF")).toBe(true);
    expect(allowedCurrencies("starter", "GBP")).toEqual(["GBP", "USD", "EUR"]);
  });
  it("keeps USD and EUR available and other currencies paid on Starter", () => {
    expect(allowedCurrencies("starter", "EUR")).toEqual(["USD", "EUR"]);
    expect(currencyAllowed("starter", "USD", "GBP")).toBe(true);
    expect(currencyAllowed("starter", "JPY", "GBP")).toBe(false);
  });
  it("is unrestricted on paid plans", () => {
    expect(allowedCurrencies("pro", "EUR")).toBeNull();
    expect(currencyAllowed("business", "JPY", "EUR")).toBe(true);
  });
});
