import { z } from "zod";
import {
  attendantSaleRowSchema,
  attendantSaleDetailSchema,
  attendantSalePageSchema,
  attendantHistoryInputSchema,
  attendantRevisionSchema,
  attendantCorrectionSchema,
  attendantDecisionSchema,
  correctionSubmissionSchema,
  pageOf,
  type CorrectionSubmission,
  type AttendantCorrection,
} from "../shared/contracts/sales";
import { ClientError } from "./types";
import { connection } from "./offline/connection";
import { observeServerBuild, UPDATE_MESSAGE } from "./sw/build-id";

export type AttendantSaleRow = z.infer<typeof attendantSaleRowSchema>;
export type AttendantSaleDetail = z.infer<typeof attendantSaleDetailSchema>;
export type AttendantSalePage = z.infer<typeof attendantSalePageSchema>;
export type AttendantHistoryInput = z.input<typeof attendantHistoryInputSchema>;
export type AttendantHistoryItem =
  | z.infer<typeof attendantRevisionSchema>
  | AttendantCorrection
  | z.infer<typeof attendantDecisionSchema>;
export type AttendantHistoryPage = {
  items: AttendantHistoryItem[];
  nextCursor: string | null;
};
export interface AttendantSalesApi {
  list(
    input?: { cursor?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<AttendantSalePage>;
  detail(
    purchaseId: string,
    signal?: AbortSignal,
  ): Promise<AttendantSaleDetail>;
  history(
    purchaseId: string,
    input: AttendantHistoryInput,
    signal?: AbortSignal,
  ): Promise<AttendantHistoryPage>;
  photo(purchaseId: string, signal?: AbortSignal): Promise<Blob>;
  submitCorrection(
    purchaseId: string,
    body: CorrectionSubmission,
    signal?: AbortSignal,
  ): Promise<AttendantCorrection>;
  correction(
    purchaseId: string,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<AttendantCorrection>;
}
const id = (value: string) => z.uuidv7().parse(value);
const errorCodes = new Set([
  "invalid_request",
  "unauthenticated",
  "permission_denied",
  "origin_rejected",
  "password_change_required",
  "request_too_large",
  "rate_limited",
  "temporarily_unavailable",
  "not_found",
  "online_sign_in_required",
  "operation_conflict",
  "version_conflict",
  "base_revision_changed",
  "correction_pending",
  "sale_not_correctable",
  "no_change",
  "calculation_invalid",
  "evidence_unavailable",
  "evidence_pending",
  "evidence_deleted",
  "storage_unavailable",
  "policy_review_required",
]);
export function correctionErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    correction_pending:
      "A correction is already waiting for this sale. Reload the sale to see it.",
    sale_not_correctable:
      "This sale cannot be corrected here. Ask a station manager for help.",
    no_change: "Change the recorded value before saving a correction.",
    base_revision_changed:
      "The recorded sale changed. Open it again and review your correction.",
    version_conflict:
      "The recorded sale changed. Open it again and review your correction.",
    evidence_unavailable:
      "The meter photo is unavailable. This correction needs the retained photo.",
    evidence_pending: "The meter photo is still uploading or being checked.",
    evidence_deleted: "The meter photo is no longer available.",
    online_sign_in_required:
      "Sign in online again with the same account to send this correction.",
    unauthenticated: "Sign in online again to continue.",
    permission_denied: "You do not have access to this sale or correction.",
    rate_limited: "Too many requests. Wait a moment and try again.",
    invalid_request: "Check the correction value and reason, then try again.",
    calculation_invalid:
      "Enter a positive value within the sale's recorded precision.",
    operation_conflict:
      "This correction could not be verified. Open the sale again and ask a station manager for help.",
    not_found: "This sale or correction is unavailable.",
    storage_unavailable:
      "The meter photo could not be loaded. Try again when the service is available.",
  };
  return (
    messages[code] ??
    "The service is unavailable. Your saved correction stays on this phone."
  );
}
export class HttpAttendantSalesApi implements AttendantSalesApi {
  constructor(
    private transport: typeof fetch = (...args) => fetch(...args),
    private beginRequest = connection.beginRequest,
  ) {}
  private async response(path: string, body?: unknown, signal?: AbortSignal) {
    const outcome = this.beginRequest();
    let response: Response;
    try {
      response = await this.transport(path, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
        ...(body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
    } catch {
      if (!signal?.aborted) outcome(false);
      throw new ClientError(
        "network_unavailable",
        "Could not connect. Your saved correction stays on this phone.",
      );
    }
    outcome(true);
    const changed = observeServerBuild(response.headers.get("x-whr-build"));
    if (!response.ok) {
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        /* Preserve uncertain delivery and retry identity. */
      }
      const parsed = z
        .object({
          error: z.object({ code: z.string(), retryable: z.boolean() }),
        })
        .safeParse(data);
      const code =
        parsed.success && errorCodes.has(parsed.data.error.code)
          ? parsed.data.error.code
          : "temporarily_unavailable";
      const retry = response.headers.get("retry-after");
      const retryMs =
        retry && /^\d+$/.test(retry)
          ? Math.min(Number(retry) * 1000, 86400000)
          : null;
      throw new ClientError(
        code,
        correctionErrorMessage(code),
        response.status,
        retryMs,
        parsed.success && parsed.data.error.retryable,
      );
    }
    return { response, changed };
  }
  private async json<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const { response, changed } = await this.response(path, body, signal);
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      /* Validated below. */
    }
    const result = z
      .strictObject({
        data: schema,
        serverTime: z.iso.datetime({ offset: true }),
        requestId: z.uuidv7(),
      })
      .safeParse(value);
    if (!result.success)
      throw new ClientError(
        changed ? "app_update_required" : "invalid_response",
        changed
          ? UPDATE_MESSAGE
          : "Could not verify the service response. Try again.",
      );
    return result.data.data;
  }
  list(input: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) {
    const parsed = attendantHistoryInputSchema
      .omit({ kind: true })
      .parse(input);
    const query = new URLSearchParams({
      limit: String(parsed.limit),
      ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
    });
    return this.json(
      `/api/attendant/sales?${query}`,
      attendantSalePageSchema,
      undefined,
      signal,
    );
  }
  detail(purchaseId: string, signal?: AbortSignal) {
    return this.json(
      `/api/attendant/sales/${id(purchaseId)}`,
      attendantSaleDetailSchema,
      undefined,
      signal,
    );
  }
  history(
    purchaseId: string,
    input: AttendantHistoryInput,
    signal?: AbortSignal,
  ): Promise<AttendantHistoryPage> {
    const parsed = attendantHistoryInputSchema.parse(input);
    const query = new URLSearchParams({
      kind: parsed.kind,
      limit: String(parsed.limit),
      ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
    });
    const schema =
      parsed.kind === "revisions"
        ? attendantRevisionSchema
        : parsed.kind === "corrections"
          ? attendantCorrectionSchema
          : attendantDecisionSchema;
    return this.json(
      `/api/attendant/sales/${id(purchaseId)}/history?${query}`,
      pageOf(schema),
      undefined,
      signal,
    );
  }
  async photo(purchaseId: string, signal?: AbortSignal): Promise<Blob> {
    const { response } = await this.response(
      `/api/attendant/sales/${id(purchaseId)}/photo`,
      undefined,
      signal,
    );
    if (response.headers.get("content-type")?.split(";")[0] !== "image/jpeg")
      throw new ClientError(
        "invalid_response",
        "The service did not return a meter photo.",
      );
    return response.blob();
  }
  submitCorrection(
    purchaseId: string,
    body: CorrectionSubmission,
    signal?: AbortSignal,
  ) {
    return this.json(
      `/api/attendant/sales/${id(purchaseId)}/corrections`,
      attendantCorrectionSchema,
      correctionSubmissionSchema.parse(body),
      signal,
    );
  }
  correction(purchaseId: string, operationId: string, signal?: AbortSignal) {
    return this.json(
      `/api/attendant/sales/${id(purchaseId)}/corrections/by-operation/${id(operationId)}`,
      attendantCorrectionSchema,
      undefined,
      signal,
    );
  }
}
