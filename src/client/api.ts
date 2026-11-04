import { z } from "zod";
import {
  ClientError,
  lookupSchema,
  sessionSchema,
  type Lookup,
  type Session,
} from "./types";
export { ClientError } from "./types";
export interface AttendantApi {
  signIn(
    input: { username: string; password: string; deviceId: string },
    key: string,
  ): Promise<Session>;
  signOut(key: string): Promise<void>;
  session(): Promise<Session>;
  lookup(
    input: { source: "code"; code: string } | { source: "qr"; qr: string },
  ): Promise<Lookup>;
}
export class HttpAttendantApi implements AttendantApi {
  constructor(
    private readonly transport: typeof fetch = (...args) => fetch(...args),
  ) {}
  private async request<T>(
    path: string,
    schema: z.ZodType<T> | null,
    body?: unknown,
    key?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.transport(path, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ClientError(
        "network_unavailable",
        "Could not connect. Check your connection and try again.",
      );
    }
    if (response.status === 204 && schema === null) return undefined as T;
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ClientError(
        "invalid_response",
        "The service returned an unreadable response. Try again.",
      );
    }
    if (!response.ok) {
      const parsed = z
        .object({
          error: z.object({
            code: z.string(),
            message: z.string(),
            retryable: z.boolean(),
          }),
        })
        .safeParse(json);
      const code = parsed.success
        ? parsed.data.error.code
        : "temporarily_unavailable";
      const messages: Record<string, string> = {
        invalid_credentials: "The username or password is not correct.",
        unauthenticated: "Sign in online again to continue.",
        assignment_unavailable:
          "Your pump assignment is unavailable. Contact your manager.",
        customer_not_found:
          "No customer has this card. Check the printed code, or scan the QR.",
        card_unavailable: "This card is unavailable for a new sale.",
        rate_limited: "Too many attempts. Wait a moment and try again.",
      };
      throw new ClientError(
        code,
        messages[code] ?? "The service is unavailable. Try again.",
      );
    }
    if (!schema)
      throw new ClientError("invalid_response", "Unexpected service response.");
    const result = z
      .strictObject({
        data: schema,
        serverTime: z.iso.datetime({ offset: true }),
        requestId: z.uuidv7(),
      })
      .safeParse(json);
    if (!result.success)
      throw new ClientError(
        "invalid_response",
        "The service returned an invalid response. Try again.",
      );
    return result.data.data;
  }
  signIn(
    input: { username: string; password: string; deviceId: string },
    key: string,
  ) {
    return this.request("/api/attendant/sign-in", sessionSchema, input, key);
  }
  signOut(key: string) {
    return this.request<void>("/api/attendant/sign-out", null, {}, key);
  }
  session() {
    return this.request("/api/attendant/session", sessionSchema);
  }
  lookup(
    input: { source: "code"; code: string } | { source: "qr"; qr: string },
  ) {
    return this.request("/api/attendant/cards/lookup", lookupSchema, input);
  }
}
