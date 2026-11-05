import {
  permissionCodes,
  type PermissionCode,
} from "../../../shared/contracts/admin";
import { AuthError } from "../auth/errors";
import { authConfig } from "../auth/config";
/** WHR-42/43 engineering proposals. No production activation is implied. */
export const ADMIN_POLICY = Object.freeze({
  proposed: true,
  version: "m2-proposal-1",
  verificationMs: 86400000,
  resetMs: 1800000,
  sessionMs: 28800000,
  idleMs: 1800000,
  restrictedMs: 900000,
  replayMs: 300000,
  tombstoneMs: 86400000,
  maxAttempts: 10,
  autoProvisionPresets: false,
  operations: [
    "overview",
    "sales",
    "corrections",
    "duplicates",
    "customers",
    "recovery",
    "managerRecovery",
    "leaderboards",
    "reports",
    "reportExport",
    "cards",
    "cardExport",
    "cardPrint",
    "attendants",
    "pumps",
    "prices",
    "audit",
  ] as readonly PermissionCode[],
  readOnly: [
    "overview",
    "sales",
    "customers",
    "leaderboards",
    "reports",
    "cards",
    "audit",
  ] as readonly PermissionCode[],
  delegable: permissionCodes,
});
export type AdminConfig = {
  secret: string;
  origin: string;
  trustedIpHeader?: string;
  production?: boolean;
  delivery?: "mailpit" | "noop";
  mailpitUrl?: string;
  receiptKeys?: Record<string, string>;
  receiptKeyVersion?: string;
};
export function adminConfig(): AdminConfig {
  const raw = process.env.WHR_ADMIN_RECEIPT_KEYS;
  let receiptKeys: Record<string, string> | undefined;
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Receipt key configuration unavailable");
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.entries(parsed).some(
        ([k, v]) =>
          !/^[a-zA-Z0-9_-]{1,32}$/.test(k) ||
          typeof v !== "string" ||
          v.length < 32,
      )
    )
      throw new Error("Receipt key configuration unavailable");
    receiptKeys = parsed as Record<string, string>;
  }
  const receiptKeyVersion = process.env.WHR_ADMIN_RECEIPT_KEY_VERSION ?? "v1";
  if (receiptKeys && !receiptKeys[receiptKeyVersion])
    throw new Error("Current receipt key unavailable");
  return {
    ...authConfig(),
    receiptKeys,
    receiptKeyVersion,
    production:
      process.env.WHR_ENV === "production" ||
      (!process.env.WHR_ENV && process.env.NODE_ENV === "production"),
    delivery: process.env.WHR_ENV === "staging" ? "noop" : "mailpit",
    mailpitUrl: process.env.MAILPIT_URL ?? "http://127.0.0.1:8025",
  };
}
export function requirePolicy(config: AdminConfig, delegation = false) {
  if (config.production)
    throw new AuthError(
      delegation
        ? "delegation_policy_unconfigured"
        : "auth_policy_unconfigured",
      503,
    );
}
