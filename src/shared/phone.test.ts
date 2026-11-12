import { describe, expect, it } from "vitest";
import { normalizeMobilePhone } from "./phone";
describe("shared ng-mobile-v1 phone input", () => {
  it("normalizes national and E.164 presentation consistently", () => {
    for (const input of ["0800 000-0000", "+234 (800) 000-0000"])
      expect(normalizeMobilePhone(input)).toBe("+2348000000000");
  });
  it("rejects unsupported country, truncated, extended and non-phone input", () => {
    for (const input of [
      "",
      "2348000000000",
      "008000000000",
      "0800000000",
      "080000000000",
      "08000000000x1",
      "+18000000000",
      "08000000000\n",
      " ".repeat(33),
    ])
      expect(normalizeMobilePhone(input)).toBeNull();
  });
});
