import { describe, it, expect } from "vitest";
import {
  evaluateCapturePolicy,
  type CapturePolicyInput,
} from "./capture-policy";
const at = (hours: number) =>
  (BigInt(Date.UTC(2026, 10, 5, hours)) * 1000n).toString();
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
  it("preserves assignment uncertainty but expiry alone is not revocation", () => {
    const f = fixture();
    f.assignment.effectiveUntil = at(2);
    expect(evaluateCapturePolicy(f).reasons).toContain(
      "capture_authorization_unresolved",
    );
    f.assignment.effectiveUntil = null;
    f.offlineExpiresAt = at(2);
    expect(evaluateCapturePolicy(f).reasons).toEqual([]);
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

// Every bound can carry all six PostgreSQL fractional digits. These intervals
// intentionally fit inside ONE JS millisecond and must not collapse together.
it("P-18 preserves price and authorization changes within a millisecond", () => {
  const f = fixture();
  f.signedInAt = "1793836800123000";
  f.receivedAt = "1793836800123900";
  f.prices = [
    { effectiveFrom: "1793836800122000", rateKobo: "100000", currency: "NGN" },
    { effectiveFrom: "1793836800123100", rateKobo: "110000", currency: "NGN" },
  ];
  f.assignment.effectiveFrom = "1793836800122000";
  f.assignment.effectiveUntil = "1793836800123800";
  expect(evaluateCapturePolicy(f).reasons).toEqual([
    "capture_authorization_unresolved",
    "price_uncertain",
  ]);
});
it("P-18 preserves sign-in, revocation, offline and campaign microsecond bounds", () => {
  const f = fixture();
  f.signedInAt = "1793836800123100";
  f.receivedAt = "1793836800123900";
  f.prices = [
    { effectiveFrom: "1793836800123000", rateKobo: "100000", currency: "NGN" },
  ];
  f.assignment.effectiveFrom = "1793836800123200";
  f.contextRevokedAt = "1793836800123800";
  f.offlineExpiresAt = "1793836800123900";
  f.settings = [
    {
      effectiveFrom: "1793836800123000",
      campaignId: "campaign",
      purchaseStart: "1793836800123500",
      purchaseCutoff: "1793836800123600",
      uploadDeadline: "1793836800123900",
    },
  ];
  expect(evaluateCapturePolicy(f).reasons).toEqual([
    "capture_authorization_unresolved",
    "capture_time_unresolved",
  ]);
  f.assignment.effectiveFrom = "1793836800123000";
  f.contextRevokedAt = null;
  f.offlineExpiresAt = "1793836800123901";
  f.settings[0]!.purchaseStart = "1793836800123100";
  f.settings[0]!.purchaseCutoff = "1793836800123900";
  expect(evaluateCapturePolicy(f)).toEqual({
    reasons: [],
    campaignEligible: true,
  });
  f.settings[0]!.uploadDeadline = "1793836800123899";
  expect(evaluateCapturePolicy(f).campaignEligible).toBe(false);
});

describe("P-20 capped capture interval", () => {
  const capped = () => ({ ...fixture(), receivedAt: at(27) });
  it("accepts receipt after the original 24-hour expiry", () => {
    expect(evaluateCapturePolicy(capped()).reasons).toEqual([]);
  });
  it.each([-1n, 0n, 1n])(
    "compares price, assignment, revocation and settings at U %+s microseconds",
    (offset) => {
      const boundary = (BigInt(at(25)) + offset).toString();
      const reason = offset <= 0n;
      const price = capped();
      price.prices.push({
        effectiveFrom: boundary,
        rateKobo: "110000",
        currency: "NGN",
      });
      expect(evaluateCapturePolicy(price).reasons).toEqual(
        reason ? ["price_uncertain"] : [],
      );
      const assignment = capped();
      assignment.assignment = {
        ...assignment.assignment,
        effectiveUntil: boundary,
      };
      expect(evaluateCapturePolicy(assignment).reasons).toEqual(
        reason ? ["capture_authorization_unresolved"] : [],
      );
      const revoked = { ...capped(), contextRevokedAt: boundary };
      expect(evaluateCapturePolicy(revoked).reasons).toEqual(
        reason ? ["capture_authorization_unresolved"] : [],
      );
      const settings = capped();
      settings.settings = [
        {
          effectiveFrom: at(0),
          campaignId: "campaign",
          purchaseStart: at(0),
          purchaseCutoff: at(30),
          uploadDeadline: at(32),
        },
        {
          effectiveFrom: boundary,
          campaignId: "campaign",
          purchaseStart: at(0),
          purchaseCutoff: at(31),
          uploadDeadline: at(32),
        },
      ];
      expect(evaluateCapturePolicy(settings).reasons).toEqual(
        reason ? ["capture_time_unresolved"] : [],
      );
    },
  );
  it.each([-1n, 0n, 1n])(
    "uses U for inclusive campaign cutoff and R for upload deadline %+s microseconds",
    (offset) => {
      const f = capped();
      f.settings = [
        {
          effectiveFrom: at(0),
          campaignId: "campaign",
          purchaseStart: at(0),
          purchaseCutoff: (BigInt(at(25)) + offset).toString(),
          uploadDeadline: at(27),
        },
      ];
      expect(evaluateCapturePolicy(f)).toEqual({
        reasons: offset < 0n ? ["capture_time_unresolved"] : [],
        campaignEligible: offset >= 0n,
      });
      f.settings[0]!.uploadDeadline = (BigInt(at(27)) - 1n).toString();
      expect(evaluateCapturePolicy(f).campaignEligible).toBe(false);
    },
  );
  it.each([-1n, 0n, 1n])(
    "uses U for campaign start %+s microseconds",
    (offset) => {
      const f = capped();
      f.settings = [
        {
          effectiveFrom: at(0),
          campaignId: "campaign",
          purchaseStart: (BigInt(at(25)) + offset).toString(),
          purchaseCutoff: at(30),
          uploadDeadline: at(32),
        },
      ];
      expect(evaluateCapturePolicy(f)).toEqual({
        reasons: offset <= 0n ? ["capture_time_unresolved"] : [],
        campaignEligible: false,
      });
    },
  );
  it("fails closed when original expiry precedes sign-in even if receipt follows it", () => {
    const f = capped();
    f.offlineExpiresAt = at(0);
    expect(evaluateCapturePolicy(f)).toEqual({
      reasons: ["capture_history_incomplete"],
      campaignEligible: false,
    });
  });
  it("missing price or campaign anchor cannot establish eligibility", () => {
    const f = capped();
    f.settings = [
      {
        effectiveFrom: at(0),
        campaignId: "campaign",
        purchaseStart: at(0),
        purchaseCutoff: at(30),
        uploadDeadline: at(32),
      },
    ];
    f.prices = [];
    expect(evaluateCapturePolicy(f)).toEqual({
      reasons: ["capture_history_incomplete"],
      campaignEligible: false,
    });
    f.prices = fixture().prices;
    f.settings[0]!.effectiveFrom = at(2);
    expect(evaluateCapturePolicy(f)).toEqual({
      reasons: ["capture_history_incomplete"],
      campaignEligible: false,
    });
  });
});

describe("P-23 shared lower bound", () => {
  it("uses L for price, assignment, campaign and card while retaining original receipt", () => {
    const f = fixture();
    f.lowerBound = at(2);
    f.receivedAt = at(3);
    f.prices = [
      { effectiveFrom: at(0), rateKobo: "90000", currency: "NGN" },
      { effectiveFrom: at(2), rateKobo: "100000", currency: "NGN" },
    ];
    f.assignment.effectiveFrom = at(2);
    f.cardLink = { linkedAt: at(2), endedAt: null, customerMatches: true };
    f.settings = [
      {
        effectiveFrom: at(2),
        campaignId: "campaign",
        purchaseStart: at(2),
        purchaseCutoff: at(4),
        uploadDeadline: at(5),
      },
    ];
    expect(evaluateCapturePolicy(f)).toEqual({
      reasons: [],
      campaignEligible: true,
    });
    f.lowerBound = at(1);
    expect(evaluateCapturePolicy(f).reasons).toEqual(
      expect.arrayContaining([
        "card_policy_unresolved",
        "capture_authorization_unresolved",
        "price_uncertain",
        "capture_history_incomplete",
      ]),
    );
  });
  it("includes both exact bounds and rejects invalid lower bounds", () => {
    const f = fixture();
    f.lowerBound = f.receivedAt;
    f.cardLink = {
      linkedAt: f.lowerBound,
      endedAt: null,
      customerMatches: true,
    };
    expect(evaluateCapturePolicy(f).reasons).toEqual([]);
    f.cardLink.endedAt = f.receivedAt;
    expect(evaluateCapturePolicy(f).reasons).toContain(
      "card_policy_unresolved",
    );
    f.lowerBound = (BigInt(f.receivedAt) + 1n).toString();
    expect(evaluateCapturePolicy(f).reasons).toEqual([
      "capture_history_incomplete",
    ]);
    f.lowerBound = (BigInt(f.signedInAt) - 1n).toString();
    expect(evaluateCapturePolicy(f).reasons).toEqual([
      "capture_history_incomplete",
    ]);
  });
  it("checks card ending after capped U through first R and preserves independent failures", () => {
    const f = fixture();
    f.lowerBound = at(2);
    f.offlineExpiresAt = at(3);
    f.receivedAt = at(4);
    f.cardLink = { linkedAt: at(2), endedAt: at(4), customerMatches: true };
    f.contextRevokedAt = at(3);
    f.prices.push({
      effectiveFrom: at(3),
      rateKobo: "110000",
      currency: "NGN",
    });
    expect(evaluateCapturePolicy(f).reasons).toEqual(
      expect.arrayContaining([
        "card_policy_unresolved",
        "capture_authorization_unresolved",
        "price_uncertain",
      ]),
    );
  });
});
