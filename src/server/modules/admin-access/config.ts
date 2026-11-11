import { emailConfig, type EmailOptions } from "../../adapters/email-config";
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
  delivery?: EmailOptions["adapter"];
  email?: EmailOptions;
  mailpitUrl?: string;
  receiptKeys?: Record<string, string>;
  receiptKeyVersion?: string;
};
export function adminSessionConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdminConfig {
  const raw = env.WHR_ADMIN_RECEIPT_KEYS;
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
  const receiptKeyVersion = env.WHR_ADMIN_RECEIPT_KEY_VERSION ?? "v1";
  if (receiptKeys && !receiptKeys[receiptKeyVersion])
    throw new Error("Current receipt key unavailable");
  return {
    ...authConfig(env),
    receiptKeys,
    receiptKeyVersion,
    production:
      env.WHR_ENV === "production" ||
      (!env.WHR_ENV && env.NODE_ENV === "production"),
  };
}
export function adminConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdminConfig {
  const email = emailConfig(env);
  return {
    ...adminSessionConfig(env),
    delivery: email.adapter,
    email,
    mailpitUrl: env.MAILPIT_URL ?? "http://127.0.0.1:8025",
  };
}
export function requirePolicy(
  config: Pick<AdminConfig, "production"> & Partial<AdminConfig>,
  delegation = false,
) {
  if (config.production)
    throw new AuthError(
      delegation
        ? "delegation_policy_unconfigured"
        : "auth_policy_unconfigured",
      409,
    );
}
