import type { OutboxRow } from "@/client/types";
import {
  isCredited,
  needsUpload,
  authoritativeStatus,
} from "../../../../client/offline/sync-status";
import type { Tone } from "@/ui/shared";

export function salePresentation(row: OutboxRow): {
  title: string;
  label: string;
  description: string;
  tone: Tone;
  holds: string[];
} {
  const status = authoritativeStatus(row);
  if (isCredited(row))
    return {
      title: "Sale synced",
      label: "Synced",
      tone: "synced",
      holds: [],
      description: `Details and photo received. Added to ${status!.customer!.name}'s loyalty total.`,
    };
  if (status?.state === "held") {
    const holds = status.holds.map(
      (hold) =>
        ({
          price: "Price review",
          card: "Card eligibility review",
          date: "Sale date review",
        })[hold.kind],
    );
    if (status.pendingReason) holds.push("Eligibility review");
    const title = status.holds.some((hold) => hold.kind === "price")
      ? "Awaiting price review"
      : "Held";
    return {
      title,
      label: title,
      tone: "held",
      holds,
      description:
        "Uploaded: details and photo received. Not counted toward loyalty until an admin reviews it.",
    };
  }
  if (status?.state === "cancelled")
    return {
      title: "Sale cancelled",
      label: "Cancelled",
      tone: "failed",
      holds: [],
      description:
        status.cancellationReason === "customer_not_found"
          ? "No customer has this card. This sale has not been added to loyalty. Your original record and photo remain on this phone."
          : "This purchase was cancelled after validation. It has not been added to loyalty. Your original record and photo remain on this phone.",
    };
  if (row.state === "needs_attention")
    return {
      title: "Needs attention",
      label: "Needs attention",
      tone: "failed",
      holds: [],
      description:
        "This sale needs help from your manager. The original details and photo remain on this phone. Do not record the sale again.",
    };
  if (
    row.lastErrorCode &&
    status?.detailsReceived &&
    !status.photoValidated &&
    status.pendingReason !== "lookup_pending"
  )
    return {
      title: "Photo upload failed",
      label: "Photo upload failed",
      tone: "failed",
      holds: [],
      description:
        "Details received. Photo saved on this phone. Not counted toward loyalty yet.",
    };
  if (status || ["submitting", "uploading", "finalizing"].includes(row.state))
    return {
      title: "Upload pending",
      label: "Uploading",
      tone: "pending",
      holds: [],
      description:
        status?.pendingReason === "lookup_pending"
          ? "Details received. Customer lookup is pending. Not counted toward loyalty yet."
          : "Waiting for the server to confirm the complete sale. Not counted toward loyalty yet.",
    };
  return {
    title: "Saved on phone",
    label: "Saved on phone",
    tone: "pending",
    holds: [],
    description:
      "Upload pending. Not counted toward loyalty until the details and photo reach the server.",
  };
}
export function uploadSummary(rows: OutboxRow[]) {
  return {
    waiting: rows.filter(needsUpload),
    settled: rows.filter((row) => !needsUpload(row) && !isCredited(row)),
    completePhotos: rows.every(
      (row) => authoritativeStatus(row)?.photoValidated === true,
    ),
  };
}
