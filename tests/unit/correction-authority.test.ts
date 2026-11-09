import { describe, expect, it } from "vitest";
import {
  correctionSubmissionSchema,
  numericEditSchema,
} from "../../src/shared/contracts/sales";

const id = "019a5000-0000-7000-8000-000000000101";
const body = {
  operationId: id,
  expectedVersion: 1,
  basedOnRevisionId: id,
  edit: { basis: "amount", enteredAmountKobo: "9007199254740993" },
  evidenceAssetId: id,
  reason: "Correct the entered amount",
};

describe("P-22 correction input cannot carry authority or capture changes", () => {
  it.each([
    ["automaticEligible", true],
    ["serverReceivedAt", "2026-11-09T22:59:59Z"],
    ["cutoffAtReceipt", "2026-11-10T23:00:00Z"],
    ["verifiedSaleDate", "2026-11-09"],
    ["authorship", "authenticated_attendant"],
    ["policyBlocks", []],
    ["originatingAttendantId", id],
    ["customerId", id],
    ["cardCode", "A7K3M9Q"],
    ["medium", "vehicle"],
    ["productId", id],
    ["pumpId", id],
    ["rateKobo", "1"],
    ["priceVersionId", id],
    ["quantityPrecision", 6],
    ["photo", { sha256: "a".repeat(64) }],
  ])("I-37/P-22 rejects caller-controlled %s", (field, value) => {
    expect(
      correctionSubmissionSchema.safeParse({ ...body, [field]: value }).success,
    ).toBe(false);
  });
  it("I-29 preserves amount-mode kobo above the JavaScript safe integer limit", () => {
    expect(correctionSubmissionSchema.parse(body).edit).toEqual(body.edit);
  });
  it.each([
    { basis: "amount", enteredAmountKobo: "0" },
    { basis: "amount", enteredAmountKobo: "-1" },
    { basis: "amount", enteredAmountKobo: 9007199254740992 },
    { basis: "quantity", enteredQuantity: "0.000000" },
    { basis: "quantity", enteredQuantity: "-0.001" },
    { basis: "quantity", enteredQuantity: "1.0000001" },
    { basis: "quantity", enteredQuantity: "1", enteredAmountKobo: "1" },
    { basis: "amount", enteredAmountKobo: "1", quantity: "1" },
  ])("I-29 rejects nonpositive, inexact or dual-entry edits: %j", (edit) => {
    expect(numericEditSchema.safeParse(edit).success).toBe(false);
  });
});
