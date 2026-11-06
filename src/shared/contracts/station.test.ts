import { describe, it, expect } from "vitest";
import { newId } from "../../server/lib/ids";
import {
  createPumpSchema,
  createAttendantSchema,
  assignAttendantSchema,
  activatePriceSchema,
} from "./station";
describe("M2 station inputs", () => {
  it("normalizes names and usernames before receipt comparison", () => {
    expect(
      createPumpSchema.parse({
        operationId: newId(),
        name: "  Pump A  ",
        productCode: "pms",
      }).name,
    ).toBe("Pump A");
    expect(
      createAttendantSchema.parse({
        operationId: newId(),
        name: " Grace ",
        username: "  GRACE.OKON ",
        password: "a".repeat(12),
        pumpId: newId(),
        expectedPumpVersion: 1,
      }).username,
    ).toBe("grace.okon");
  });
  it("rejects scheduling, actor fields and float prices before domain mutation", () => {
    const input = {
      operationId: newId(),
      expectedVersion: 1,
      rateKobo: "100000",
      currency: "NGN",
      quantityPrecision: 3,
      reason: "Meter setting",
    };
    expect(
      activatePriceSchema.safeParse({
        ...input,
        effectiveFrom: new Date().toISOString(),
      }).success,
    ).toBe(false);
    expect(
      activatePriceSchema.safeParse({ ...input, rateKobo: 100000 }).success,
    ).toBe(false);
    expect(
      createPumpSchema.safeParse({
        operationId: newId(),
        name: "Pump",
        productCode: "pms",
        actorId: newId(),
      }).success,
    ).toBe(false);
  });
  it("requires reviewed assignment and pump versions", () => {
    expect(
      assignAttendantSchema.safeParse({
        operationId: newId(),
        pumpId: newId(),
        reason: "Move",
      }).success,
    ).toBe(false);
  });
});
