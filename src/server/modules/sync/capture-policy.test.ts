import { describe, it, expect } from "vitest";
import {
  evaluateCapturePolicy,
  type CapturePolicyInput,
} from "./capture-policy";
const at = (hours: number) => new Date(Date.UTC(2026, 10, 5, hours));
const fixture = (): CapturePolicyInput => ({
  signedInAt: at(1),
  receivedAt: at(2),
  offlineExpiresAt: at(25),
  contextRevokedAt: null,
  assignment: { effectiveFrom: at(0), effectiveUntil: null },
  rateKobo: "100000",
  currency: "NGN",
  prices: [{ effectiveFrom: at(0), rateKobo: "100000", currency: "NGN" }],
  settings: [],
});
describe("P-18 bounded capture policy", () => {
  it("credits uniform historical answers without trusting a phone timestamp", () =>
    expect(evaluateCapturePolicy(fixture())).toEqual({
      reasons: [],
      campaignEligible: false,
    }));
  it("ignores precision-only price versions with the same applicable rate", () => {
    const f = fixture();
    f.prices.push({
      effectiveFrom: at(2),
      rateKobo: "100000",
      currency: "NGN",
    });
    expect(evaluateCapturePolicy(f).reasons).toEqual([]);
  });
  it("holds price variation including a change at the receipt bound", () => {
    const f = fixture();
    f.prices.push({
      effectiveFrom: at(2),
      rateKobo: "110000",
      currency: "NGN",
    });
    expect(evaluateCapturePolicy(f).reasons).toContain("price_uncertain");
  });
  it("accepts a provably old rate when activation occurs after first receipt", () => {
    const f = fixture();
    f.prices.push({
      effectiveFrom: at(3),
      rateKobo: "110000",
      currency: "NGN",
    });
    expect(evaluateCapturePolicy(f).reasons).toEqual([]);
  });
  it("does not confuse a later equal rate with uniform price history", () => {
    const f = fixture();
    f.receivedAt = at(4);
    f.prices.push(
      { effectiveFrom: at(2), rateKobo: "110000", currency: "NGN" },
      { effectiveFrom: at(3), rateKobo: "100000", currency: "NGN" },
    );
    expect(evaluateCapturePolicy(f).reasons).toContain("price_uncertain");
  });
  it("holds missing price history and inverted trusted bounds", () => {
    const f = fixture();
    f.prices = [];
    expect(evaluateCapturePolicy(f).reasons).toContain(
      "capture_history_incomplete",
    );
    f.receivedAt = at(0);
    expect(evaluateCapturePolicy(f).reasons).toContain(
      "capture_history_incomplete",
    );
  });
  it("preserves assignment uncertainty and exact offline expiry", () => {
    const f = fixture();
    f.assignment.effectiveUntil = at(2);
    expect(evaluateCapturePolicy(f).reasons).toContain(
      "capture_authorization_unresolved",
    );
    f.assignment.effectiveUntil = null;
    f.offlineExpiresAt = at(2);
    expect(evaluateCapturePolicy(f).reasons).toContain(
      "capture_authorization_unresolved",
    );
  });
  it("returns every independent varying answer", () => {
    const f = fixture();
    f.assignment.effectiveUntil = at(2);
    f.prices.push({
      effectiveFrom: at(2),
      rateKobo: "110000",
      currency: "NGN",
    });
    f.settings = [
      {
        effectiveFrom: at(0),
        campaignId: "campaign",
        purchaseStart: at(2),
        purchaseCutoff: at(5),
        uploadDeadline: at(6),
      },
    ];
    expect(evaluateCapturePolicy(f).reasons).toEqual([
      "capture_authorization_unresolved",
      "price_uncertain",
      "capture_time_unresolved",
    ]);
  });
  it("constant outside-campaign interval is ineligible without a time hold", () => {
    const f = fixture();
    f.settings = [
      {
        effectiveFrom: at(0),
        campaignId: "campaign",
        purchaseStart: at(3),
        purchaseCutoff: at(5),
        uploadDeadline: at(6),
      },
    ];
    expect(evaluateCapturePolicy(f)).toEqual({
      reasons: [],
      campaignEligible: false,
    });
  });
  it("campaign eligibility uses whole capture interval and trusted receipt deadline", () => {
    const f = fixture();
    f.settings = [
      {
        effectiveFrom: at(0),
        campaignId: "campaign",
        purchaseStart: at(1),
        purchaseCutoff: at(2),
        uploadDeadline: at(2),
      },
    ];
    expect(evaluateCapturePolicy(f)).toEqual({
      reasons: [],
      campaignEligible: true,
    });
    f.settings[0]!.uploadDeadline = at(1);
    expect(evaluateCapturePolicy(f).campaignEligible).toBe(false);
  });
});
