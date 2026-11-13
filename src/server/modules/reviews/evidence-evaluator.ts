import type pg from "pg";
import { lookupReceiptClaimsSchema } from "../../../shared/contracts/lookup-receipt";
import { stationDate } from "../../lib/time";
import { AuthError } from "../auth/errors";
import {
  fingerprint,
  priceAuditMatches,
  insufficient,
  resolveEvidenceSources,
  resolveReferenceClosure,
  trustedMicros,
} from "./evidence-resolvers";
import type {
  EvidenceInterval,
  EvidenceRequest,
  EvidenceEvaluation,
  ResolvedEvidence,
  TypedConclusion,
  Fact,
} from "./evidence-types";
export { recheckEvidenceSources } from "./evidence-resolvers";
export function intervalBounds(
  S: string,
  R: string,
  expiry: string,
  T: string | null,
): EvidenceInterval {
  const s = BigInt(S),
    r = BigInt(R),
    e = BigInt(expiry),
    t = T === null ? s : BigInt(T);
  const L = t > s ? t : s,
    U = r < e ? r : e;
  if (e < s || L > U) return insufficient();
  return { S, R, expiry, L: String(L), U: String(U), precision: "microsecond" };
}
/** Event histories are right-continuous; the upper endpoint is included. */
export function uniformSegments<T>(
  segments: { at: string; value: T }[],
  L: string,
  U: string,
): T | null {
  const ordered = [...segments]
    .filter((s) => BigInt(s.at) <= BigInt(U))
    .sort((a, b) =>
      BigInt(a.at) < BigInt(b.at) ? -1 : BigInt(a.at) > BigInt(b.at) ? 1 : 0,
    );
  if (ordered.some((s, i) => i > 0 && s.at === ordered[i - 1]!.at)) return null;
  const anchor = ordered.findLastIndex((s) => BigInt(s.at) <= BigInt(L));
  if (anchor < 0) return null;
  const value = ordered[anchor]!.value;
  return ordered
    .slice(anchor)
    .every((s) => JSON.stringify(s.value) === JSON.stringify(value))
    ? value
    : null;
}
export function cardRelation(
  L: string,
  U: string,
  E: string,
  R: string,
): "before" | "after" | null {
  if (BigInt(E) > BigInt(R)) return null;
  return BigInt(U) < BigInt(E)
    ? "before"
    : BigInt(L) >= BigInt(E)
      ? "after"
      : null;
}
export function intervalDay(L: string, U: string): string | null {
  const day = (s: string) => stationDate(new Date(Number(BigInt(s) / 1000n)));
  return day(L) === day(U) ? day(L) : null;
}
function completeVersions(history: Fact[], field = "version") {
  if (!history.length) return insufficient();
  for (let i = 0; i < history.length; i++) {
    if (history[i]![field] !== i + 1) return insufficient();
    if (
      i &&
      BigInt(trustedMicros(history[i]!.effective_from)) <=
        BigInt(trustedMicros(history[i - 1]!.effective_from))
    )
      return insufficient();
  }
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function intervalFor(f: ResolvedEvidence): {
  interval: EvidenceInterval;
  lookup: EvidenceEvaluation["lookup"];
} {
  const p = f.original,
    c = f.context;
  const S = trustedMicros(c.signed_in_at),
    R = trustedMicros(p.server_received_at),
    expiry = trustedMicros(c.offline_expires_at);
  let T: string | null = null;
  if (p.lookup_receipt_status === "valid") {
    const parsed = lookupReceiptClaimsSchema.safeParse(p.lookup_receipt_claims);
    const v: Record<string, unknown> = parsed.success ? parsed.data : {},
      link = f.links.find((l) => l.id === v.cardCustomerLinkId);
    // Frozen database verification, not current token signature or session state.
    if (
      v.captureContextId === c.id &&
      v.originatingAccountId === p.originating_attendant_id &&
      v.stationId === p.station_id &&
      v.cardId === p.card_id &&
      v.cardCode === p.card_code &&
      v.customerId === p.customer_id &&
      link &&
      link.customer_id === p.customer_id &&
      trustedMicros(v.expiresAt) === expiry
    ) {
      const t = trustedMicros(v.issuedAt);
      if (
        BigInt(t) >= BigInt(S) &&
        BigInt(t) < BigInt(expiry) &&
        BigInt(t) <= BigInt(R) &&
        BigInt(trustedMicros(link.linked_at)) <= BigInt(t) &&
        trustedMicros(p.capture_lower_bound) === t
      )
        T = t;
    }
  }
  return {
    interval: intervalBounds(S, R, expiry, T),
    lookup:
      T === null
        ? { status: "fallback", id: null, version: null }
        : {
            status: "frozen",
            id: p.id + ":lookup",
            version: String(p.capture_policy_version),
          },
  };
}
function price(
  f: ResolvedEvidence,
  i: EvidenceInterval,
  requireCaptured = true,
): TypedConclusion {
  const p = f.original;
  completeVersions(f.prices);
  const captured = f.prices.find((v) => v.id === p.price_version_id);
  if (
    !captured ||
    captured.rate_kobo !== p.rate_kobo ||
    captured.currency !== p.currency ||
    captured.quantity_precision !== p.quantity_precision
  )
    return insufficient();
  const value = uniformSegments(
    f.prices.map((v) => ({
      at: trustedMicros(v.effective_from),
      value: [v.rate_kobo, v.currency],
    })),
    i.L,
    i.U,
  );
  if (
    !value ||
    (requireCaptured && value[0] !== p.rate_kobo) ||
    value[1] !== p.currency ||
    BigInt(String(value[0])) <= 0n
  )
    return insufficient();
  const active = f.prices.filter(
    (v) => BigInt(trustedMicros(v.effective_from)) <= BigInt(i.U),
  );
  const anchor = active.findLastIndex(
    (v) => BigInt(trustedMicros(v.effective_from)) <= BigInt(i.L),
  );
  const segments = active.slice(anchor);
  const auditIds: string[] = [];
  for (const v of segments) {
    const matches = f.audits.filter((a) => {
      return (
        a.action === "price_activated" &&
        a.target_id === p.product_id &&
        priceAuditMatches(a, v)
      );
    });
    if (matches.length !== 1) return insufficient();
    auditIds.push(matches[0]!.id);
  }
  return {
    tag: "price_valid_throughout",
    rateKobo: String(value[0]),
    currency: String(p.currency),
    priceSegments: segments.map((v) => v.id),
    precision: "microsecond",
    interval: i,
    sourceIds: [p.id, captured.id, ...segments.map((v) => v.id), ...auditIds],
  };
}
function card(
  f: ResolvedEvidence,
  i: EvidenceInterval,
  outcome: string,
): TypedConclusion {
  const p = f.original,
    c = f.card;
  if (
    !c ||
    c.retirement_reason !== "replaced" ||
    !c.replaced_by_card_id ||
    !c.retired_at
  )
    throw new AuthError("policy_review_required", 422);
  if (f.links.length !== 1) return insufficient();
  const l = f.links[0]!;
  if (
    l.customer_id !== p.customer_id ||
    !l.ended_at ||
    trustedMicros(l.ended_at) !== trustedMicros(c.retired_at) ||
    BigInt(trustedMicros(l.linked_at)) > BigInt(i.L)
  )
    return insufficient();
  const E = trustedMicros(c.retired_at),
    relation = cardRelation(i.L, i.U, E, i.R);
  if (
    (outcome === "cancel" && relation !== "after") ||
    (outcome === "confirm_earlier" && relation !== "before")
  )
    return insufficient();
  const matches = f.audits.filter((a) => {
    const before = record(a.before),
      after = record(a.after);
    return (
      ["card_replaced", "card_replacement"].includes(String(a.action)) &&
      a.target_id === c.id &&
      (before.customerId === p.customer_id ||
        after.customerId === p.customer_id) &&
      (after.newCardId === c.replaced_by_card_id ||
        after.replacedByCardId === c.replaced_by_card_id ||
        after.replacementCardId === c.replaced_by_card_id) &&
      trustedMicros(a.occurred_at) === E
    );
  });
  if (matches.length !== 1) return insufficient();
  return {
    tag:
      relation === "before"
        ? "card_before_replacement"
        : "card_after_replacement",
    cardId: c.id,
    customerId: String(p.customer_id),
    linkId: l.id,
    replacementAt: E,
    precision: "microsecond",
    interval: i,
    sourceIds: [p.id, c.id, l.id, matches[0]!.id],
  };
}
function authorization(
  f: ResolvedEvidence,
  i: EvidenceInterval,
): TypedConclusion | null {
  completeVersions(f.assignments, "assignment_version");
  for (let n = 0; n < f.assignments.length - 1; n++) {
    const a = f.assignments[n]!,
      b = f.assignments[n + 1]!;
    if (
      !a.effective_until ||
      BigInt(trustedMicros(a.effective_until)) >
        BigInt(trustedMicros(b.effective_from))
    )
      return insufficient();
  }
  const a = f.assignment,
    c = f.context,
    p = f.original;
  const start = BigInt(trustedMicros(a.effective_from));
  const ends = [a.effective_until, c.revoked_at]
    .filter((x) => x !== null && x !== undefined)
    .map((x) => BigInt(trustedMicros(x)));
  const end = ends.length ? ends.reduce((x, y) => (x < y ? x : y)) : null;
  const yes = start <= BigInt(i.L) && (end === null || end > BigInt(i.U));
  const no = start > BigInt(i.U) || (end !== null && end <= BigInt(i.L));
  if (!yes && !no) return null;
  return {
    tag: yes
      ? "capture_authorized_throughout"
      : "capture_unauthorized_throughout",
    accountId: String(p.originating_attendant_id),
    contextId: c.id,
    stationId: String(p.station_id),
    pumpId: String(p.pump_id),
    productId: String(p.product_id),
    precision: "microsecond",
    interval: i,
    sourceIds: [p.id, c.id, ...f.assignments.map((x) => x.id)],
  };
}
function campaign(
  f: ResolvedEvidence,
  i: EvidenceInterval,
): TypedConclusion | null {
  completeVersions(f.settings);
  const at = (v: Fact) => BigInt(trustedMicros(v.effective_from));
  const history = f.settings.filter((v) => at(v) <= BigInt(i.U));
  const anchor = history.findLastIndex((v) => at(v) <= BigInt(i.L));
  if (anchor < 0) return null;
  const applicable = history.slice(anchor);
  let answer: boolean | undefined;
  for (let n = 0; n < applicable.length; n++) {
    const v = applicable[n]!;
    if (
      !v.campaign_id ||
      !v.purchase_start ||
      !v.purchase_cutoff ||
      !v.upload_deadline ||
      v.timezone !== "Africa/Lagos"
    )
      return null;
    const lo = at(v) > BigInt(i.L) ? at(v) : BigInt(i.L);
    const next = applicable[n + 1],
      hi = next ? at(next) - 1n : BigInt(i.U);
    const start = BigInt(trustedMicros(v.purchase_start)),
      cutoff = BigInt(trustedMicros(v.purchase_cutoff));
    if (start > cutoff || BigInt(trustedMicros(v.upload_deadline)) < cutoff)
      return null;
    const inside = lo >= start && hi <= cutoff;
    const outside = hi < start || lo > cutoff;
    if (!inside && !outside) return null;
    if (answer !== undefined && answer !== inside) return null;
    answer = inside;
  }
  if (answer === undefined) return null;
  return {
    tag: "campaign_membership_uniform",
    campaignIds: [...new Set(applicable.map((v) => String(v.campaign_id)))],
    configurationIds: applicable.map((v) => v.id),
    inside: answer,
    precision: "microsecond",
    interval: i,
    sourceIds: [f.original.id, ...applicable.map((v) => v.id)],
  };
}
function date(
  f: ResolvedEvidence,
  i: EvidenceInterval,
  day?: string,
): TypedConclusion {
  const actual = intervalDay(i.L, i.U);
  const configured = f.settings
    .filter((v) => BigInt(trustedMicros(v.effective_from)) <= BigInt(i.U))
    .at(-1);
  if (
    !configured ||
    configured.timezone !== "Africa/Lagos" ||
    !actual ||
    day !== actual ||
    actual > intervalDay(i.R, i.R)!
  )
    return insufficient();
  return {
    tag: "sale_day",
    day: actual,
    timezone: "Africa/Lagos",
    precision: "day",
    interval: i,
    sourceIds: [f.original.id, f.context.id, configured.id],
  };
}
const evaluators = { price, card, date, capture: { authorization, campaign } };
export function reviewEvidenceV1Installed() {
  return (
    typeof evaluators.price === "function" &&
    typeof evaluators.card === "function" &&
    typeof evaluators.date === "function" &&
    typeof evaluators.capture.authorization === "function" &&
    typeof evaluators.capture.campaign === "function"
  );
}
export async function evaluateEvidenceV1(
  db: pg.PoolClient,
  request: EvidenceRequest,
): Promise<EvidenceEvaluation> {
  return evaluate(db, request, false);
}
/** P-26 reuses the unchanged P-25 source closure and bounds, but proves a uniform historical rate. */
export async function evaluateMeterHistory(
  db: pg.PoolClient,
  request: EvidenceRequest,
): Promise<EvidenceEvaluation> {
  return evaluate(db, request, true);
}
async function evaluate(
  db: pg.PoolClient,
  request: EvidenceRequest,
  meter: boolean,
): Promise<EvidenceEvaluation> {
  if (request.outcome === "correct_meter" && !meter)
    throw new AuthError("meter_policy_unconfigured", 409);
  if (request.kind === "price" && request.outcome === "cancel")
    return insufficient();
  const f = await resolveEvidenceSources(
    db,
    request.purchaseId,
    request.evidence.assetId,
  );
  if (request.policy.scope.stationId !== f.original.station_id)
    return insufficient();
  await resolveReferenceClosure(
    db,
    f,
    request.evidence.referenceIds,
    request.decisionId,
  );
  const { interval, lookup } = intervalFor(f);
  const conclusions: TypedConclusion[] = [];
  const result: EvidenceEvaluation = {
    policyVersion: "review-evidence-v1",
    referenceIds: [...request.evidence.referenceIds],
    interval,
    lookup,
    sources: f.sources,
    conclusions,
    historyGeneration: f.historyGeneration,
  };
  if (request.kind === "price") {
    conclusions.push(price(f, interval, !meter));
    result.validPrice = true;
  } else if (request.kind === "card") {
    const c = card(f, interval, request.outcome);
    conclusions.push(c);
    if (c.tag === "card_before_replacement") result.beforeReplacement = true;
    else result.invalidSale = true;
  } else if (request.kind === "date") {
    const c = date(f, interval, request.verifiedSaleDate);
    conclusions.push(c);
    result.verifiedSaleDate = request.verifiedSaleDate;
  } else {
    const blocks = (
      await db.query<{ code: string }>(
        "SELECT code FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL AND code IN ('capture_authorization_unresolved','capture_time_unresolved') ORDER BY code",
        [request.purchaseId],
      )
    ).rows;
    if (!blocks.length) return insufficient();
    if (request.outcome === "cancel") {
      const a = authorization(f, interval);
      if (a?.tag !== "capture_unauthorized_throughout") return insufficient();
      conclusions.push(a);
      result.invalidSale = true;
    } else
      for (const b of blocks) {
        if (b.code === "capture_authorization_unresolved") {
          const a = authorization(f, interval);
          if (a?.tag !== "capture_authorized_throughout") return insufficient();
          conclusions.push(a);
          result.authorizedCapture = true;
        } else {
          const c = campaign(f, interval);
          if (!c || c.tag !== "campaign_membership_uniform")
            return insufficient();
          conclusions.push(c);
          result.campaignEligible = c.inside;
        }
      }
  }
  // Prior conclusions must reproduce under the active policy, same original interval,
  // exact tagged precision and current complete history. Approval itself is not proof.
  for (const d of f.derived) {
    const p = record(d.provenance),
      policy = record(p.policy),
      target = record(p.target);
    if (
      policy.release !== request.policy.release ||
      policy.digest !== request.policy.digest ||
      fingerprint(p.interval) !== fingerprint(interval) ||
      typeof target.evaluatedRevisionId !== "string"
    )
      return insufficient();
    const previousSources = p.sources as { id: string; category: string }[];
    // A conclusion cannot omit ancestors just because its visible value happens
    // to reproduce. All automatically required original history remains closure.
    if (
      f.sources
        .filter((s) => s.category !== "derived_evidence")
        .some(
          (s) =>
            !previousSources.some(
              (old) => old.id === s.id && old.category === s.category,
            ),
        )
    )
      return insufficient();
    for (const conclusion of p.conclusions as TypedConclusion[]) {
      if (
        !Array.isArray(conclusion.sourceIds) ||
        conclusion.sourceIds.some(
          (id) => !previousSources.some((s) => s.id === id),
        )
      )
        return insufficient();
    }
    const bound = await db.query(
      "SELECT id FROM purchase_revision WHERE id=$1 AND purchase_id=$2",
      [target.evaluatedRevisionId, request.purchaseId],
    );
    if (!bound.rowCount) return insufficient();
    for (const previous of p.conclusions as TypedConclusion[]) {
      let reproduced: TypedConclusion | null;
      switch (previous.tag) {
        case "price_valid_throughout":
          reproduced = price(f, interval);
          break;
        case "card_before_replacement":
          reproduced = card(f, interval, "confirm_earlier");
          break;
        case "card_after_replacement":
          reproduced = card(f, interval, "cancel");
          break;
        case "sale_day":
          reproduced = date(f, interval, previous.day);
          break;
        case "capture_authorized_throughout":
        case "capture_unauthorized_throughout":
          reproduced = authorization(f, interval);
          break;
        case "campaign_membership_uniform":
          reproduced = campaign(f, interval);
          break;
        default:
          return insufficient();
      }
      if (!reproduced || fingerprint(reproduced) !== fingerprint(previous))
        return insufficient();
    }
    f.sources.push({
      category: "derived_evidence",
      id: d.id,
      version: "1",
      recordedAt: String(d.created_at),
      scope: {
        purchaseId: request.purchaseId,
        stationId: request.policy.scope.stationId,
      },
      dependencies: (p.sources as { id: string }[]).map((s) => s.id),
      snapshot: {
        policy: p.policy,
        interval: p.interval,
        conclusions: p.conclusions,
        target: p.target,
      },
    });
  }
  return result;
}
