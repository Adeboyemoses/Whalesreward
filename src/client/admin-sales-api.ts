import { z } from "zod";
import { adminRequest, AdminError, adminOperationId } from "./admin-api";
import {
  correctionDecisionSchema,
  decisionSchema,
  saleFilterSchema,
  saleDetailSchema,
  salePageSchema,
  photoAccessInputSchema,
  photoAccessSchema,
  saleHistoryInputSchema,
  pageOf,
  revisionSchema,
  correctionSchema,
  duplicateFlagSchema,
  type CorrectionDecision,
  type SaleFilter,
} from "../shared/contracts/sales";
export type AdminSaleDetail = z.infer<typeof saleDetailSchema>;
export type AdminSalePage = z.infer<typeof salePageSchema>;
export type AdminHistoryKind = z.infer<typeof saleHistoryInputSchema>["kind"];
export const adminHistorySchemas = {
  revisions: revisionSchema,
  corrections: correctionSchema,
  decisions: decisionSchema,
  duplicateFlags: duplicateFlagSchema,
};
export type FrozenDecision = { path: string; body: CorrectionDecision };
export class AdminSalesApi {
  constructor(
    private request: typeof adminRequest = adminRequest,
    private decisionRequest: typeof adminRequest = request,
  ) {}
  private async read<T>(path: string, schema: z.ZodType<T>, body?: unknown) {
    const data = await this.request<unknown>(path, body);
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new AdminError("invalid_response", 200);
    return parsed.data;
  }
  search(filters: SaleFilter) {
    return this.read(
      "sales/search",
      salePageSchema,
      saleFilterSchema.parse(filters),
    );
  }
  detail(id: string) {
    return this.read(`sales/${encodeURIComponent(id)}`, saleDetailSchema);
  }
  history<K extends AdminHistoryKind>(id: string, kind: K, cursor: string) {
    const input = saleHistoryInputSchema.parse({ kind, cursor, limit: 25 });
    const query = new URLSearchParams({
      kind: input.kind,
      cursor: input.cursor!,
      limit: String(input.limit),
    });
    return this.read(
      `sales/${encodeURIComponent(id)}/history?${query}`,
      pageOf(adminHistorySchemas[kind]),
    );
  }
  async photoAccess(purchaseId: string, assetId: string) {
    const data = await this.read(
      `sales/${encodeURIComponent(purchaseId)}/photo-access`,
      photoAccessSchema,
      photoAccessInputSchema.parse({ assetId }),
    );
    const url = new URL(data.url);
    if (
      ![
        "https:",
        ...(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          ? ["http:"]
          : []),
      ].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      data.assetId !== assetId ||
      Date.parse(data.expiresAt) <= Date.now()
    )
      throw new AdminError("invalid_response", 200);
    return data;
  }
  freeze(
    detail: AdminSaleDetail,
    correctionId: string,
    outcome: CorrectionDecision["outcome"],
    reason: string,
  ): FrozenDecision {
    const correction = detail.corrections.find((c) => c.id === correctionId);
    if (!correction) throw new AdminError("review_closed", 409);
    return {
      path: `sales/${encodeURIComponent(detail.id)}/corrections/${encodeURIComponent(correctionId)}/decision`,
      body: correctionDecisionSchema.parse({
        operationId: adminOperationId(),
        expectedVersion: detail.version,
        expectedRevisionId: detail.currentRevisionId,
        expectedCorrectionVersion: correction.version,
        outcome,
        reason,
      }),
    };
  }
  async decide(frozen: FrozenDecision) {
    const data = await this.decisionRequest<unknown>(
      frozen.path,
      frozen.body,
      "POST",
      frozen.body.operationId,
    );
    const parsed = decisionSchema.safeParse(data);
    if (!parsed.success) throw new AdminError("invalid_response", 200);
    return parsed.data;
  }
}

/** A P-19 maker refusal is a domain denial, so recheck live authority before ending a healthy session. */
export function correctionDecisionRequest(
  store: import("./admin-session").AdminSessionStore,
  transport: typeof adminRequest = adminRequest,
): typeof adminRequest {
  return async <T>(
    path: string,
    body?: unknown,
    method?: string,
    key?: string,
  ): Promise<T> => {
    const epoch = store.getSnapshot().epoch;
    try {
      const result = await transport<T>(path, body, method, key);
      if (store.getSnapshot().epoch !== epoch) throw new AdminError("obsolete");
      return result;
    } catch (e) {
      if (store.getSnapshot().epoch !== epoch) throw new AdminError("obsolete");
      if (e instanceof AdminError) {
        if (e.status === 401 || e.code === "password_change_required")
          store.clear("Your session ended. Sign in again.");
        else if (e.code === "permission_denied") await store.refresh();
      }
      if (store.getSnapshot().epoch !== epoch) throw new AdminError("obsolete");
      throw e;
    }
  };
}
