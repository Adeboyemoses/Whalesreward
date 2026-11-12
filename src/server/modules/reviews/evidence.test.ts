import { describe, expect, it } from "vitest";
import type pg from "pg";
import { evaluateReviewEvidence } from "./evidence";
import {
  priceDecisionSchema,
  captureDecisionSchema,
  duplicateDecisionSchema,
} from "../../../shared/contracts/sales";
const id = "019a0000-0000-7000-8000-000000000001";
const evidence = {
  assetId: id,
  notes: "Reviewed retained evidence",
  referenceIds: [id],
};
const guard = {
  operationId: id,
  expectedVersion: 1,
  expectedRevisionId: null,
  reason: "Reviewed",
};
describe("review request boundaries", () => {
  it("rejects client proof booleans and synthetic capture holds", () => {
    expect(
      captureDecisionSchema.safeParse({
        ...guard,
        outcome: "confirm",
        evidence,
        authorized: true,
      }).success,
    ).toBe(false);
    expect(
      captureDecisionSchema.safeParse({
        ...guard,
        outcome: "confirm",
        evidence,
        expectedHoldVersion: 1,
      }).success,
    ).toBe(false);
  });
  it("keeps independent meter values exact", () => {
    const value = priceDecisionSchema.parse({
      ...guard,
      expectedHoldVersion: 1,
      evidence,
      decision: {
        outcome: "correct_meter",
        amountKobo: "9007199254740993",
        quantity: "1.230000",
      },
    });
    expect(value.decision).toEqual({
      outcome: "correct_meter",
      amountKobo: "9007199254740993",
      quantity: "1.230000",
    });
  });
  it("requires precisely two purchase guards", () => {
    expect(
      duplicateDecisionSchema.safeParse({
        operationId: id,
        expectedFlagVersion: 1,
        purchases: [],
        decision: { outcome: "keep_both" },
        reason: "Reviewed",
      }).success,
    ).toBe(false);
  });
});
describe("review evidence policy gate", () => {
  const db = {} as pg.PoolClient;
  it("fails closed when policy is absent", async () => {
    await expect(
      evaluateReviewEvidence(db, undefined, id, "capture", evidence),
    ).rejects.toMatchObject({ code: "evidence_insufficient", status: 422 });
  });
  it("refuses policy conclusions based on unsubmitted references", async () => {
    await expect(
      evaluateReviewEvidence(
        db,
        {
          evaluate: async () => ({
            policyVersion: "test",
            referenceIds: ["019a0000-0000-7000-8000-000000000002"],
          }),
        },
        id,
        "capture",
        evidence,
      ),
    ).rejects.toMatchObject({ code: "evidence_insufficient" });
  });
  it("notes alone cannot invoke an evidence policy", async () => {
    await expect(
      evaluateReviewEvidence(
        db,
        {
          evaluate: async () => {
            throw Error("must not execute");
          },
        },
        id,
        "capture",
        { ...evidence, referenceIds: [] },
      ),
    ).rejects.toMatchObject({ code: "evidence_insufficient" });
  });
});
