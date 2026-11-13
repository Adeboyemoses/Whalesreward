import { AuthError } from "../auth/errors";
/** WHR-55 has not approved provisioning, boundaries or a change window. */
export function timingPolicyConfigured(): boolean {
  return false;
}
export function requireTimingPolicy(): never {
  throw new AuthError("timing_policy_unconfigured", 409);
}
