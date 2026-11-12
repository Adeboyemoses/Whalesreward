import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { newId } from "../../server/lib/ids";
import {
  phoneChangeSchema,
  managerCaseSchema,
  issueCardVerificationSchema,
  recoveryText,
} from "./customer-recovery";
describe("customer recovery boundaries", () => {
  it("requires explicit physical card attestation and exact card guard", () => {
    const body = {
      operationId: newId(),
      expectedVersion: 1,
      newPhone: "08012345678",
      activeCardCode: "ABCDEFG",
      expectedCardVersion: 1,
      cardInspectedInPerson: true,
      reason: "Customer presented their card",
    };
    expect(phoneChangeSchema.safeParse(body).success).toBe(true);
    expect(
      phoneChangeSchema.safeParse({ ...body, cardInspectedInPerson: false })
        .success,
    ).toBe(false);
    expect(
      phoneChangeSchema.safeParse({ ...body, expectedCardVersion: undefined })
        .success,
    ).toBe(false);
  });
  it("cannot choose a delivery destination or claim manager authority", () => {
    expect(
      issueCardVerificationSchema.safeParse({
        operationId: newId(),
        expectedVersion: 1,
        newPhone: "08012345678",
      }).success,
    ).toBe(false);
    expect(
      managerCaseSchema.safeParse({
        operationId: newId(),
        expectedVersion: 1,
        customerPresent: true,
        reason: "Customer requested assistance",
        verificationNotes: "Checked the card history",
        approved: true,
      }).success,
    ).toBe(false);
  });
  it("rejects sensitive narratives", () => {
    for (const value of [
      "Call +2348012345678",
      "passport number supplied",
      "password: " + randomBytes(20).toString("hex"),
      "https://example.com",
      "OTP supplied",
    ])
      expect(recoveryText.safeParse(value).success).toBe(false);
  });
});
