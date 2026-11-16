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
  const orderedTiming = f.settings.filter(
    (s) => BigInt(trustedMicros(s.effective_from)) <= BigInt(I.U),
  );
  const timingAnchor = orderedTiming.findLastIndex(
    (s) => BigInt(trustedMicros(s.effective_from)) <= BigInt(I.L),
  );
  if (timingAnchor < 0) return insufficient();
  const applicableTiming = orderedTiming.slice(timingAnchor);
  if (
    applicableTiming.some(
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
  // Validate all relevant historical segments independently of whether a uniform
  // conclusion exists. A boundary is not permission to overlook missing audits.
  const points = new Set<string>([I.L, I.U]);
  for (const row of [...f.prices, ...f.assignments, ...f.settings]) {
    const at = trustedMicros(row.effective_from);
    if (BigInt(at) >= BigInt(I.L) && BigInt(at) <= BigInt(I.U)) points.add(at);
  }
  for (const at of points) {
    const point = { ...I, L: at, U: at };
    rules.price(f, point, false);
    if (!rules.authorization(f, point) || !rules.campaign(f, point))
      return insufficient();
  }
  if (f.card?.retirement_reason === "replaced") {
    const E = trustedMicros(f.card.retired_at);
    for (const at of [I.L, I.U])
      rules.card(
        f,
        { ...I, L: at, U: at },
        BigInt(at) < BigInt(E) ? "confirm_earlier" : "cancel",
      );
  }
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
  const boundaries: {
    kind: string;
    sourceId: string;
    sourceVersion: string;
    atMicros: string;
    changeAtMicros: string;
  }[] = [];
  const addBoundary = (
    kind: string,
    sourceId: string,
    at: unknown,
    changeAt?: string,
  ) => {
    const source = f.sources.find((s) => s.id === sourceId);
    if (!source) return insufficient();
    const atMicros = trustedMicros(at);
    boundaries.push({
      kind,
      sourceId,
      sourceVersion: source.version,
      atMicros,
      changeAtMicros: changeAt ?? atMicros,
    });
  };
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
          addBoundary("price_activation", p.id, p.effective_from);
      }
      admitted = boundaries.length > 0;
      if (body.outcome === "confirm") conclusions.push(rules.price(f, J));
      break;
    }
    case "card":
      if (!f.card?.retired_at || f.card.retirement_reason !== "replaced")
        return insufficient();
      admitted = boundary(f.card.retired_at);
      if (admitted)
        addBoundary("card_replacement", f.card.id, f.card.retired_at);
      if (body.outcome === "confirm")
        conclusions.push(rules.card(f, J, "confirm_earlier"));
      break;
    case "date":
      admitted = intervalDay(I.L, I.U) === null;
      if (admitted) {
        const day = 86400000000n,
          offset = 3600000000n;
        for (
          let midnight = ((BigInt(I.L) + offset) / day + 1n) * day - offset;
          midnight <= BigInt(I.U);
          midnight += day
        ) {
          const source = f.sources.find((s) => s.id === f.context.id);
          if (!source) return insufficient();
          boundaries.push({
            kind: "lagos_midnight",
            sourceId: f.context.id,
            sourceVersion: source.version,
            atMicros: String(midnight),
            changeAtMicros: String(midnight),
          });
        }
      }
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
      if (kinds.has("capture_authorization_unresolved")) {
        const assignment = f.assignment;
        if (boundary(assignment.effective_from))
          addBoundary(
            "assignment_started",
            assignment.id,
            assignment.effective_from,
          );
        if (assignment.effective_until && boundary(assignment.effective_until))
          addBoundary(
            "assignment_ended",
            assignment.id,
            assignment.effective_until,
          );
        if (f.context.revoked_at && boundary(f.context.revoked_at))
          addBoundary("context_revoked", f.context.id, f.context.revoked_at);
      }
      if (kinds.has("capture_time_unresolved")) {
        for (const settings of applicableTiming) {
          if (boundary(settings.effective_from))
            addBoundary(
              "campaign_settings_activated",
              settings.id,
              settings.effective_from,
            );
          for (const [field, kind] of [
            ["launch_at", "campaign_launched"],
            ["purchase_start", "campaign_started"],
          ] as const) {
            if (settings[field] && boundary(settings[field]))
              addBoundary(kind, settings.id, settings[field]);
          }
          const cutoff = BigInt(trustedMicros(settings.purchase_cutoff));
          if (cutoff >= BigInt(I.L) && cutoff < BigInt(I.U))
            addBoundary(
              "campaign_cutoff",
              settings.id,
              settings.purchase_cutoff,
              String(cutoff + 1n),
            );
        }
      }
      if (admitted && !boundaries.length) return insufficient();
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
