import { describe, it, expect } from "vitest";
import {
  permissionCodes,
  dependencies,
  sensitiveDefaults,
  createUserSchema,
} from "../../../shared/contracts/admin";
import { ADMIN_POLICY, requirePolicy } from "./config";
describe("M2 access policy", () => {
  it("I-07/I-11 catalogue has exactly 28 independent actions and proposed presets exclude all six sensitive defaults", () => {
    expect(permissionCodes).toHaveLength(28);
    expect(new Set(permissionCodes).size).toBe(28);
    expect(ADMIN_POLICY.operations).toHaveLength(17);
    expect(ADMIN_POLICY.readOnly).toHaveLength(7);
    for (const p of sensitiveDefaults) {
      expect(ADMIN_POLICY.operations).not.toContain(p);
      expect(ADMIN_POLICY.readOnly).not.toContain(p);
      expect(dependencies[p]).toBeDefined();
    }
  });
  it("production authentication and delegation fail closed without approved policy", () => {
    expect(() =>
      requirePolicy({ secret: "", origin: "", production: true }),
    ).toThrow();
    expect(ADMIN_POLICY.autoProvisionPresets).toBe(false);
  });
  it("I-12 ordinary account creation cannot mark an email verified", () => {
    expect(createUserSchema.safeParse({ emailVerified: true }).success).toBe(
      false,
    );
  });
});
