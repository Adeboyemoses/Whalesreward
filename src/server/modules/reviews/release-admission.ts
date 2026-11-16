import type pg from "pg";
import type { ReleaseProposalInput } from "../../../shared/contracts/held-release";
import { AuthError } from "../auth/errors";
import { resolveEvidenceSources, trustedMicros } from "./evidence-resolvers";
import {
  releaseEvidencePredicates as rules,
  intervalDay,
} from "./evidence-evaluator";
import type { TypedConclusion } from "./evidence-types";

const insufficient = (): never => {
  throw new AuthError("evidence_insufficient", 422);
};
/** The caller supplies no reference subset. All applicable original sources are loaded. */
export async function classifyReleaseAdmission(
  db: pg.PoolClient,
  purchaseId: string,
  body: ReleaseProposalInput,
) {
  const f = await resolveEvidenceSources(db, purchaseId, body.meterAssetId);
  const { interval: I } = rules.intervalFor(f);
  if (!f.original.customer_id || !f.settings.length) return insufficient();
  rules.completeVersions(f.prices);
  rules.completeVersions(f.assignments, "assignment_version");
  rules.completeVersions(f.settings, "timing_history_version");
  if (
    f.settings.some(
      (s) =>
        s.timing_history_complete !== true ||
        !s.campaign_id ||
        !s.purchase_start ||
        !s.purchase_cutoff ||
        !s.upload_deadline ||
        BigInt(trustedMicros(s.upload_deadline)) < BigInt(I.R),
    )
  )
    return insufficient();
  const from = BigInt(trustedMicros(body.facts.observedCapture.from));
  const through = BigInt(trustedMicros(body.facts.observedCapture.through));
  const J = {
    ...I,
    L: String(from > BigInt(I.L) ? from : BigInt(I.L)),
    U: String(through < BigInt(I.U) ? through : BigInt(I.U)),
  };
  if (BigInt(J.L) > BigInt(J.U)) return insufficient();
  const boundary = (at: unknown) => {
    const t = BigInt(trustedMicros(at));
    return t > BigInt(I.L) && t <= BigInt(I.U);
  };
  let admitted = false;
  const boundaries: string[] = [];
  const conclusions: TypedConclusion[] = [];
  switch (body.target.kind) {
    case "price": {
      const anchor = f.prices.findLastIndex(
        (p) => BigInt(trustedMicros(p.effective_from)) <= BigInt(I.L),
      );
      if (anchor < 0) return insufficient();
      for (let n = anchor + 1; n < f.prices.length; n++) {
        const p = f.prices[n]!,
          previous = f.prices[n - 1]!;
        if (boundary(p.effective_from) && p.rate_kobo !== previous.rate_kobo)
          boundaries.push(p.id);
      }
      admitted = boundaries.length > 0;
      if (body.outcome === "confirm") conclusions.push(rules.price(f, J));
      break;
    }
    case "card":
      if (!f.card?.retired_at || f.card.retirement_reason !== "replaced")
        return insufficient();
      admitted = boundary(f.card.retired_at);
      boundaries.push(f.card.id);
      if (body.outcome === "confirm")
        conclusions.push(rules.card(f, J, "confirm_earlier"));
      break;
    case "date":
      admitted = intervalDay(I.L, I.U) === null;
      boundaries.push(f.context.id);
      if (body.outcome === "confirm")
        conclusions.push(rules.date(f, J, intervalDay(J.L, J.U) ?? undefined));
      break;
    case "capture": {
      const authorization = rules.authorization(f, I),
        campaign = rules.campaign(f, I);
      if (authorization?.tag === "capture_unauthorized_throughout")
        throw new AuthError("release_not_required", 409);
      const kinds = new Set(body.target.blocks.map((b) => b.code));
      admitted =
        (kinds.has("capture_authorization_unresolved") &&
          authorization === null) ||
        (kinds.has("capture_time_unresolved") && campaign === null);
      boundaries.push(
        ...f.assignments
          .filter((a) => boundary(a.effective_from))
          .map((a) => a.id),
      );
      if (body.outcome === "confirm")
        for (const b of body.target.blocks) {
          const c =
            b.code === "capture_authorization_unresolved"
              ? rules.authorization(f, J)
              : rules.campaign(f, J);
          if (!c || c.tag === "capture_unauthorized_throughout")
            return insufficient();
          conclusions.push(c);
        }
      break;
    }
  }
  if (!admitted) throw new AuthError("release_not_required", 409);
  if (
    body.outcome === "cancel"
      ? body.facts.finding !== "entry_marked_void"
      : body.facts.finding !== "sale_recorded"
  )
    return insufficient();
  return {
    originalInterval: I,
    attestedInterval: J,
    boundaries,
    conclusions,
    sources: f.sources,
    historyGeneration: f.historyGeneration,
    original: f.original,
  };
}
