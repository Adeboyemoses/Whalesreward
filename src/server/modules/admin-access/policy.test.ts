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

import { auditText } from "./privacy";
import { accessEmail } from "./templates";
it("I-12/I-41 audit text excludes pasted addresses, links and bearer values", () => {
  const token = "a".repeat(64);
  const result = auditText(
    `Contact ada@example.com token=${token} https://example.test/#token=${token}`,
  );
  expect(result).not.toContain("ada@example.com");
  expect(result).not.toContain(token);
  expect(result).not.toContain("https://");
});
it("M01/M02 emails use inline tables, matching text, configured lifetime and explicit confirmation", () => {
  const verify = accessEmail({
    purpose: "verify_email",
    email: "ada@example.com",
    origin: "https://station.example.test",
    token: "fictional",
  });
  expect(verify.html).toContain("<table");
  expect(verify.html).not.toContain("<script");
  expect(verify.html).not.toContain("var(--");
  expect(verify.text).toContain("24 hours");
  expect(verify.text).toContain("until you confirm");
  const reset = accessEmail({
    purpose: "reset_password",
    email: "ada@example.com",
    origin: "https://station.example.test",
    token: "fictional",
  });
  expect(reset.text).toContain("30 minutes");
  expect(reset.text).toContain("every other session");
  expect(reset.html).toContain("30 minutes");
});

it.each([false, true])(
  "WHR-100 unconfigured auth/delegation is actionable 409: %s",
  (delegation) => {
    try {
      requirePolicy({ secret: "", origin: "", production: true }, delegation);
      expect.fail("must remain fail closed");
    } catch (error) {
      expect(error).toMatchObject({
        code: delegation
          ? "delegation_policy_unconfigured"
          : "auth_policy_unconfigured",
        status: 409,
      });
    }
  },
);
