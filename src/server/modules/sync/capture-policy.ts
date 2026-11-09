/** P-23 refines P-20/P-18; provisional pending Q-528. No app/UUID/EXIF time enters this policy. */
export const CAPTURE_POLICY_VERSION = 3;
/** Exact integer epoch microseconds from PostgreSQL EXTRACT, never a JS Date. */
export type TrustedMicros = string;
const micros = (value: TrustedMicros): bigint => BigInt(value);
const compare = (a: TrustedMicros, b: TrustedMicros) =>
  micros(a) < micros(b) ? -1 : micros(a) > micros(b) ? 1 : 0;
export type PriceHistory = {
  effectiveFrom: TrustedMicros;
  rateKobo: string;
  currency: string;
};
export type CampaignHistory = {
  effectiveFrom: TrustedMicros;
  purchaseStart: TrustedMicros | null;
  purchaseCutoff: TrustedMicros | null;
  uploadDeadline: TrustedMicros | null;
  campaignId: string | null;
};
export type CapturePolicyInput = {
  signedInAt: TrustedMicros;
  lowerBound?: TrustedMicros;
  cardLink?: {
    linkedAt: TrustedMicros;
    endedAt: TrustedMicros | null;
    customerMatches: boolean;
    endedByReplacement?: boolean;
  } | null;
  receivedAt: TrustedMicros;
  offlineExpiresAt: TrustedMicros;
  contextRevokedAt: TrustedMicros | null;
  assignment: {
    effectiveFrom: TrustedMicros;
    effectiveUntil: TrustedMicros | null;
  };
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
  const originalS = micros(input.signedInAt);
  const s = micros(input.lowerBound ?? input.signedInAt),
    r = micros(input.receivedAt),
    expiry = micros(input.offlineExpiresAt);
  // Receipt can follow reauthentication; capture remains bounded by its original context.
  const u = r < expiry ? r : expiry;
  if (s < originalS || u < s)
    return { reasons: ["capture_history_incomplete"], campaignEligible: false };
  if (input.cardLink !== undefined) {
    const link = input.cardLink;
    // A replacement has its own resolvable hold; do not add an unresolvable
    // generic reason for that same ending. Independent bad history still blocks.
    if (!link || !link.customerMatches || micros(link.linkedAt) > s)
      reasons.add("card_policy_unresolved");
    if (link && link.endedAt !== null && micros(link.endedAt) <= r)
      reasons.add(
        link.endedByReplacement ? "replaced_card" : "card_policy_unresolved",
      );
  }
  if (
    micros(input.assignment.effectiveFrom) > s ||
    (input.assignment.effectiveUntil !== null &&
      micros(input.assignment.effectiveUntil) <= u) ||
    (input.contextRevokedAt !== null && micros(input.contextRevokedAt) <= u)
  )
    reasons.add("capture_authorization_unresolved");
  const prices = input.prices
    .filter((p) => micros(p.effectiveFrom) <= u)
    .sort((a, b) => compare(a.effectiveFrom, b.effectiveFrom));
  const anchor = prices.findLastIndex((p) => micros(p.effectiveFrom) <= s);
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
    .filter((p) => micros(p.effectiveFrom) <= u)
    .sort((a, b) => compare(a.effectiveFrom, b.effectiveFrom));
  let campaignEligible = false;
  if (settings.length) {
    const index = settings.findLastIndex((p) => micros(p.effectiveFrom) <= s);
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
          s < micros(v.purchaseStart) &&
          micros(v.purchaseStart) <= u
        )
          reasons.add("capture_time_unresolved");
        // Purchase cutoff is inclusive; any later instant crosses the end.
        if (
          v.purchaseCutoff &&
          s <= micros(v.purchaseCutoff) &&
          micros(v.purchaseCutoff) < u
        )
          reasons.add("capture_time_unresolved");
      }
      campaignEligible =
        !!initial.campaignId &&
        !!initial.purchaseStart &&
        !!initial.purchaseCutoff &&
        !!initial.uploadDeadline &&
        s >= micros(initial.purchaseStart) &&
        u <= micros(initial.purchaseCutoff) &&
        r <= micros(initial.uploadDeadline) &&
        reasons.size === 0;
    }
  }
  return { reasons: [...reasons], campaignEligible };
}
