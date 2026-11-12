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
  it("allows descriptions of verification without secret values", () => {
    for (const text of [
      "Customer cannot receive OTP",
      "Passport inspected in person",
      "Customer cannot access the registered phone",
      "The password was forgotten",
      "OTP is unavailable",
      "Passport is lost",
    ])
      expect(recoveryText.safeParse(text).success).toBe(true);
  });
  it("rejects sensitive narratives", () => {
    for (const value of [
      "Call +2348012345678",
      "passport number A1234567",
      "password: " + randomBytes(20).toString("hex"),
      "https://example.com",
      "OTP: confidential-value",
      "OTP is " + randomBytes(12).toString("hex"),
      "Passport is A1234567",
      "OTP is confidential-value",
      "OTP: unavailable",
      "Passport number = A1234567",
    ])
      expect(recoveryText.safeParse(value).success).toBe(false);
  });
});
