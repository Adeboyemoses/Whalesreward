import { z } from "zod";
import { AdminError, adminOperationId, type adminRequest } from "./admin-api";
import { CustomerAdminApi, type CustomerChange } from "./customer-admin-api";
import {
  recoveryContextSchema,
  phoneChallengeSchema,
  identityChangeSchema,
  managerCaseViewSchema,
} from "../shared/contracts/customer-recovery";
export type RecoveryContext = z.infer<typeof recoveryContextSchema>;
export type PhoneChallenge = z.infer<typeof phoneChallengeSchema>;
export type IdentityChange = z.infer<typeof identityChangeSchema>;
export type ManagerCase = z.infer<typeof managerCaseViewSchema>;
export class CustomerRecoveryApi {
  private api: CustomerAdminApi;
  constructor(request: typeof adminRequest) {
    this.api = new CustomerAdminApi(request);
  }
  path(id: string) {
    return `customers/${encodeURIComponent(id)}`;
  }
  async context(id: string) {
    const value = await this.api.read(
      `${this.path(id)}/recovery-context`,
      recoveryContextSchema,
    );
    if (value.customerId !== id) throw new AdminError("invalid_response");
    return value;
  }
  async challenge(id: string, challengeId: string) {
    const value = await this.api.read(
      `${this.path(id)}/card-verifications/${encodeURIComponent(challengeId)}`,
      phoneChallengeSchema,
    );
    if (value.customerId !== id || value.id !== challengeId)
      throw new AdminError("invalid_response");
    return value;
  }
  async issue(id: string, change: CustomerChange<object>) {
    const value = await this.api.commit(change, phoneChallengeSchema);
    if (value.customerId !== id) throw new AdminError("invalid_response");
    return value;
  }
  // The code is never put into the generic frozen-change/replay store.
  async verify(
    id: string,
    context: RecoveryContext,
    challenge: PhoneChallenge,
    code: string,
  ) {
    const value = await this.api.read(
      `${this.path(id)}/card-verifications/${encodeURIComponent(challenge.id)}/verify`,
      phoneChallengeSchema,
      {
        operationId: adminOperationId(),
        expectedVersion: context.customerVersion,
        expectedChallengeVersion: challenge.version,
        code,
      },
    );
    if (
      value.customerId !== id ||
      value.id !== challenge.id ||
      value.state !== "verified"
    )
      throw new AdminError("invalid_response");
    return value;
  }
  async apply(
    id: string,
    change: CustomerChange<object>,
    kind: IdentityChange["kind"],
  ) {
    const value = await this.api.commit(change, identityChangeSchema);
    const body = change.body as Record<string, unknown>;
    if (
      value.customerId !== id ||
      value.operationId !== body.operationId ||
      value.kind !== kind ||
      value.customerVersion !== Number(body.expectedVersion) + 1 ||
      value.reason !== body.reason ||
      (kind === "phone_change" &&
        (value.verification !== "card_present" ||
          value.oldCardCode !== null ||
          value.newCardCode !== null)) ||
      (kind === "card_replacement" &&
        (value.verification !== "registered_phone_code" ||
          value.newCardCode !== body.newCardCode))
    )
      throw new AdminError("invalid_response");
    return value;
  }
  async intake(id: string, change: CustomerChange<object>) {
    const value = await this.api.commit(change, managerCaseViewSchema);
    const body = change.body as Record<string, unknown>;
    if (
      value.customerId !== id ||
      value.customerVersionAtIntake !== body.expectedVersion ||
      value.reason !== body.reason ||
      value.verificationNotes !== body.verificationNotes
    )
      throw new AdminError("invalid_response");
    return value;
  }
}
const messages: Record<string, string> = {
  phone_verification_unconfigured:
    "Lost-card replacement isn't switched on yet",
  verification_unavailable:
    "Verification is unavailable. Request another code and try again.",
  phone_in_use:
    "This phone number already belongs to another customer. Enter a different number.",
  no_change:
    "This is the customer's current phone number. Enter a different number.",
  phone_invalid:
    "Enter a valid Nigerian mobile number in local or +234 format.",
  phone_policy_unconfigured:
    "Phone changes aren't configured yet. Contact your system administrator.",
  card_changed:
    "The customer's active card changed. Reload and inspect the current card before reviewing again.",
  card_unavailable:
    "This card is unavailable. Use an unassigned card from an Active batch.",
  case_already_open:
    "A manager case is already open for this customer. Nothing changed.",
  version_conflict:
    "This account or verification changed. Reload and review the current details.",
  delivery_unavailable:
    "Code delivery is unavailable. Try again later or record a manager intake.",
  invalid_request:
    "Check the fields. Do not include phone numbers, document numbers, passwords or codes in the notes.",
  invalid_response:
    "The result could not be verified. Check the current result before starting another change.",
};
export function recoveryMessage(error: unknown) {
  return error instanceof AdminError
    ? (messages[error.code] ?? error.message)
    : "The result is uncertain. Check your connection and retry the same request.";
}
export function sameRecoveryContext(a: RecoveryContext, b: RecoveryContext) {
  return (
    a.customerId === b.customerId &&
    a.customerVersion === b.customerVersion &&
    a.activeCard?.id === b.activeCard?.id &&
    a.activeCard?.version === b.activeCard?.version
  );
}
