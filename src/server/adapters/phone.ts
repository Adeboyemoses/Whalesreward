import { AuthError } from "../modules/auth/errors";
/** Proposed D08 mobile policy, isolated so client approval never silently widens identity matching. */
export interface PhoneNormalizer {
  normalize(input: string): string;
}
type PhonePolicy = { production: boolean; policy?: string };
export function requirePhonePolicy(options: PhonePolicy) {
  if (
    (options.production && options.policy !== "ng-mobile-v1") ||
    (options.policy && options.policy !== "ng-mobile-v1")
  )
    throw new AuthError("phone_policy_unconfigured", 409);
}
export function phonePolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PhonePolicy {
  return {
    production:
      env.WHR_ENV === "production" ||
      (!env.WHR_ENV && env.NODE_ENV === "production"),
    policy: env.WHR_PHONE_POLICY,
  };
}
export function createPhoneNormalizer(options: PhonePolicy): PhoneNormalizer {
  return {
    normalize(input) {
      requirePhonePolicy(options);
      if (input.length > 32 || !input || /[^+0-9 ()-]/.test(input))
        throw new AuthError("phone_invalid", 422);
      const value = input.replace(/[ ()-]/g, "");
      if (/^0[789][01][0-9]{8}$/.test(value)) return `+234${value.slice(1)}`;
      if (/^\+234[789][01][0-9]{8}$/.test(value)) return value;
      throw new AuthError("phone_invalid", 422);
    },
  };
}
export function phoneNormalizer() {
  return createPhoneNormalizer(phonePolicy());
}
