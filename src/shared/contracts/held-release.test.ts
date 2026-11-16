import { describe, expect, it } from "vitest";
import {
  releaseProposalInputSchema,
  releaseTargetSchema,
  releaseDecisionInputSchema,
  releaseSheetReservationSchema,
} from "./held-release";
const id = "019a5000-0000-7000-8000-000000000001";
const other = "019a5000-0000-7000-8000-000000000002";
const proposal = {
  expectedVersion: 1,
  expectedRevisionId: null,
  operationId: id,
  target: { kind: "price", holdId: id, expectedHoldVersion: 1 },
  outcome: "confirm",
  sheetAssetId: other,
  meterAssetId: id,
  reason: "Matching entry inspected",
  facts: {
    source: "shift_sheet",
    entryReference: "Shift A entry 7",
    stationId: id,
    accountId: id,
    pumpId: id,
    product: "pms",
    customerId: id,
    cardId: id,
    recordedAmountKobo: "100000",
    recordedQuantity: null,
    recordedRateKobo: "100000",
    observedCapture: {
      from: "2026-11-15T09:00:00.000Z",
      through: "2026-11-15T09:01:00.000Z",
      timezone: "Africa/Lagos",
    },
    finding: "sale_recorded",
  },
};
describe("held release strict request boundary", () => {
  it("SR-01 rejects caller supplied source subsets and decision authority", () => {
    expect(releaseProposalInputSchema.safeParse(proposal).success).toBe(true);
    for (const extra of [
      { referenceIds: [id] },
      { approved: true },
      { personId: id },
      { policy: "review-evidence-v2" },
    ])
      expect(
        releaseProposalInputSchema.safeParse({ ...proposal, ...extra }).success,
      ).toBe(false);
  });
  it("SR-02 rejects reversed attested ranges and unknown facts", () => {
    expect(
      releaseProposalInputSchema.safeParse({
        ...proposal,
        facts: {
          ...proposal.facts,
          observedCapture: {
            ...proposal.facts.observedCapture,
            through: "2026-11-15T08:00:00.000Z",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      releaseProposalInputSchema.safeParse({
        ...proposal,
        facts: { ...proposal.facts, trustedCapture: true },
      }).success,
    ).toBe(false);
  });
  it("SR-02 requires a nonempty sorted unique capture target with unique codes", () => {
    const block = { id, version: 1, code: "capture_time_unresolved" };
    for (const blocks of [
      [],
      [block, block],
      [{ ...block, id: other }, block],
      [block, { ...block, id: other }],
    ])
      expect(
        releaseTargetSchema.safeParse({ kind: "capture", blocks }).success,
      ).toBe(false);
    expect(
      releaseTargetSchema.safeParse({
        kind: "capture",
        blocks: [
          block,
          { id: other, version: 1, code: "capture_authorization_unresolved" },
        ],
      }).success,
    ).toBe(true);
  });
  it("SR-04 rejects URLs and contact data in entry references", () => {
    for (const entryReference of [
      "https://example.com/sheet",
      "staff@example.com",
      "+234 800 000 0000",
      "entry\nsecret",
    ])
      expect(
        releaseProposalInputSchema.safeParse({
          ...proposal,
          facts: { ...proposal.facts, entryReference },
        }).success,
      ).toBe(false);
  });
  it("SR-04 bounds sheet reservations to one JPEG and the meter byte limit", () => {
    const reservation = {
      operationId: id,
      target: proposal.target,
      sha256: "a".repeat(64),
      bytes: 8388608,
      contentType: "image/jpeg",
    };
    expect(releaseSheetReservationSchema.safeParse(reservation).success).toBe(
      true,
    );
    for (const patch of [
      { bytes: 8388609 },
      { bytes: 0 },
      { contentType: "image/png" },
      { sha256: "g".repeat(64) },
      { purpose: "meter" },
    ])
      expect(
        releaseSheetReservationSchema.safeParse({ ...reservation, ...patch })
          .success,
      ).toBe(false);
  });
  it("SR-05 decision cannot replace frozen facts, target or proposed outcome", () => {
    const decision = {
      operationId: id,
      expectedVersion: 2,
      expectedRevisionId: null,
      expectedProposalVersion: 1,
      outcome: "approve",
      reason: "Independently inspected",
    };
    expect(releaseDecisionInputSchema.safeParse(decision).success).toBe(true);
    for (const patch of [
      { facts: proposal.facts },
      { target: proposal.target },
      { outcome: "cancel" },
      { expectedProposalVersion: 0 },
    ])
      expect(
        releaseDecisionInputSchema.safeParse({ ...decision, ...patch }).success,
      ).toBe(false);
  });
});
