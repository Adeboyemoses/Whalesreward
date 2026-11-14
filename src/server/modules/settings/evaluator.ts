import { createHash } from "node:crypto";
export const TIMING_SEMANTICS =
  "P-28|owner+settings|now<currentStart,proposedStart|noSnapshot|launch<=start<cutoff|inclusiveLaunchStartCutoffDeadline|deadline=cutoff+elapsedWholeHours|oneCampaignPerStation|receiptFirstLiveOwner";
export const TIMING_SEMANTICS_DIGEST =
  "5279603d4c9e94e46b2a27bac59b50034b7575b068d432bef2e73fd10055a463";
export function timingEvaluatorInstalled(): boolean {
  return (
    createHash("sha256").update(TIMING_SEMANTICS).digest("hex") ===
    TIMING_SEMANTICS_DIGEST
  );
}
