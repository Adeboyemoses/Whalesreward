import { AuthError } from "../modules/auth/errors";
/** Proposed D08 mobile policy, isolated so client approval never silently widens identity matching. */
export interface PhoneNormalizer {
  normalize(input: string): string;
}
export function createPhoneNormalizer(options: {
  production: boolean;
  policy?: string;
}): PhoneNormalizer {
  return {
    normalize(input) {
      if (options.production && options.policy !== "ng-mobile-v1")
        throw new AuthError("phone_policy_unconfigured", 503);
      if (options.policy && options.policy !== "ng-mobile-v1")
        throw new AuthError("phone_policy_unconfigured", 503);
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
  return createPhoneNormalizer({
    production:
      process.env.WHR_ENV === "production" ||
      (!process.env.WHR_ENV && process.env.NODE_ENV === "production"),
    policy: process.env.WHR_PHONE_POLICY,
  });
}
