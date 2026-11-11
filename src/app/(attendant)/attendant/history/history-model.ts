import type { AttendantSaleRow } from "@/client/sales-api";
import type { OutboxRow } from "@/client/types";
import type { CorrectionOutboxRow } from "@/client/offline/correction-types";
/** M1 session.account.id is the attendant profile ID, not M3's auth account ID. */
export function ownsAttendantSale(
  profileId: string,
  row: Pick<AttendantSaleRow, "seller">,
) {
  return row.seller.attendantId === profileId;
}
export function mergeOwnHistory(
  accountId: string,
  server: AttendantSaleRow[],
  local: OutboxRow[],
) {
  const seen = new Set<string>();
  const remote = server
    .filter((r) => ownsAttendantSale(accountId, r))
    .sort(
      (a, b) =>
        b.serverReceivedAt.localeCompare(a.serverReceivedAt) ||
        b.id.localeCompare(a.id),
    )
    .filter((r) => {
      if (seen.has(r.operationId)) return false;
      seen.add(r.operationId);
      return true;
    });
  const pending = local
    .filter(
      (r) => r.originatingAccountId === accountId && !seen.has(r.operationId),
    )
    .sort((a, b) => b.localSavedAt.localeCompare(a.localSavedAt));
  return { remote, pending };
}
export function correctionLabel(row: CorrectionOutboxRow): string {
  switch (row.state) {
    case "saved":
      return "Correction saved on phone";
    case "waiting_original":
      return "Waiting for the original";
    case "submitting":
      return "Sending correction";
    case "pending_validation":
      return "Correction awaiting validation";
    case "awaiting_review":
      return "Correction awaiting admin review";
    case "accepted":
      return "Correction applied";
    case "rejected":
      return "Correction rejected";
    case "needs_attention":
      return "Correction needs attention";
  }
}
export const correctionReceiptKey = (rows: CorrectionOutboxRow[]) =>
  rows
    .map(
      (r) => `${r.operationId}:${r.serverCorrection?.version ?? 0}:${r.state}`,
    )
    .join("|");
