import { z } from "zod";
import { connection } from "./offline/connection";
import {
  ClientError,
  lookupSchema,
  sessionSchema,
  type Lookup,
  type Session,
  saleStatusSchema,
  uploadPermissionSchema,
  type OriginalSale,
  type UploadPermissionRequest,
  type UploadPermission,
  type FinalizeRequest,
  type SyncResult,
} from "./types";
export { ClientError } from "./types";
export interface AttendantApi {
  submitSale(original: OriginalSale, signal?: AbortSignal): Promise<SyncResult>;
  saleStatus(operationId: string, signal?: AbortSignal): Promise<SyncResult>;
  uploadPermission(
    purchaseId: string,
    input: UploadPermissionRequest,
    signal?: AbortSignal,
  ): Promise<UploadPermission>;
  uploadPhoto(
    permission: UploadPermission,
    blob: Blob,
    signal?: AbortSignal,
  ): Promise<void>;
  finalizeSale(
    purchaseId: string,
    input: FinalizeRequest,
    signal?: AbortSignal,
  ): Promise<SyncResult>;
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
    private readonly beginRequest = connection.beginRequest,
  ) {}
  private async request<T>(
    path: string,
    schema: z.ZodType<T> | null,
    body?: unknown,
    key?: string,
    signal?: AbortSignal,
    metadata?: { retryAfterMs: number | null },
  ): Promise<T> {
    let response: Response;
    const outcome = this.beginRequest();
    try {
      response = await this.transport(path, {
        method: body === undefined ? "GET" : "POST",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
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
      // Local pause/sign-out cancellation says nothing about connectivity.
      if (!signal?.aborted) outcome(false);
      throw new ClientError(
        "network_unavailable",
        "Could not connect. Check your connection and try again.",
      );
    }
    // Even a denial or server error proves transport worked. Authorization below
    // still consumes the original response; no short connectivity deadline aborts it.
    outcome(true);
    const retryAfterMs = readRetryAfter(response);
    if (metadata) metadata.retryAfterMs = retryAfterMs;
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
      const code =
        parsed.success && ERROR_CODES.has(parsed.data.error.code)
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
        response.status,
        retryAfterMs,
        parsed.success && parsed.data.error.retryable,
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
  private async syncRequest(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const metadata = { retryAfterMs: null as number | null };
    const status = await this.request(
      path,
      saleStatusSchema,
      body,
      undefined,
      signal,
      metadata,
    );
    return { status, retryAfterMs: metadata.retryAfterMs };
  }
  submitSale(original: OriginalSale, signal?: AbortSignal) {
    return this.syncRequest("/api/sync/sales", original, signal);
  }
  saleStatus(operationId: string, signal?: AbortSignal) {
    return this.syncRequest(
      `/api/sync/sales/by-operation/${z.uuidv7().parse(operationId)}`,
      undefined,
      signal,
    );
  }
  uploadPermission(
    purchaseId: string,
    input: UploadPermissionRequest,
    signal?: AbortSignal,
  ) {
    return this.request(
      `/api/sync/sales/${z.uuidv7().parse(purchaseId)}/upload-permission`,
      uploadPermissionSchema,
      input,
      undefined,
      signal,
    );
  }
  finalizeSale(
    purchaseId: string,
    input: FinalizeRequest,
    signal?: AbortSignal,
  ) {
    return this.syncRequest(
      `/api/sync/sales/${z.uuidv7().parse(purchaseId)}/finalize`,
      input,
      signal,
    );
  }
  async uploadPhoto(
    permission: UploadPermission,
    blob: Blob,
    signal?: AbortSignal,
  ) {
    const parsed = uploadPermissionSchema.safeParse(permission);
    if (!parsed.success || blob.size > permission.maxBytes || blob.size === 0)
      throw new ClientError(
        "invalid_response",
        "The upload permission is invalid.",
      );
    let response: Response;
    try {
      response = await this.transport(permission.url, {
        method: "PUT",
        body: blob,
        headers: permission.headers,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
    } catch {
      throw new ClientError(
        "photo_upload_failed",
        "Photo upload failed. It is still saved on this phone.",
        undefined,
        null,
        true,
      );
    }
    if (!response.ok)
      throw new ClientError(
        "photo_upload_failed",
        "Photo upload failed. It is still saved on this phone.",
        response.status,
        readRetryAfter(response),
        true,
      );
  }
}

function readRetryAfter(response: Response): number | null {
  const raw = response.headers.get("Retry-After");
  if (!raw || !/^\d+$/.test(raw)) return null;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds)
    ? Math.min(seconds * 1000, 2147483647)
    : null;
}

const ERROR_CODES = new Set([
  "invalid_credentials",
  "unauthenticated",
  "assignment_unavailable",
  "customer_not_found",
  "card_unavailable",
  "rate_limited",
  "permission_denied",
  "origin_rejected",
  "invalid_request",
  "temporarily_unavailable",
  "online_sign_in_required",
  "operation_conflict",
  "capture_context_invalid",
  "calculation_invalid",
  "medium_invalid",
  "photo_metadata_invalid",
  "policy_review_required",
  "sale_not_found",
  "sale_not_uploadable",
  "upload_permission_expired",
  "stale_version",
  "upload_not_found",
  "photo_invalid",
  "storage_unavailable",
  "sign_in_retry_expired",
]);
