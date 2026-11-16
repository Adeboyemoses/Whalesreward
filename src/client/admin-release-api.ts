import { z } from "zod";
import { adminRequest, AdminError, adminOperationId } from "./admin-api";
import { AdminSalesApi, type AdminSaleDetail } from "./admin-sales-api";
import { authId } from "../shared/contracts/auth";
import { pageOf } from "../shared/contracts/sales";
import {
  releasePreparationSchema,
  releaseProposalSchema,
  releaseProposalInputSchema,
  releaseDecisionInputSchema,
  releaseDecisionResponseSchema,
  releaseSheetReservationSchema,
  releaseSheetFinalizeSchema,
  type ReleaseProposalInput,
} from "../shared/contracts/held-release";
export type ReleasePreparation = z.infer<typeof releasePreparationSchema>;
export type ReleaseProposal = z.infer<typeof releaseProposalSchema>;
export type ReleaseKind = ReleasePreparation["kind"];
export type FrozenRelease = {
  actorId: string;
  path: string;
  body: Record<string, unknown> & { operationId: string };
  kind: "reserve" | "finalize" | "propose" | "decide";
};
export const sheetReservationResult = z.strictObject({
  uploadId: authId,
  assetId: authId,
});
export const sheetUploadUrl = z.strictObject({
  url: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
  assetId: authId,
  maxBytes: z.number().int().positive().max(8388608),
});
export const sheetValidated = z.strictObject({
  assetId: authId,
  state: z.literal("validated"),
});
export const sheetRead = z.strictObject({
  url: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
  assetId: authId,
});
function validUrl<
  T extends { url: string; expiresAt: string; assetId: string },
>(v: T, assetId: string) {
  const u = new URL(v.url);
  if (
    (u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
      )) ||
    u.username ||
    u.password ||
    u.hash ||
    v.assetId !== assetId ||
    Date.parse(v.expiresAt) <= Date.now() ||
    Date.parse(v.expiresAt) > Date.now() + 300000
  )
    throw new AdminError("invalid_response", 200);
  return v;
}
export function releaseUncertain(e: unknown) {
  return (
    !(e instanceof AdminError) ||
    e.status === 0 ||
    e.status >= 500 ||
    e.status === 429 ||
    ["invalid_response", "unavailable", "evidence_pending"].includes(e.code)
  );
}
export const releaseMessages: Record<string, string> = {
  release_not_required:
    "The records can now settle this through the ordinary review. This proposal was not applied.",
  proposal_stale:
    "The sale, evidence or permissions changed after this proposal. Refresh and review it again.",
  evidence_insufficient:
    "The entry and records don't settle this review. The range may be too broad, the facts may not match, or they may conflict with another recorded decision. Leave the sale held; do not guess or change readings to make them fit.",
  independent_reviewer_required:
    "You can't decide this proposal. It needs a different person who was not the sale's attendant or involved in its recovery.",
  independence_unverifiable:
    "We can't verify that you're an independent reviewer. Ask an authorized administrator to check staff identity records. This sale stays held.",
  permission_denied: "You no longer have permission to review this sale.",
  release_policy_unconfigured:
    "Two-person release isn't switched on for this station. This sale stays held. You can continue ordinary review.",
  proposal_pending: "This sale already has a pending proposal.",
  version_conflict:
    "This sale changed while you were reviewing it. Refresh and review again.",
  operation_conflict:
    "This request doesn't match its earlier submission. Refresh the recorded history before continuing.",
  review_closed:
    "This review is no longer open or does not match this proposal.",
  hold_kind_mismatch:
    "This review is no longer open or does not match this proposal.",
  evidence_unavailable:
    "Required evidence is unavailable. This sale cannot be approved from this proposal.",
  evidence_deleted:
    "Required evidence is unavailable. This sale cannot be approved from this proposal.",
  evidence_pending: "The photo has not finished validation.",
  evidence_already_validated: "This photo has already been received.",
  photo_invalid:
    "This photo couldn't be accepted. Choose one readable JPEG within the stated limits.",
  upload_expired: "This upload expired. Start a new photo upload.",
  storage_unavailable: "The photo service is unavailable. Try again.",
  date_invalid: "Enter a real date supported by the entry.",
  date_after_receipt:
    "The supported sale date cannot be after the server received this sale.",
  invalid_request:
    "This form couldn't be submitted. Check the fields and try again.",
  request_too_large:
    "This form couldn't be submitted. Check the fields and try again.",
  unauthenticated: "Sign in again to continue.",
  password_change_required:
    "Change your temporary password before reviewing sales.",
  origin_rejected:
    "This request couldn't be verified. Reload the page before continuing.",
  not_found: "This sale or proposal is unavailable.",
  rate_limited: "Too many requests. Wait a moment before trying again.",
};
export function releaseMessage(e: unknown) {
  return (
    releaseMessages[e instanceof AdminError ? e.code : ""] ??
    "We couldn't confirm whether this was recorded. Retry the same request to check its result."
  );
}
function freezeBody<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeBody);
    Object.freeze(value);
  }
  return value;
}
export class AdminReleaseApi extends AdminSalesApi {
  constructor(private transport: typeof adminRequest = adminRequest) {
    super(transport);
  }
  private async readRelease<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ) {
    const value = await this.transport<unknown>(path, body);
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new AdminError("invalid_response", 200);
    return parsed.data;
  }
  preparation(purchaseId: string, kind: ReleaseKind) {
    return this.readRelease(
      `sales/${encodeURIComponent(purchaseId)}/release-preparation?kind=${kind}`,
      releasePreparationSchema,
    );
  }
  proposals(purchaseId: string, cursor?: string) {
    const q = new URLSearchParams({
      limit: "25",
      ...(cursor ? { cursor } : {}),
    });
    return this.readRelease(
      `sales/${encodeURIComponent(purchaseId)}/release-proposals?${q}`,
      pageOf(releaseProposalSchema),
    );
  }
  proposal(purchaseId: string, proposalId: string) {
    authId.parse(proposalId);
    return this.readRelease(
      `sales/${encodeURIComponent(purchaseId)}/release-proposals/${encodeURIComponent(proposalId)}`,
      releaseProposalSchema,
    );
  }
  freezeRelease(
    actorId: string,
    purchaseId: string,
    kind: FrozenRelease["kind"],
    body: unknown,
    suffix?: string,
  ): FrozenRelease {
    const schemas = {
      reserve: releaseSheetReservationSchema,
      finalize: releaseSheetFinalizeSchema,
      propose: releaseProposalInputSchema,
      decide: releaseDecisionInputSchema,
    };
    const input = schemas[kind].parse({
      ...(body as object),
      operationId: adminOperationId(),
    });
    return Object.freeze({
      actorId,
      path: `sales/${encodeURIComponent(purchaseId)}/${suffix ?? (kind === "reserve" ? "release-sheet-uploads" : "release-proposals")}`,
      kind,
      body: freezeBody(
        JSON.parse(JSON.stringify(input)),
      ) as FrozenRelease["body"],
    });
  }
  freezeProposal(
    actorId: string,
    purchaseId: string,
    input: Omit<ReleaseProposalInput, "operationId">,
  ) {
    return this.freezeRelease(actorId, purchaseId, "propose", input);
  }
  freezeDecision(
    actorId: string,
    sale: AdminSaleDetail,
    p: ReleaseProposal,
    outcome: "approve" | "reject",
    reason: string,
  ) {
    return this.freezeRelease(
      actorId,
      sale.id,
      "decide",
      {
        expectedVersion: sale.version,
        expectedRevisionId: sale.currentRevisionId,
        expectedProposalVersion: p.version,
        outcome,
        reason,
      },
      `release-proposals/${encodeURIComponent(p.id)}/decision`,
    );
  }
  async send<T>(f: FrozenRelease, actorId: string, schema: z.ZodType<T>) {
    if (actorId !== f.actorId) throw new AdminError("obsolete");
    const result = await this.transport<unknown>(
      f.path,
      f.body,
      "POST",
      f.body.operationId,
    );
    const parsed = schema.safeParse(result);
    if (!parsed.success) throw new AdminError("invalid_response", 200);
    return parsed.data;
  }
  reserve(f: FrozenRelease, actorId: string) {
    return this.send(f, actorId, sheetReservationResult);
  }
  finalize(f: FrozenRelease, actorId: string) {
    return this.send(f, actorId, sheetValidated);
  }
  propose(f: FrozenRelease, actorId: string) {
    return this.send(f, actorId, releaseProposalSchema);
  }
  decideRelease(f: FrozenRelease, actorId: string) {
    return this.send(f, actorId, releaseDecisionResponseSchema);
  }
  async uploadUrl(purchaseId: string, uploadId: string, assetId: string) {
    return validUrl(
      await this.readRelease(
        `sales/${encodeURIComponent(purchaseId)}/release-sheet-uploads/${encodeURIComponent(uploadId)}/upload-url`,
        sheetUploadUrl,
        {},
      ),
      assetId,
    );
  }
  async sheetAccess(purchaseId: string, p: ReleaseProposal) {
    return validUrl(
      await this.readRelease(
        `sales/${encodeURIComponent(purchaseId)}/release-proposals/${encodeURIComponent(p.id)}/photo-access`,
        sheetRead,
        { assetId: p.sheetAssetId },
      ),
      p.sheetAssetId,
    );
  }
}
