/** Immutable reviewed UTF-8 artifact. Changes to these bytes require a new release. */
export const reviewEvidenceReleaseArtifact = `review-evidence-v1
interval: closed [max(original-sign-in,frozen-valid-lookup),min(first-durable-receipt,original-offline-expiry)]; invalid/missing lookup falls back to original-sign-in; stored precision
resolvers: original_purchase,capturing_context,frozen_lookup_verification,price_history,card_history,assignment_history,campaign_history,domain_audit,validated_photo,derived_evidence
sources: immutable identity/version, trusted recorded time, original scope, complete histories; derived closure is bounded, same-sale, reproducible, acyclic, precision-preserving
price.accept_captured: captured rate/currency throughout interval; preserve captured precision and numeric candidate
price.cancel: deny evidence_insufficient
price.correct_meter: deny meter_policy_unconfigured
card.confirm_earlier: historical same customer/link, responsible replacement E<=R, U<E
card.cancel: historical same customer/link, responsible replacement E<=R, L>=E
date.verify_date: entire interval in submitted Africa/Lagos day no later than receipt day
capture.confirm: every authorization block uniformly authorized; every timing block uniformly inside or outside configured campaign
capture.cancel: uniformly unauthorized; outside campaign alone insufficient
conclusions: price_valid_throughout(rate,currency,priceSegments,intervalPrecision); card_before_replacement/card_after_replacement(oldCard,customer,link,E,intervalPrecision); sale_day(D,timezone,dayPrecision); capture_authorized_throughout/capture_unauthorized_throughout(originalAccount,context,station,pump,product,intervalPrecision); campaign_membership_uniform(campaign,configuration,insideOrOutside,intervalPrecision)
all conclusions bind source IDs and interval; photos require retained validated bytes; notes/client assertions never prove facts; existing authority, versions and independent gates remain mandatory
`;
export const reviewEvidenceKinds = [
  "price",
  "card",
  "date",
  "capture",
] as const;
