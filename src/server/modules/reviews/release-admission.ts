import type pg from "pg";
import type {
  ReleaseProposalInput,
  ReleaseTarget,
  StructuralAdmission,
} from "../../../shared/contracts/held-release";
import { parseQuantity } from "../../../shared/quantity";
import { AuthError } from "../auth/errors";
import { resolveEvidenceSources, trustedMicros } from "./evidence-resolvers";
import {
  releaseEvidencePredicates as rules,
  intervalDay,
} from "./evidence-evaluator";
import { releaseSaleMutations as sale } from "./service";
import type { TypedConclusion } from "./evidence-types";

type NegativeReason = Extract<
  StructuralAdmission,
  { state: "not_admissible" }
>["reason"];
class StructuralExclusion extends Error {
  constructor(readonly reason: NegativeReason) {
    super(reason);
  }
}
const exclude = (reason: NegativeReason): never => {
  throw new StructuralExclusion(reason);
};
const insufficient = (): never => {
  throw new AuthError("evidence_insufficient", 422);
};
/** The caller supplies no reference subset. All applicable original sources are loaded. */
async function structural(
  db: pg.PoolClient,
  purchaseId: string,
  target: ReleaseTarget,
  meterAssetId: string,
) {
  const f = await resolveEvidenceSources(db, purchaseId, meterAssetId, false);
  if (!f.original.customer_id) return exclude("history_incomplete");
  if (!f.settings.length) return exclude("campaign_unconfigured");
  for (const [history, field] of [
    [f.prices, "version"],
    [f.assignments, "assignment_version"],
    [f.settings, "timing_history_version"],
  ] as const) {
    if (!history.length || history.some((row, i) => row[field] !== i + 1))
      return exclude("history_incomplete");
    if (
      history.some(
        (row, i) =>
          i > 0 &&
          BigInt(trustedMicros(row.effective_from)) <=
            BigInt(trustedMicros(history[i - 1]!.effective_from)),
      )
    )
      return exclude("history_contradictory");
  }
  if (
    f.assignments.some(
      (row, i) =>
        i < f.assignments.length - 1 &&
        (!row.effective_until ||
          BigInt(trustedMicros(row.effective_until)) >
            BigInt(trustedMicros(f.assignments[i + 1]!.effective_from))),
    )
  )
    return exclude("history_contradictory");
  let I;
  try {
    I = rules.intervalFor(f).interval;
  } catch (e) {
    if (e instanceof AuthError) return exclude("invalid_capture_bounds");
    throw e;
  }
  const orderedTiming = f.settings.filter(
    (s) => BigInt(trustedMicros(s.effective_from)) <= BigInt(I.U),
  );
  const timingAnchor = orderedTiming.findLastIndex(
    (s) => BigInt(trustedMicros(s.effective_from)) <= BigInt(I.L),
  );
  if (timingAnchor < 0) return insufficient();
  const applicableTiming = orderedTiming.slice(timingAnchor);
  if (applicableTiming.some((s) => s.timing_history_complete !== true))
    return exclude("history_incomplete");
  if (
    applicableTiming.some(
      (s) =>
        !s.campaign_id ||
        !s.purchase_start ||
        !s.purchase_cutoff ||
        !s.upload_deadline,
    )
  )
    return exclude("campaign_unconfigured");
  if (
    applicableTiming.some(
      (s) =>
        BigInt(trustedMicros(s.purchase_start)) >
          BigInt(trustedMicros(s.purchase_cutoff)) ||
        BigInt(trustedMicros(s.upload_deadline)) <
          BigInt(trustedMicros(s.purchase_cutoff)),
    )
  )
    return exclude("history_contradictory");
  const afterDeadline = applicableTiming.some(
    (s) => BigInt(trustedMicros(s.upload_deadline)) < BigInt(I.R),
  );
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
  if (afterDeadline) return exclude("receipt_after_deadline");
  if (f.photo.state !== "validated")
    return exclude("original_evidence_unavailable");
  if (target.kind === "card" && f.card?.retirement_reason !== "replaced")
    return exclude("unsupported_retirement");
  const p = (await db.query("SELECT * FROM purchase WHERE id=$1", [purchaseId]))
    .rows[0];
  const candidate = await sale.candidate(db, p);
  const incompatible =
    target.kind === "price" &&
    (candidate.values.amountKobo !== f.original.amount_kobo ||
      parseQuantity(candidate.values.quantity) !==
        parseQuantity(String(f.original.quantity)) ||
      candidate.values.rateKobo !== f.original.rate_kobo ||
      candidate.values.calculation !== "captured_rate");
  const otherBlocks = (
    await db.query(
      "SELECT id FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL AND code NOT IN ('capture_authorization_unresolved','capture_time_unresolved')",
      [purchaseId],
    )
  ).rowCount;
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
  switch (target.kind) {
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
      break;
    }
    case "card":
      if (!f.card?.retired_at || f.card.retirement_reason !== "replaced")
        return insufficient();
      admitted = boundary(f.card.retired_at);
      if (admitted)
        addBoundary("card_replacement", f.card.id, f.card.retired_at);
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
      break;
    case "capture": {
      const authorization = rules.authorization(f, I),
        campaign = rules.campaign(f, I);
      if (authorization?.tag === "capture_unauthorized_throughout")
        throw new AuthError("release_not_required", 409);
      const kinds = new Set(target.blocks.map((b) => b.code));
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
      break;
    }
  }
  if (!admitted) {
    let ordinary = false;
    try {
      if (target.kind === "price") {
        rules.price(f, I, false);
        ordinary = true;
      } else if (target.kind === "date") {
        rules.date(f, I, intervalDay(I.L, I.U) ?? undefined);
        ordinary = true;
      } else if (target.kind === "card") {
        for (const outcome of ["confirm_earlier", "cancel"]) {
          try {
            rules.card(f, I, outcome);
            ordinary = true;
          } catch (e) {
            if (!(e instanceof AuthError)) throw e;
          }
        }
      } else if (target.kind === "capture") {
        const authorization = rules.authorization(f, I);
        ordinary =
          authorization?.tag === "capture_unauthorized_throughout" ||
          target.blocks.every((b) =>
            b.code === "capture_authorization_unresolved"
              ? authorization?.tag === "capture_authorized_throughout"
              : rules.campaign(f, I) !== null,
          );
      }
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
    }
    if (ordinary) throw new AuthError("release_not_required", 409);
    return exclude("no_material_boundary");
  }
  if (incompatible) return exclude("candidate_incompatible");
  if (otherBlocks) return exclude("other_policy_block");
  return { f, I, boundaries };
}

/** One structural algorithm shared by preparation, creation and approval. No sheet facts. */
export async function classifyReleaseStructure(
  db: pg.PoolClient,
  purchaseId: string,
  target: ReleaseTarget,
  meterAssetId: string,
): Promise<{
  admission: StructuralAdmission;
  evaluation?: Awaited<ReturnType<typeof structural>>;
}> {
  try {
    const evaluation = await structural(db, purchaseId, target, meterAssetId);
    return {
      admission: {
        state: "structurally_admissible",
        reason: "temporal_boundary",
      },
      evaluation,
    };
  } catch (error) {
    if (error instanceof StructuralExclusion)
      return { admission: { state: "not_admissible", reason: error.reason } };
    if (!(error instanceof AuthError)) throw error;
    if (error.code === "release_not_required")
      return {
        admission: {
          state: "ordinary_review_required",
          reason: "v1_settleable",
        },
      };
    if (error.code === "evidence_unavailable")
      return {
        admission: {
          state: "not_admissible",
          reason: "original_evidence_unavailable",
        },
      };
    if (error.code === "policy_review_required")
      return {
        admission: {
          state: "not_admissible",
          reason: "unsupported_retirement",
        },
      };
    if (error.code === "evidence_insufficient")
      return {
        admission: { state: "not_admissible", reason: "history_incomplete" },
      };
    throw error;
  }
}

export async function classifyReleaseAdmission(
  db: pg.PoolClient,
  purchaseId: string,
  body: ReleaseProposalInput,
) {
  const result = await classifyReleaseStructure(
    db,
    purchaseId,
    body.target,
    body.meterAssetId,
  );
  if (result.admission.state === "ordinary_review_required")
    throw new AuthError("release_not_required", 409);
  if (!result.evaluation) return insufficient();
  const { f, I, boundaries } = result.evaluation;
  const conclusions: TypedConclusion[] = [];
  const from = BigInt(trustedMicros(body.facts.observedCapture.from));
  const through = BigInt(trustedMicros(body.facts.observedCapture.through));
  const J = {
    ...I,
    L: String(from > BigInt(I.L) ? from : BigInt(I.L)),
    U: String(through < BigInt(I.U) ? through : BigInt(I.U)),
  };
  if (BigInt(J.L) > BigInt(J.U)) return insufficient();
  if (body.outcome === "confirm") {
    switch (body.target.kind) {
      case "price":
        conclusions.push(rules.price(f, J));
        break;
      case "card":
        conclusions.push(rules.card(f, J, "confirm_earlier"));
        break;
      case "date":
        conclusions.push(rules.date(f, J, intervalDay(J.L, J.U) ?? undefined));
        break;
      case "capture":
        for (const b of body.target.blocks) {
          const conclusion =
            b.code === "capture_authorization_unresolved"
              ? rules.authorization(f, J)
              : rules.campaign(f, J);
          if (
            !conclusion ||
            conclusion.tag === "capture_unauthorized_throughout"
          )
            return insufficient();
          conclusions.push(conclusion);
        }
    }
  }

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
