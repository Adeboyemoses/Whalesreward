import type pg from "pg";
import type { CheckOutcome } from "../../../shared/contracts/giveaway-projections";
import type { ProjectionContext } from "./projection-context";
import { readiness } from "./readiness";
import { managers, attendants, phones } from "./projection-selections";
export async function outcomes(db: pg.PoolClient, ctx: ProjectionContext) {
  const { c, actor } = ctx,
    ready = await readiness(db, c, actor.admin_id);
  ready.view.asOf = c.projection_as_of;
  if (
    !actor.permissions.includes(
      ctx.kind === "initial" ? "giveawayFinalize" : "giveawayRevise",
    )
  ) {
    ready.view.canPrepare = false;
    ready.view.canConfirm = false;
  }
  const history = (
    await db.query(
      `SELECT (SELECT count(DISTINCT purchase_id)::text FROM purchase_hold WHERE purchase_id=ANY($1::uuid[])) holds,(SELECT count(DISTINCT purchase_id)::text FROM correction_request WHERE purchase_id=ANY($1::uuid[])) corrections,(SELECT count(DISTINCT purchase_id)::text FROM duplicate_flag WHERE purchase_id=ANY($1::uuid[]) OR other_purchase_id=ANY($1::uuid[])) duplicates,(SELECT count(DISTINCT purchase_id)::text FROM held_release_proposal WHERE station_id=$2) proposals`,
      [ready.relevant, c.station_id],
    )
  ).rows[0];
  const checks: CheckOutcome[] = [];
  function row(
    name: CheckOutcome["name"],
    checked: string | null,
    blocking: string | null,
    reasons: string[],
    na = false,
  ) {
    const canLink =
      name === "timing"
        ? actor.permissions.includes("settings")
        : !["phone_census", "two_person_proposals"].includes(name) &&
          actor.permissions.includes("sales");
    checks.push({
      name,
      checked,
      blocking,
      unit:
        name === "timing"
          ? "campaigns"
          : name === "phone_census"
            ? "phones"
            : "purchases",
      outcome: na
        ? "not_applicable"
        : blocking === "0"
          ? "resolved"
          : "unresolved",
      reasonCodes: reasons,
      links: canLink
        ? [
            {
              href: name === "timing" ? "/admin/settings" : "/admin/sales",
              label: name === "timing" ? "Settings" : "Sales",
            },
          ]
        : [],
      access: canLink ? "available" : "restricted",
    });
  }
  const timing = ready.view.blockers.filter((r) =>
    [
      "campaign_unconfigured",
      "timing_policy_unconfigured",
      "before_cutoff",
      "grace_open",
    ].includes(r),
  );
  row("timing", "1", timing.length ? "1" : "0", timing);
  for (const [name, key, code] of [
    ["holds", "holds", "holds_open"],
    ["corrections", "corrections", "corrections_pending"],
    ["duplicates", "duplicateFlags", "duplicates_open"],
  ] as const) {
    const count = new Set(
      ready.ordinary.filter((r) => r.kind === key).map((r) => r.id),
    ).size;
    row(name, history[name], String(count), count ? [code] : []);
  }
  const proposals = new Set([
    ...ready.pending.holds,
    ...ready.pending.policyBlocks,
  ]);
  row(
    "two_person_proposals",
    history.proposals,
    String(proposals.size),
    proposals.size ? ["release_proposals_pending"] : [],
  );
  const relevant = ready.sources.filter((s) =>
    ready.relevant.includes(s.purchaseId),
  );
  const uploads = relevant.filter(
    (s) => !s.phoneExclusionId && !s.reasons.includes("cancelled"),
  );
  const incomplete = uploads.filter((s) =>
    ready.sets.uploads.has(s.purchaseId),
  );
  if (!ctx.policy) row("uploads", null, null, ["policy_missing"]);
  else
    row(
      "uploads",
      String(uploads.length),
      String(incomplete.length),
      incomplete.length
        ? ["uploads_incomplete", "validation_pending"]
        : uploads.length
          ? []
          : ["no_applicable_sources"],
      !uploads.length,
    );
  const photoSources = relevant.filter(
    (s) =>
      !s.phoneExclusionId &&
      !s.reasons.some((r) =>
        [
          "cancelled",
          "before_launch",
          "outside_period",
          "upload_late",
        ].includes(r),
      ),
  );
  const photoMissing = photoSources.filter(
    (s) =>
      s.reasons.includes("evidence_deadline_unresolved") || !s.photoReceiptAt,
  );
  const photoReasons = new Set<string>();
  if (photoMissing.length) {
    const evidence = (
      await db.query<{ id: string; observed: boolean; fact: boolean }>(
        `SELECT p.id, EXISTS(SELECT 1 FROM photo_receipt_observation o WHERE o.purchase_id=p.id) observed,
        EXISTS(SELECT 1 FROM photo_receipt_fact f WHERE f.purchase_id=p.id) fact
       FROM purchase p WHERE p.station_id=$1 AND p.id=ANY($2::uuid[])`,
        [c.station_id, photoMissing.map((s) => s.purchaseId)],
      )
    ).rows;
    for (const source of photoMissing) {
      const facts = evidence.find((e) => e.id === source.purchaseId);
      photoReasons.add(
        facts?.fact
          ? "photo_proof_unbound"
          : facts?.observed
            ? "photo_deadline_uncertain"
            : "photo_proof_missing",
      );
    }
  }
  if (!ctx.policy || !c.deadline_us)
    row("complete_photo_deadline", null, null, ["policy_missing"]);
  else
    row(
      "complete_photo_deadline",
      String(photoSources.length),
      String(photoMissing.length),
      photoMissing.length
        ? [...photoReasons].sort()
        : photoSources.length
          ? []
          : ["no_applicable_sources"],
      !photoSources.length,
    );
  const timingUnknown = ready.sources.filter((s) =>
    s.reasons.includes("timing_unresolved"),
  );
  const eligibility = new Set([
    ...ready.sets.policyBlocks,
    ...timingUnknown.map((s) => s.purchaseId),
  ]);
  row(
    "eligibility",
    String(
      new Set([
        ...relevant.map((s) => s.purchaseId),
        ...ready.pending.policyBlocks,
      ]).size,
    ),
    String(eligibility.size),
    [
      ...(ready.sets.policyBlocks.size ? ["eligibility_unresolved"] : []),
      ...(timingUnknown.length ? ["timing_unresolved"] : []),
      ...(ready.pending.policyBlocks.length ? ["capture_release_pending"] : []),
    ],
  );
  const phoneRows = await phones(db, ctx),
    required = await attendants(db, ctx),
    eligible = await managers(db, ctx);
  const phoneReasons: string[] = [];
  let evaluable = true;
  if (!ctx.inventory.manager_admin_id) {
    phoneReasons.push("manager_missing");
    evaluable = false;
  } else if (
    !eligible.items.some((m) => m.adminId === ctx.inventory.manager_admin_id)
  ) {
    phoneReasons.push("manager_ineligible");
    evaluable = false;
  }
  if (!c.phone_census_id) {
    phoneReasons.push("census_missing");
    evaluable = false;
  } else if (
    !phoneRows.length ||
    required.some(
      (a) => !phoneRows.some((p) => p.attendantIds.includes(a.attendantId)),
    )
  ) {
    phoneReasons.push("census_incomplete");
    evaluable = false;
  }
  if (!ctx.policy) {
    phoneReasons.push("policy_missing");
    evaluable = false;
  }
  if (ready.phone.status.state === "missing")
    phoneReasons.push("phone_check_missing");
  else if (ready.phone.status.state === "stale")
    phoneReasons.push("phone_check_stale");
  if (ready.phone.status.pendingExclusions !== "0")
    phoneReasons.push("phone_exclusion_pending");
  let blocked = 0;
  if (ready.phone.status.state !== "complete") blocked = phoneRows.length;
  else
    blocked = phoneRows.filter(
      (p) => p.state === "unchecked" || p.state === "unavailable_pending",
    ).length;
  if (phoneRows.some((p) => p.state === "unchecked"))
    phoneReasons.push("phone_unchecked");
  if (
    ready.phone.status.state !== "complete" &&
    phoneRows.some((p) => p.state === "unavailable_approved")
  )
    phoneReasons.push("exclusion_unusable");
  row(
    "phone_census",
    String(phoneRows.length),
    evaluable ? String(blocked) : null,
    phoneReasons,
  );
  return { checks, readiness: ready.view };
}
