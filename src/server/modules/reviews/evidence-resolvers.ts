import { timingHistoryCte } from "../settings/timing-history";
import { createHash } from "node:crypto";
import type pg from "pg";
import { authId } from "../../../shared/contracts/auth";
import { AuthError } from "../auth/errors";
import type {
  Fact,
  Source,
  EvidenceCategory,
  ResolvedEvidence,
} from "./evidence-types";
/** Canonical audit fields are evidence only when the retained price version and
 * exact committed activation boundary agree. Historical fields remain explicit. */
export function priceAuditMatches(a: Fact, v: Fact) {
  const after =
    a.after && typeof a.after === "object" && !Array.isArray(a.after)
      ? (a.after as Record<string, unknown>)
      : {};
  if (after.priceVersionId !== v.id || after.rateKobo !== v.rate_kobo)
    return false;
  if (after.priceVersion !== undefined)
    return (
      after.priceVersion === String(v.version) &&
      after.quantityPrecision === String(v.quantity_precision) &&
      after.currency === v.currency &&
      typeof after.effectiveFrom === "string" &&
      trustedMicros(after.effectiveFrom) === trustedMicros(v.effective_from) &&
      trustedMicros(a.occurred_at) === trustedMicros(v.effective_from)
    );
  return (
    after.version === v.version &&
    after.quantityPrecision === v.quantity_precision
  );
}
export const EVIDENCE_CATEGORIES: readonly EvidenceCategory[] = [
  "original_purchase",
  "capturing_context",
  "frozen_lookup_verification",
  "price_history",
  "card_history",
  "assignment_history",
  "campaign_history",
  "domain_audit",
  "validated_photo",
  "derived_evidence",
];
export function insufficient(): never {
  throw new AuthError("evidence_insufficient", 422);
}
export function fingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
/** PostgreSQL timestamps retain all six decimals. No Date round trip for comparisons. */
export function trustedMicros(value: unknown): string {
  if (typeof value !== "string") return insufficient();
  const m =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(
      value,
    );
  if (!m) return insufficient();
  const zone = m[4]!.length === 3 ? m[4] + ":00" : m[4];
  const ms = Date.parse(`${m[1]}T${m[2]}${zone}`);
  if (!Number.isFinite(ms)) return insufficient();
  return String(BigInt(ms) * 1000n + BigInt((m[3] ?? "").padEnd(6, "0")));
}
async function rows(
  db: pg.PoolClient,
  query: string,
  args: unknown[],
): Promise<Fact[]> {
  const result = await db.query<{ fact: Fact }>(query, args);
  if (result.rows.length > 2048) return insufficient();
  return result.rows.map((x) => x.fact);
}
/** Full scoped histories are read under SHARE locks: inserts and endings cannot race acceptance. */
export async function resolveEvidenceSources(
  db: pg.PoolClient,
  purchaseId: string,
  assetId: string,
): Promise<ResolvedEvidence> {
  await db.query(
    "LOCK TABLE product_price_version, assignment, capture_context, card, card_customer_link, settings_version, campaign, audit_event IN SHARE MODE",
  );
  const original = (
    await rows(
      db,
      `SELECT jsonb_build_object('id',p.id,'created_at',p.created_at,'station_id',p.station_id,'product_id',p.product_id,'pump_id',p.pump_id,'originating_attendant_id',p.originating_attendant_id,'capture_context_id',p.capture_context_id,'assignment_id',p.assignment_id,'server_received_at',p.server_received_at,'price_version_id',p.price_version_id,'card_code',p.card_code,'app_captured_at',p.app_captured_at,'basis',p.basis,'entered_amount_kobo',p.entered_amount_kobo::text,'entered_quantity',p.entered_quantity::text,'amount_kobo',p.amount_kobo::text,'quantity',p.quantity::text,'unit',p.unit,'medium',p.medium,'rate_kobo',p.rate_kobo::text,'currency',p.currency,'quantity_precision',p.quantity_precision,'card_id',p.card_id,'customer_id',p.customer_id,'expected_photo_digest',p.expected_photo_digest,'lookup_receipt_status',p.lookup_receipt_status,'lookup_receipt_claims',p.lookup_receipt_claims,'capture_lower_bound',p.capture_lower_bound,'capture_policy_version',p.capture_policy_version) fact FROM purchase p WHERE p.id=$1`,
      [purchaseId],
    )
  )[0];
  if (!original) return insufficient();
  const context = (
    await rows(
      db,
      `SELECT to_jsonb(c)-'device_binding_digest'-'seller_name'-'seller_username' fact FROM capture_context c WHERE id=$1 AND attendant_id=$2`,
      [original.capture_context_id, original.originating_attendant_id],
    )
  )[0];
  const assignments = await rows(
    db,
    `SELECT to_jsonb(a)-'reason' || jsonb_build_object('station_id',p.station_id,'product_id',p.product_id) fact FROM assignment a JOIN pump p ON p.id=a.pump_id WHERE a.attendant_id=$1 ORDER BY a.assignment_version LIMIT 2049`,
    [original.originating_attendant_id],
  );
  const assignment = assignments.find((a) => a.id === original.assignment_id);
  if (
    !context ||
    !assignment ||
    context.assignment_id !== assignment.id ||
    assignment.station_id !== original.station_id ||
    assignment.product_id !== original.product_id ||
    assignment.pump_id !== original.pump_id
  )
    return insufficient();
  const prices = await rows(
    db,
    `SELECT to_jsonb(v)-'reason' || jsonb_build_object('rate_kobo',v.rate_kobo::text) fact FROM product_price_version v WHERE station_id=$1 AND product_id=$2 ORDER BY version LIMIT 2049`,
    [original.station_id, original.product_id],
  );
  const settings = await rows(
    db,
    `${timingHistoryCte} SELECT
     jsonb_build_object('id',v.id,'created_at',v.created_at,'station_id',v.station_id,
       'campaign_id',v.campaign_id,'version',v.version,'purchase_start',v.purchase_start,
       'purchase_cutoff',v.purchase_cutoff,'upload_deadline',v.upload_deadline,
       'timezone',v.timezone,'retention_days',v.retention_days,
       'retention_approved_by',v.retention_approved_by,'retention_approved_at',v.retention_approved_at,
       'effective_from',v.effective_from,'actor_id',v.actor_id)
     || CASE WHEN v.section='giveaway' THEN jsonb_build_object(
       'section',v.section,'previous_version_id',v.previous_version_id,'grace_hours',v.grace_hours,
       'launch_at',v.launch_at,'timing_policy_version',v.timing_policy_version,
       'retention_policy_version',v.retention_policy_version,'stored_copy_policy',v.stored_copy_policy,
       'operation_id',v.operation_id) ELSE '{}'::jsonb END
     || jsonb_build_object('timing_history_version',v.timing_history_version,
       'timing_history_complete',v.timing_history_complete) fact
     FROM timing_history v ORDER BY version LIMIT 2049`,
    [original.station_id],
  );
  const links = await rows(
    db,
    `SELECT to_jsonb(l)-'reason' fact FROM card_customer_link l WHERE card_id=$1 ORDER BY linked_at,id LIMIT 2049`,
    [original.card_id],
  );
  const card =
    (
      await rows(
        db,
        `SELECT jsonb_build_object('id',id,'created_at',created_at,'version',version,'retired_at',retired_at,'retirement_reason',retirement_reason,'replaced_by_card_id',replaced_by_card_id) fact FROM card WHERE id=$1`,
        [original.card_id],
      )
    )[0] ?? null;
  const photo = (
    await rows(
      db,
      `SELECT jsonb_build_object('id',id,'created_at',created_at,'validated_at',validated_at,'validated_digest',validated_digest,'validated_bytes',validated_bytes::text,'purchase_id',purchase_id,'state',state) fact FROM photo_asset WHERE id=$1 AND purchase_id=$2 AND state='validated' AND deleted_at IS NULL AND validated_digest=$3`,
      [assetId, purchaseId, original.expected_photo_digest],
    )
  )[0];
  if (!photo) throw new AuthError("evidence_unavailable", 422);
  const candidateAudits = await rows(
    db,
    `SELECT jsonb_build_object('id',id,'occurred_at',occurred_at,'action',action,'target_type',target_type,'target_id',target_id,'before',before,'after',after) fact FROM audit_event WHERE (target_type='product' AND target_id=$1 AND action='price_activated') OR (target_type='card' AND target_id=$2 AND action IN ('card_linked','card_replaced','card_replacement')) OR (target_type='attendant' AND target_id=$3 AND action IN ('assignment_ended','assignment_changed','attendant_disabled')) OR (target_type IN ('station','campaign') AND (target_id=$4 OR target_id=ANY($5::uuid[])) AND action IN ('settings_changed','campaign_configured','settings_updated')) ORDER BY occurred_at,id LIMIT 2049`,
    [
      original.product_id,
      original.card_id,
      original.originating_attendant_id,
      original.station_id,
      settings.map((v) => v.campaign_id).filter(Boolean),
    ],
  );
  // A shared product ID alone is not station scope. Admit only audit actions
  // cross-checked against a source in this purchase's complete scoped history.
  const object = (x: unknown): Record<string, unknown> =>
    x && typeof x === "object" && !Array.isArray(x)
      ? (x as Record<string, unknown>)
      : {};
  const audits = candidateAudits.filter((a) => {
    const after = object(a.after),
      before = object(a.before);
    if (a.action === "price_activated")
      return prices.some((v) => priceAuditMatches(a, v));
    if (a.action === "assignment_ended")
      return assignments.some(
        (v) =>
          before.assignmentId === v.id &&
          v.effective_until !== null &&
          after.effectiveUntil &&
          trustedMicros(after.effectiveUntil) ===
            trustedMicros(v.effective_until),
      );
    if (a.action === "assignment_changed")
      return assignments.some(
        (v) =>
          after.assignmentId === v.id &&
          (after.assignmentVersion === undefined ||
            (after.assignmentVersion === String(v.assignment_version) &&
              after.pumpId === v.pump_id &&
              typeof after.effectiveFrom === "string" &&
              trustedMicros(after.effectiveFrom) ===
                trustedMicros(v.effective_from) &&
              trustedMicros(a.occurred_at) ===
                trustedMicros(v.effective_from))),
      );
    if (a.action === "attendant_disabled")
      return (
        context.revoked_at !== null &&
        trustedMicros(a.occurred_at) === trustedMicros(context.revoked_at)
      );
    if (
      ["card_linked", "card_replaced", "card_replacement"].includes(
        String(a.action),
      )
    )
      return (
        links.some(
          (l) =>
            l.customer_id === original.customer_id &&
            (after.customerId === l.customer_id ||
              before.customerId === l.customer_id),
        ) &&
        (a.action === "card_linked"
          ? links.some((l) => after.linkId === l.id)
          : card !== null &&
            (after.newCardId === card.replaced_by_card_id ||
              after.replacementCardId === card.replaced_by_card_id ||
              after.replacedByCardId === card.replaced_by_card_id))
      );
    return settings.some(
      (v) =>
        after.settingsVersionId === v.id &&
        (a.target_id === v.station_id || a.target_id === v.campaign_id),
    );
  });
  const sources: Source[] = [];
  const scope = {
    purchaseId,
    stationId: String(original.station_id),
    productId: String(original.product_id),
    accountId: String(original.originating_attendant_id),
  };
  const add = (category: EvidenceCategory, fact: Fact) => {
    trustedMicros(fact.created_at ?? fact.occurred_at);
    return sources.push({
      category,
      id: fact.id,
      version: String(fact.version ?? fact.assignment_version ?? 1),
      recordedAt: String(fact.created_at ?? fact.occurred_at),
      scope,
      dependencies: [],
      snapshot: fact,
    });
  };
  add("original_purchase", original);
  add("capturing_context", context);
  add("validated_photo", photo);
  for (const f of prices) add("price_history", f);
  for (const f of assignments) add("assignment_history", f);
  // Legacy campaign snapshots are a durable protocol, not the current table shape.
  // Computed completeness/ordering metadata belongs only to this evaluation.
  for (const f of settings)
    add(
      "campaign_history",
      Object.fromEntries(
        Object.entries(f).filter(
          ([key]) =>
            key !== "timing_history_version" &&
            key !== "timing_history_complete",
        ),
      ) as Fact,
    );
  for (const f of links) add("card_history", f);
  if (card) add("card_history", card);
  for (const f of audits) add("domain_audit", f);
  // Frozen verification is a purchase-owned immutable record, not a newly checked token.
  if (original.lookup_receipt_status === "valid")
    add("frozen_lookup_verification", {
      id: purchaseId + ":lookup",
      created_at: original.server_received_at,
      version: original.capture_policy_version,
      claims: original.lookup_receipt_claims,
      lower_bound: original.capture_lower_bound,
    });
  const historyGeneration = fingerprint(sources);
  return {
    original,
    context,
    assignment,
    prices,
    assignments,
    settings,
    links,
    card,
    audits,
    photo,
    sources,
    historyGeneration,
    derived: [],
  };
}
export async function recheckEvidenceSources(
  db: pg.PoolClient,
  purchaseId: string,
  historyGeneration: string,
  assetId?: string,
) {
  if (!assetId) {
    const r = await db.query<{ id: string }>(
      "SELECT id FROM photo_asset WHERE purchase_id=$1 AND state='validated' ORDER BY id",
      [purchaseId],
    );
    assetId = r.rows[0]?.id;
  }
  if (
    !assetId ||
    (await resolveEvidenceSources(db, purchaseId, assetId))
      .historyGeneration !== historyGeneration
  )
    return insufficient();
}
/** Finite, same-purchase provenance closure. No caller-selected source type. */
export async function resolveReferenceClosure(
  db: pg.PoolClient,
  facts: ResolvedEvidence,
  referenceIds: readonly string[],
  decisionId: string,
) {
  const visiting = new Set<string>(),
    done = new Set<string>();
  let count = 0;
  async function visit(id: string, depth: number): Promise<void> {
    if (id === decisionId || visiting.has(id) || depth > 16 || ++count > 128)
      return insufficient();
    if (done.has(id)) return;
    const originals = facts.sources.filter((s) => s.id === id);
    // Frozen lookup is an exact, typed original in the server's source closure,
    // not a database UUID. Only internal dependencies may reference it.
    if (
      depth > 0 &&
      id === `${facts.original.id}:lookup` &&
      originals.length === 1 &&
      originals[0]!.category === "frozen_lookup_verification"
    ) {
      done.add(id);
      return;
    }
    // Corrupt/unknown internal dependencies are insufficient evidence, never
    // UUID casts that become transient database errors in the HTTP adapter.
    if (!authId.safeParse(id).success) return insufficient();
    const derived = (
      await rows(
        db,
        `SELECT jsonb_build_object('id',d.id,'purchase_id',d.purchase_id,'kind',d.kind,'outcome',d.outcome,'created_at',d.decided_at,'provenance',e.provenance) fact FROM sale_decision d LEFT JOIN review_evaluation e ON e.decision_id=d.id WHERE d.id=$1 AND d.purchase_id=$2`,
        [id, facts.original.id],
      )
    )[0];
    if (originals.length + (derived ? 1 : 0) !== 1) return insufficient();
    if (derived) {
      const p = derived.provenance as Record<string, unknown> | null;
      if (
        !p ||
        !Array.isArray(p.sources) ||
        !Array.isArray(p.conclusions) ||
        !p.conclusions.length
      )
        return insufficient();
      visiting.add(id);
      for (const source of p.sources as Source[]) {
        if (
          !source ||
          typeof source.id !== "string" ||
          !EVIDENCE_CATEGORIES.includes(source.category)
        )
          return insufficient();
        // Frozen verification has a synthetic scoped ID and cannot be supplied over the wire.
        if (source.category === "frozen_lookup_verification") {
          const current = facts.sources.find((s) => s.id === source.id);
          if (!current || fingerprint(current) !== fingerprint(source))
            return insufficient();
        } else {
          if (source.category !== "derived_evidence") {
            const current = facts.sources.find(
              (s) => s.id === source.id && s.category === source.category,
            );
            if (!current || fingerprint(current) !== fingerprint(source))
              return insufficient();
          }
          await visit(source.id, depth + 1);
          if (!Array.isArray(source.dependencies)) return insufficient();
          for (const dependency of source.dependencies) {
            if (typeof dependency !== "string") return insufficient();
            await visit(dependency, depth + 1);
          }
        }
      }
      visiting.delete(id);
      facts.derived.push(derived);
    }
    done.add(id);
  }
  for (const id of referenceIds) await visit(id, 0);
}
