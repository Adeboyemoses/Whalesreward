import { describe, it, expect } from "vitest";
import { createPhoneNormalizer } from "./phone";
describe("D08 phone normalization", () => {
  it("canonicalizes presentation variants before uniqueness without dropping arbitrary digits", () => {
    const p = createPhoneNormalizer({ production: false });
    expect(p.normalize("0800 000-0000")).toBe("+2348000000000");
    expect(p.normalize("+234 (800) 000-0000")).toBe("+2348000000000");
    for (const bad of [
      "2348000000000",
      "008000000000",
      "0800000000",
      "080000000000",
      "08000000000x1",
      "+18000000000",
      "08000000000\n",
    ])
      expect(() => p.normalize(bad)).toThrow();
  });
  it("fails closed in production until the explicit numbering policy is configured", () => {
    expect(() =>
      createPhoneNormalizer({ production: true }).normalize("08000000000"),
    ).toThrowError(
      expect.objectContaining({
        code: "phone_policy_unconfigured",
        status: 409,
      }),
    );
    expect(
      createPhoneNormalizer({
        production: true,
        policy: "ng-mobile-v1",
      }).normalize("08000000000"),
    ).toBe("+2348000000000");
  });
});
