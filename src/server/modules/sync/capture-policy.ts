/** P-18 is provisional pending Q-528. No app/UUID/EXIF time enters this policy. */
export const CAPTURE_POLICY_VERSION = 1;
export type PriceHistory = {
  effectiveFrom: Date;
  rateKobo: string;
  currency: string;
};
export type CampaignHistory = {
  effectiveFrom: Date;
  purchaseStart: Date | null;
  purchaseCutoff: Date | null;
  uploadDeadline: Date | null;
  campaignId: string | null;
};
export type CapturePolicyInput = {
  signedInAt: Date;
  receivedAt: Date;
  offlineExpiresAt: Date;
  contextRevokedAt: Date | null;
  assignment: { effectiveFrom: Date; effectiveUntil: Date | null };
  rateKobo: string;
  currency: string;
  prices: PriceHistory[];
  settings: CampaignHistory[];
};
export type CapturePolicyResult = {
  reasons: string[];
  campaignEligible: boolean;
};
export function evaluateCapturePolicy(
  input: CapturePolicyInput,
): CapturePolicyResult {
  const reasons = new Set<string>();
  const s = input.signedInAt.getTime(),
    r = input.receivedAt.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(r) || r < s)
    return { reasons: ["capture_history_incomplete"], campaignEligible: false };
  if (
    input.assignment.effectiveFrom.getTime() > s ||
    (input.assignment.effectiveUntil !== null &&
      input.assignment.effectiveUntil.getTime() <= r) ||
    (input.contextRevokedAt !== null &&
      input.contextRevokedAt.getTime() <= r) ||
    input.offlineExpiresAt.getTime() <= r
  )
    reasons.add("capture_authorization_unresolved");
  const prices = input.prices
    .filter((p) => p.effectiveFrom.getTime() <= r)
    .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  const anchor = prices.findLastIndex((p) => p.effectiveFrom.getTime() <= s);
  if (anchor < 0) reasons.add("capture_history_incomplete");
  else if (
    prices
      .slice(anchor)
      .some(
        (p) => p.rateKobo !== input.rateKobo || p.currency !== input.currency,
      )
  )
    reasons.add("price_uncertain");
  const settings = input.settings
    .filter((p) => p.effectiveFrom.getTime() <= r)
    .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  let campaignEligible = false;
  if (settings.length) {
    const index = settings.findLastIndex((p) => p.effectiveFrom.getTime() <= s);
    if (index < 0) reasons.add("capture_history_incomplete");
    else {
      const applicable = settings.slice(index);
      const initial = applicable[0]!;
      const signature = (v: CampaignHistory) =>
        JSON.stringify([
          v.campaignId,
          v.purchaseStart,
          v.purchaseCutoff,
          v.uploadDeadline,
        ]);
      if (applicable.some((v) => signature(v) !== signature(initial)))
        reasons.add("capture_time_unresolved");
      for (const v of applicable) {
        if (
          v.purchaseStart &&
          s < v.purchaseStart.getTime() &&
          v.purchaseStart.getTime() <= r
        )
          reasons.add("capture_time_unresolved");
        // Purchase cutoff is inclusive; any later instant crosses the end.
        if (
          v.purchaseCutoff &&
          s <= v.purchaseCutoff.getTime() &&
          v.purchaseCutoff.getTime() < r
        )
          reasons.add("capture_time_unresolved");
      }
      campaignEligible =
        !!initial.campaignId &&
        !!initial.purchaseStart &&
        !!initial.purchaseCutoff &&
        !!initial.uploadDeadline &&
        s >= initial.purchaseStart.getTime() &&
        r <= initial.purchaseCutoff.getTime() &&
        r <= initial.uploadDeadline.getTime() &&
        !reasons.has("capture_time_unresolved");
    }
  }
  return { reasons: [...reasons], campaignEligible };
}
