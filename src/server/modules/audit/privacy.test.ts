import { expect, it } from "vitest";
import {
  safeAuditText,
  redactAuditText,
} from "../../../shared/contracts/audit-privacy";
it("retains bounded password lifecycle context without exempting supplied credentials or trailing values", () => {
  const valid = [
    "Departure after password completion",
    "Disable before password change",
    "Resume following password reset",
    "Before password reset, disable the account",
    "Departure after password completion.",
    "Review following password change; retain the record",
  ];
  for (const reason of valid) {
    expect(safeAuditText(reason), reason).toBe(true);
    expect(redactAuditText(reason)).toBe(reason);
  }
  for (const relation of ["before", "after", "following"])
    for (const lifecycle of ["completion", "change", "reset"]) {
      const reason = `Review ${relation} password ${lifecycle}`;
      expect(safeAuditText(reason), reason).toBe(true);
    }
  const privateText = [
    "Password fictional-passphrase",
    "Password: fictional-passphrase",
    "after password fictional-passphrase",
    "Departure after password completion fictional-passphrase",
    "Before password reset-canary",
    "Following password completion: fictional-passphrase",
    "Departure after password completion; password fictional-passphrase",
    "Review following password change; token fictional-bearer",
    "Departure after password completion; 0803.555.0199",
    "Departure after password completion; ••••0199",
    "Password reset fictional-passphrase",
  ];
  for (const reason of privateText) {
    expect(safeAuditText(reason), reason).toBe(false);
    expect(redactAuditText(reason)).not.toBe(reason);
  }
});
