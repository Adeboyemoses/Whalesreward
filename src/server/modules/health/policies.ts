import { adminSessionConfig, requirePolicy } from "../admin-access/config";
import { emailConfig, mailpitOrigin } from "../../adapters/email-config";
import { phonePolicy, requirePhonePolicy } from "../../adapters/phone";
import { cardPrintLayout } from "../cards/config";

export const policyNames = [
  "auth",
  "delivery",
  "delegation",
  "phone",
  "meter",
  "phoneVerification",
  "recovery",
  "reconciliation",
  "timing",
  "cardPrint",
] as const;
export type PolicyName = (typeof policyNames)[number];
export type PolicyStatus = "configured" | "unconfigured";
export type HealthPolicies = Record<PolicyName, PolicyStatus>;
export type Configuration = Readonly<Record<string, string | undefined>>;
export type PolicyEvaluators = Partial<
  Record<PolicyName, (env: Configuration) => boolean>
>;
/** Health must not interpret a deployment typo as permission to use local defaults. */
export function healthEnvironmentValid(env: Configuration): boolean {
  return (
    (env.WHR_ENV === undefined ||
      ["local", "test", "staging", "production"].includes(env.WHR_ENV)) &&
    (env.NODE_ENV === undefined ||
      ["development", "test", "production"].includes(env.NODE_ENV))
  );
}
const evaluators: PolicyEvaluators = {
  auth: (env) => {
    requirePolicy(adminSessionConfig(env));
    return true;
  },
  delivery: (env) => {
    const email = emailConfig(env);
    if (email.adapter === "mailpit") mailpitOrigin(email.mailpitUrl);
    return email.adapter !== "noop";
  },
  delegation: (env) => {
    requirePolicy(
      {
        production:
          env.WHR_ENV === "production" ||
          (!env.WHR_ENV && env.NODE_ENV === "production"),
      },
      true,
    );
    return true;
  },
  phone: (env) => {
    requirePhonePolicy(phonePolicy(env));
    return true;
  },
  cardPrint: (env) => !!cardPrintLayout(env),
  // M3/M4 evaluators do not exist yet. Absence is deliberately unconfigured.
};

/** Synchronous, read-only validation. Only this allowlist and enum can be serialized. */
export function policyConfiguration(
  env: Configuration,
  checks: PolicyEvaluators = evaluators,
) {
  const validEnvironment = healthEnvironmentValid(env);
  const policies = {} as HealthPolicies;
  for (const name of policyNames) {
    try {
      policies[name] =
        validEnvironment && checks[name]?.(env) === true
          ? "configured"
          : "unconfigured";
    } catch {
      policies[name] = "unconfigured";
    }
  }
  return {
    policies,
    fullyConfigured: policyNames.every(
      (name) => policies[name] === "configured",
    ),
  };
}
