import { createHmac, timingSafeEqual } from "node:crypto";
if (typeof window !== "undefined") throw new Error("Server-only adapter");
export function phoneCodeVerifier(
  key: string,
  challengeId: string,
  code: string,
) {
  return createHmac("sha256", key)
    .update(JSON.stringify(["phone-code-v1", challengeId, code]))
    .digest("hex");
}
export function phoneCodeMatches(
  key: string,
  challengeId: string,
  code: string,
  verifier: string,
) {
  const expected = Buffer.from(
      phoneCodeVerifier(key, challengeId, code),
      "hex",
    ),
    actual = Buffer.from(verifier, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
import { AuthError } from "../modules/auth/errors";
/** WHR-49 is unresolved. Only tests may inject an implementation. No runtime
 * provider, console code, environment toggle or sample secret enables delivery. */
export interface PhoneVerificationAdapter {
  readonly kind: "TEST";
  readonly policy: {
    lifetimeMs: number;
    resendMs: number;
    maxAttempts: number;
  };
  request(
    customerId: string,
    purpose: "replace_card",
    generation: string,
  ): Promise<
    | { outcome: "sent"; verifier: string; keyVersion: string }
    | { outcome: "unavailable" }
  >;
  verify(
    challengeId: string,
    code: string,
  ): Promise<"verified" | "unavailable">;
}
export function requirePhoneVerification(
  adapter?: PhoneVerificationAdapter,
): PhoneVerificationAdapter {
  if (
    process.env.NODE_ENV !== "test" ||
    ["staging", "production"].includes(process.env.WHR_ENV ?? "") ||
    !adapter ||
    adapter.kind !== "TEST"
  )
    throw new AuthError("phone_verification_unconfigured", 409);
  const { lifetimeMs, resendMs, maxAttempts } = adapter.policy;
  if (
    ![lifetimeMs, resendMs, maxAttempts].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    )
  )
    throw new AuthError("phone_verification_unconfigured", 409);
  return adapter;
}
