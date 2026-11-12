import { afterEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  phoneCodeMatches,
  phoneCodeVerifier,
  requirePhoneVerification,
  type PhoneVerificationAdapter,
} from "./phone-verification";
const adapter: PhoneVerificationAdapter = {
  kind: "TEST",
  policy: { lifetimeMs: 1000, resendMs: 100, maxAttempts: 3 },
  async request() {
    return { outcome: "unavailable" };
  },
  async verify() {
    return "unavailable";
  },
};
afterEach(() => vi.unstubAllEnvs());
it("cannot enable phone verification by supplying a test adapter in staging/production", () => {
  for (const env of ["staging", "production"]) {
    vi.stubEnv("WHR_ENV", env);
    expect(() => requirePhoneVerification(adapter)).toThrowError(
      "phone_verification_unconfigured",
    );
  }
  vi.stubEnv("WHR_ENV", "local");
  vi.stubEnv("NODE_ENV", "production");
  expect(() => requirePhoneVerification(adapter)).toThrowError(
    "phone_verification_unconfigured",
  );
});
it("requires test injection and positive bounded integral policy values", () => {
  vi.stubEnv("WHR_ENV", "local");
  expect(() => requirePhoneVerification()).toThrowError(
    "phone_verification_unconfigured",
  );
  expect(requirePhoneVerification(adapter)).toBe(adapter);
  for (const invalid of [0, -1, NaN, Infinity, 1.5])
    expect(() =>
      requirePhoneVerification({
        ...adapter,
        policy: { ...adapter.policy, maxAttempts: invalid },
      }),
    ).toThrowError("phone_verification_unconfigured");
});
it("keyed code verifier binds the challenge and compares without plaintext persistence", () => {
  const key = randomBytes(32).toString("hex"),
    code = randomBytes(16).toString("hex"),
    challenge = randomBytes(16).toString("hex"),
    verifier = phoneCodeVerifier(key, challenge, code);
  expect(phoneCodeMatches(key, challenge, code, verifier)).toBe(true);
  expect(
    phoneCodeMatches(key, randomBytes(16).toString("hex"), code, verifier),
  ).toBe(false);
  expect(
    phoneCodeMatches(
      randomBytes(32).toString("hex"),
      challenge,
      code,
      verifier,
    ),
  ).toBe(false);
  expect(phoneCodeMatches(key, challenge, code, "")).toBe(false);
});
