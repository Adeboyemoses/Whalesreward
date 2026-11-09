import { z } from "zod";
import {
  registrationSchema,
  registrationReceiptSchema,
  phoneLookupSchema,
  customerLookupSchema,
} from "../shared/contracts/customers-cards";
import { HttpAttendantApi } from "./api";
import { ClientError, type Lookup } from "./types";
import { connection } from "./offline/connection";
export type RegistrationInput = z.infer<typeof registrationSchema>;
export type RegistrationReceipt = z.infer<typeof registrationReceiptSchema>;
export type ExistingCustomer = z.infer<typeof customerLookupSchema>;
const errors: Record<string, string> = {
  phone_in_use: "This phone number already has an account.",
  phone_invalid: "Check the phone number and try again.",
  phone_policy_unconfigured:
    "Registration is not configured. Ask a station manager for help.",
  card_unavailable:
    "This card is unavailable. Check the unused card or ask a station manager for help.",
  customer_not_found:
    "No customer was found. Check the phone number and try again.",
  unauthenticated: "Sign in online again to continue.",
  permission_denied: "Your access has ended. Sign in online again.",
  assignment_unavailable:
    "Your assignment is unavailable. Ask a station manager for help.",
  online_sign_in_required: "Sign in online again to continue.",
  password_change_required:
    "Change your first password and sign in online again.",
  invalid_request: "Check the customer details and card number.",
  operation_conflict:
    "This registration could not be confirmed. Ask a station manager for help before trying a different registration.",
  rate_limited: "Too many attempts. Wait a moment and retry this registration.",
};
export function registrationUncertain(error: unknown) {
  return (
    !(error instanceof ClientError) ||
    ![
      "phone_in_use",
      "phone_invalid",
      "phone_policy_unconfigured",
      "card_unavailable",
      "invalid_request",
      "customer_not_found",
    ].includes(error.code)
  );
}
export class HttpRegistrationApi {
  private readonly cards: HttpAttendantApi;
  constructor(
    private readonly transport: typeof fetch = (...args) => fetch(...args),
    private readonly beginRequest = connection.beginRequest,
  ) {
    this.cards = new HttpAttendantApi(transport, beginRequest);
  }
  private async post<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    key?: string,
  ): Promise<T> {
    const outcome = this.beginRequest();
    let response: Response;
    try {
      response = await this.transport(path, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      outcome(false);
      throw new ClientError(
        "network_unavailable",
        "Result not confirmed. Connect and retry this exact registration.",
      );
    }
    outcome(true);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ClientError(
        "invalid_response",
        "Result not confirmed. Retry this exact registration.",
      );
    }
    if (!response.ok) {
      const parsed = z
        .object({
          error: z.object({ code: z.string(), retryable: z.boolean() }),
        })
        .safeParse(json);
      const code =
        parsed.success && Object.hasOwn(errors, parsed.data.error.code)
          ? parsed.data.error.code
          : "temporarily_unavailable";
      throw new ClientError(
        code,
        errors[code] ?? "Result not confirmed. Retry this exact registration.",
        response.status,
        null,
        parsed.success && parsed.data.error.retryable,
      );
    }
    const parsed = z
      .strictObject({
        data: schema,
        serverTime: z.iso.datetime({ offset: true }),
        requestId: z.uuidv7(),
      })
      .safeParse(json);
    if (!parsed.success)
      throw new ClientError(
        "invalid_response",
        "Result not confirmed. Retry this exact registration.",
      );
    return parsed.data.data;
  }
  async register(input: RegistrationInput): Promise<RegistrationReceipt> {
    const body = registrationSchema.parse(input);
    const receipt = await this.post(
      "/api/attendant/customers",
      body,
      registrationReceiptSchema,
      body.operationId,
    );
    if (receipt.operationId !== body.operationId)
      throw new ClientError(
        "invalid_response",
        "Result not confirmed. Retry this exact registration.",
      );
    return receipt;
  }
  lookupPhone(phone: string): Promise<ExistingCustomer> {
    return this.post(
      "/api/attendant/customers/lookup",
      phoneLookupSchema.parse({ phone }),
      customerLookupSchema,
    );
  }
  // This always reaches the online M1 endpoint; it never reads the phone's lookup cache.
  async currentCard(cardCode: string, customerId: string): Promise<Lookup> {
    const found = await this.cards.lookup({ source: "code", code: cardCode });
    if (found.cardCode !== cardCode || found.customer.id !== customerId)
      throw new ClientError(
        "card_unavailable",
        "This customer has no usable matching card. Ask a station manager for help.",
      );
    return found;
  }
}
/** One in-memory attempt. It cannot silently acquire a new key after uncertainty. */
export class RegistrationOperation {
  payload: Readonly<RegistrationInput> | null;
  private sending: Promise<RegistrationReceipt> | null = null;
  constructor(
    input: RegistrationInput,
    private readonly authority: string,
    private readonly currentAuthority: () => string | null,
  ) {
    const parsed = registrationSchema.parse(input);
    this.payload = Object.freeze({
      ...parsed,
      card: Object.freeze(parsed.card),
    });
  }
  clear() {
    this.payload = null;
  }
  async send(api: HttpRegistrationApi): Promise<RegistrationReceipt> {
    if (!this.payload || this.currentAuthority() !== this.authority)
      throw new ClientError(
        "account_changed",
        "Your session changed. Start again after signing in.",
      );
    if (this.sending) return this.sending;
    const payload = this.payload;
    this.sending = (async () => {
      const receipt = await api.register(payload);
      if (
        this.payload !== payload ||
        this.currentAuthority() !== this.authority
      )
        throw new ClientError(
          "account_changed",
          "Your session changed. Start again after signing in.",
        );
      return receipt;
    })();
    try {
      return await this.sending;
    } finally {
      this.sending = null;
    }
  }
}
