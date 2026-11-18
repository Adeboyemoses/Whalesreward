import { z } from "zod";
import { adminRequest, AdminError } from "./admin-api";
import type { PermissionCode } from "../shared/contracts/admin";
import {
  pendingReleaseFilterSchema,
  pendingReleasePageSchema,
  type PendingReleaseFilter,
  type ReleaseKind,
} from "../shared/contracts/pending-release";
export type PendingReleasePage = z.infer<typeof pendingReleasePageSchema>;
export type PendingReleaseSummary = PendingReleasePage["items"][number];
const releaseGrants = {
  price: "priceReview",
  card: "cardEligibility",
  date: "dateReview",
  capture: "dateReview",
} as const;
export function releaseReviewAllowed(
  permissions: readonly PermissionCode[] | undefined,
  kind: ReleaseKind,
) {
  return (
    !!permissions?.includes("sales") &&
    !!permissions.includes(releaseGrants[kind])
  );
}
export function releaseProposalHref(
  purchaseId: string,
  proposal: { kind: ReleaseKind; proposalId: string },
  suffix = "",
) {
  const query = new URLSearchParams(suffix.replace(/^\?/, ""));
  query.set("proposal", proposal.proposalId);
  return `/admin/sales/${encodeURIComponent(purchaseId)}/${proposal.kind}-review?${query}`;
}
export class AdminPendingReleaseApi {
  constructor(private request: typeof adminRequest = adminRequest) {}
  async pending(filters: Partial<PendingReleaseFilter> = {}) {
    const input = pendingReleaseFilterSchema.parse(filters);
    const query = new URLSearchParams();
    if (input.kind) query.set("kind", input.kind);
    if (input.cursor) query.set("cursor", input.cursor);
    query.set("limit", String(input.limit));
    const result = pendingReleasePageSchema.safeParse(
      await this.request<unknown>(`release-proposals/pending?${query}`),
    );
    if (!result.success) throw new AdminError("invalid_response", 200);
    return result.data;
  }
}
