import { describe, expect, it } from "vitest";
import {
  correctionSubmissionSchema,
  saleValuesSchema,
  attendantCorrectionSchema,
  saleDateSchema,
} from "./sales";
const id = "0199a000-0000-7000-8000-000000000001";
const values = {
  amountKobo: "9007199254740993",
  quantity: "9007199254.740993",
  currency: "NGN",
  unit: "litre",
  basis: "amount",
  enteredAmountKobo: "9007199254740993",
  enteredQuantity: null,
  rateKobo: "1000000",
  priceVersionId: id,
  quantityPrecision: 6,
  medium: "vehicle",
  calculation: "captured_rate",
  verifiedSaleDate: null,
};
describe("M3 strict sale contracts", () => {
  it("preserves exact amounts above JS safe integer and rejects an inexact counterpart", () => {
    expect(saleValuesSchema.parse(values).amountKobo).toBe(values.amountKobo);
    expect(
      saleValuesSchema.safeParse({ ...values, quantity: "9007199254.740992" })
        .success,
    ).toBe(false);
  });
  it("allows independently verified meter values while preserving original basis facts", () => {
    expect(
      saleValuesSchema.safeParse({
        ...values,
        quantity: "1",
        calculation: "meter_evidence",
      }).success,
    ).toBe(true);
    expect(
      saleValuesSchema.safeParse({ ...values, enteredQuantity: "1" }).success,
    ).toBe(false);
  });
  it("accepts only the selected numeric input and rejects immutable fact edits", () => {
    const request = {
      operationId: id,
      expectedVersion: 1,
      basedOnRevisionId: id,
      edit: { basis: "amount", enteredAmountKobo: "200" },
      evidenceAssetId: id,
      reason: "Correct entered amount",
    };
    expect(correctionSubmissionSchema.safeParse(request).success).toBe(true);
    expect(
      correctionSubmissionSchema.safeParse({ ...request, pumpId: id }).success,
    ).toBe(false);
    expect(
      correctionSubmissionSchema.safeParse({
        ...request,
        edit: { ...request.edit, enteredQuantity: "1" },
      }).success,
    ).toBe(false);
  });
  it("rejects admin and recovery narrative fields in attendant projections", () => {
    const item = {
      id,
      purchaseId: id,
      operationId: id,
      version: 1,
      basedOnRevisionId: id,
      proposed: values,
      reason: "Own reason",
      serverReceivedAt: "2026-11-09T01:00:00Z",
      cutoffAtReceipt: null,
      timing: "unresolved",
      state: "awaiting_review",
      decidedAt: null,
      authorship: "authenticated_attendant",
      policyBlocks: [],
    };
    expect(attendantCorrectionSchema.safeParse(item).success).toBe(true);
    expect(
      attendantCorrectionSchema.safeParse({
        ...item,
        decisionReason: "Private admin reason",
      }).success,
    ).toBe(false);
  });
  it("rejects impossible calendar dates", () => {
    expect(saleDateSchema.safeParse("2026-02-30").success).toBe(false);
  });
});
