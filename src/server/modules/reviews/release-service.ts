import type pg from "pg";
import { z } from "zod";
import type { EvidenceStorage } from "../../adapters/storage";
import { StorageNotFoundError, StorageSizeError } from "../../adapters/storage";
import {
  createSaleEvidenceReader,
  type SaleEvidenceReader,
} from "../../adapters/sale-evidence";
import {
  releaseProposalInputSchema,
  releaseDecisionInputSchema,
  releasePhotoAccessSchema,
  releaseProposalSchema,
  releaseDecisionResponseSchema,
  type ReleaseProposalInput,
} from "../../../shared/contracts/held-release";
import * as wire from "../../../shared/contracts/sales";
import { parseQuantity } from "../../../shared/quantity";
import { SYNC_LIMITS } from "../../../shared/contracts/sync";
import { transaction } from "../sync/repo";
import { payloadDigest } from "../sync/canonical";
import { validatePhoto } from "../sync/photo";
import { saleAuditGates, saleAuditValues } from "../sync/audit";
import { safeReason } from "../corrections/service";
import { newId } from "../../lib/ids";
import { AuthError } from "../auth/errors";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { adminConfig } from "../admin-access/config";
import { encodeCursor, decodeCursor } from "../sales/cursor";
import * as sql from "../sales/projections";
import { releaseSaleMutations as sale } from "./service";
import {
  releasePerson,
  requireIndependentReleasePerson,
} from "./release-people";
import { classifyReleaseAdmission } from "./release-admission";
import { writeReleaseAudit } from "./release-audit";
import {
  pinReleaseV2Policy,
  reviewEnvironment,
  type ReviewEnvironment,
} from "./config";
import { inspectReviewEvidence } from "./evidence";
import {
  releaseConsistency,
  type AppliedAttestation,
  type AttestedPredicate,
} from "./release-consistency";
import type { TypedConclusion } from "./evidence-types";

type Kind = "price" | "card" | "date" | "capture";
const permissions = {
  price: "priceReview",
  card: "cardEligibility",
  date: "dateReview",
  capture: "dateReview",
} as const;
type Actor = { id: string; code: string; name: string };
type Policy = Awaited<ReturnType<typeof pinReleaseV2Policy>>;
type Evaluation = Awaited<ReturnType<typeof classifyReleaseAdmission>>;
type Provenance = {
  policy: Policy;
  evaluation: Evaluation;
  candidateDigest: string;
  person: Awaited<ReturnType<typeof releasePerson>>;
  actor: Actor;
  certificate: ReturnType<typeof releaseConsistency>;
  applied: AppliedAttestation[];
  expectedPostVersion: number;
  proposedAuditId: string | null;
};
type ProposalRow = {
  id: string;
  purchase_id: string;
  station_id: string;
  target_kind: Kind;
  outcome: "confirm" | "cancel";
  sheet_asset_id: string;
  proposer_id: string;
  proposer_person_id: string;
  content: ReleaseProposalInput;
  provenance: Provenance;
  proposed_at: Date;
  cursor_at?: string;
  state: "pending" | "approved" | "rejected" | "superseded";
  version: number;
};
type ReleaseDecision = {
  id: string;
  proposalId: string;
  operationId: string;
  outcome: "approve" | "reject";
  actor: Actor;
  reason: string;
  decidedAt: string;
  auditEventId: string;
  result: wire.Decision | null;
};
const fail = (code = "evidence_insufficient", status = 422): never => {
  throw new AuthError(code, status);
};
async function authority(
  db: pg.PoolClient,
  token: string | undefined,
  env: ReviewEnvironment,
  kind?: Kind,
) {
  await securityLock(db);
  const a = await requireAdminSession(db, token);
  requirePermission(a, "sales");
  if (kind) requirePermission(a, permissions[kind]);
  const stations = (
    await db.query<{ id: string }>("SELECT id FROM station ORDER BY id LIMIT 2")
  ).rows;
  if (stations.length !== 1) return fail("permission_denied", 403);
  const stationId = stations[0]!.id;
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('review-evidence:'||$1::text||':'||$2::text,0))",
    [stationId, reviewEnvironment(env)],
  );
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('reporting:'||$1::text,0))",
    [stationId],
  );
  return { ...a, stationId };
}
async function actorSnapshot(
  db: pg.PoolClient,
  userId: string,
): Promise<Actor> {
  const r = (
    await db.query<Actor>(
      "SELECT a.id,a.admin_code code,u.display_name name FROM admin a JOIN auth_user u ON u.id=a.user_id WHERE u.id=$1",
      [userId],
    )
  ).rows[0];
  return r ?? fail("independence_unverifiable", 403);
}
async function scopedProposal(
  db: pg.PoolClient,
  id: string,
  purchaseId: string,
  stationId: string,
) {
  const p = (
    await db.query<ProposalRow>(
      `SELECT p.*,s.state,s.version FROM held_release_proposal p JOIN held_release_state s ON s.proposal_id=p.id WHERE p.id=$1 AND p.purchase_id=$2 AND p.station_id=$3 FOR UPDATE OF s`,
      [id, purchaseId, stationId],
    )
  ).rows[0];
  return p ?? fail("not_found", 404);
}
async function independent(
  db: pg.PoolClient,
  stationId: string,
  purchaseId: string,
  actorId: string,
  proposerId?: string,
) {
  const users = (
    await db.query<{ id: string }>(
      `SELECT a.user_id id FROM purchase p JOIN attendant a ON a.id=p.originating_attendant_id WHERE p.id=$1 AND p.station_id=$2 UNION SELECT u.id FROM correction_request c JOIN auth_user u ON u.id IN(c.recovery_executor_id,c.recovery_authorizing_admin_id) JOIN purchase p ON p.id=c.purchase_id WHERE c.purchase_id=$1 AND p.station_id=$2 UNION SELECT a.user_id id FROM purchase p JOIN recovery_grant g ON g.originating_attendant_id=p.originating_attendant_id JOIN recovery_grant_item i ON i.grant_id=g.id AND i.operation_id=p.operation_id JOIN admin a ON a.id=g.admin_id WHERE p.id=$1 AND p.station_id=$2`,
      [purchaseId, stationId],
    )
  ).rows.map((r) => r.id);
  if (!users.length) return fail("not_found", 404);
  return requireIndependentReleasePerson(
    db,
    stationId,
    actorId,
    proposerId ? [...users, proposerId] : users,
  );
}
async function receipt(
  db: pg.PoolClient,
  actor: string,
  kind: string,
  operation: string,
  hash: string,
) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `held-release:${actor}:${kind}:${operation}`,
  ]);
  const r = (
    await db.query<{ payload_digest: string; response: unknown }>(
      "SELECT payload_digest,response FROM held_release_receipt WHERE actor_id=$1 AND operation_kind=$2 AND operation_id=$3",
      [actor, kind, operation],
    )
  ).rows[0];
  if (r && r.payload_digest !== hash) return fail("operation_conflict", 409);
  return r;
}
async function saveReceipt(
  db: pg.PoolClient,
  actor: string,
  kind: string,
  operation: string,
  hash: string,
  response: unknown,
) {
  await db.query(
    "INSERT INTO held_release_receipt(actor_id,operation_kind,operation_id,payload_digest,response) VALUES($1,$2,$3,$4,$5::jsonb)",
    [actor, kind, operation, hash, JSON.stringify(response)],
  );
}
const fields = (p: ProposalRow) => ({
  releaseProposalId: p.id,
  releaseState: p.state,
  releaseTargetKind: p.target_kind,
  releaseOutcome: p.outcome,
  sheetAssetId: p.sheet_asset_id,
  proposerId: p.provenance.actor.id,
});
async function project(db: pg.PoolClient, p: ProposalRow) {
  const terminal = (
    await db.query<{ content: { decision?: ReleaseDecision } }>(
      "SELECT content FROM held_release_transition WHERE proposal_id=$1 AND state IN ('approved','rejected') ORDER BY version DESC LIMIT 1",
      [p.id],
    )
  ).rows[0];
  return releaseProposalSchema.parse({
    id: p.id,
    purchaseId: p.purchase_id,
    version: p.version,
    target: p.content.target,
    outcome: p.outcome,
    facts: p.content.facts,
    sheetAssetId: p.sheet_asset_id,
    meterAssetId: p.content.meterAssetId,
    proposedBy: p.provenance.actor,
    proposedAt: p.proposed_at.toISOString(),
    reason: p.content.reason,
    state: p.state,
    policy: {
      release: p.provenance.policy.release,
      digest: p.provenance.policy.digest,
      revision: p.provenance.policy.revision,
    },
    guardAtProposal: {
      expectedVersion: p.content.expectedVersion,
      expectedRevisionId: p.content.expectedRevisionId,
    },
    decision: terminal?.content.decision ?? null,
  });
}
async function target(
  db: pg.PoolClient,
  purchaseId: string,
  t: ReleaseProposalInput["target"],
) {
  if (t.kind === "capture") {
    const b = (
      await db.query<{ id: string; code: string; version: number }>(
        "SELECT id,code,version FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL AND code IN ('capture_authorization_unresolved','capture_time_unresolved') ORDER BY id FOR UPDATE",
        [purchaseId],
      )
    ).rows;
    if (!b.length) return fail("review_closed", 409);
    if (payloadDigest(b) !== payloadDigest(t.blocks))
      return fail("version_conflict", 409);
  } else {
    const h = (
      await db.query(
        "SELECT kind,state,version,reason_code FROM purchase_hold WHERE id=$1 AND purchase_id=$2 FOR UPDATE",
        [t.holdId, purchaseId],
      )
    ).rows[0];
    if (!h) return fail("not_found", 404);
    if (h.kind !== t.kind) return fail("hold_kind_mismatch", 422);
    if (h.state !== "open") return fail("review_closed", 409);
    if (h.version !== t.expectedHoldVersion)
      return fail("version_conflict", 409);
    if (t.kind === "card" && h.reason_code !== "replaced_card") return fail();
  }
}
async function validateFacts(
  db: pg.PoolClient,
  purchaseId: string,
  body: ReleaseProposalInput,
  r: Awaited<ReturnType<typeof sale.candidate>>,
) {
  const original = (
    await db.query(
      "SELECT p.*,a.user_id account_id,pr.code product_code FROM purchase p JOIN attendant a ON a.id=p.originating_attendant_id JOIN product pr ON pr.id=p.product_id WHERE p.id=$1",
      [purchaseId],
    )
  ).rows[0];
  const f = body.facts;
  if (
    !original ||
    f.stationId !== original.station_id ||
    f.accountId !== original.account_id ||
    f.pumpId !== original.pump_id ||
    f.product !== original.product_code ||
    f.cardId !== original.card_id ||
    f.customerId !== original.customer_id
  )
    return fail();
  if (r.evidence_asset_id !== body.meterAssetId)
    return fail("evidence_unavailable", 422);
  // Basis remains the original capture basis; compare against the guarded
  // effective candidate, including independently retained meter-evidence values.
  if (
    r.values.basis === "amount"
      ? f.recordedAmountKobo !== r.values.amountKobo
      : f.recordedQuantity === null ||
        parseQuantity(f.recordedQuantity) !== parseQuantity(r.values.quantity)
  )
    return fail();
  if (
    f.recordedAmountKobo !== null &&
    f.recordedAmountKobo !== r.values.amountKobo
  )
    return fail();
  if (
    f.recordedQuantity !== null &&
    parseQuantity(f.recordedQuantity) !== parseQuantity(r.values.quantity)
  )
    return fail();
  if (f.recordedRateKobo !== null && f.recordedRateKobo !== r.values.rateKobo)
    return fail();
  if (
    body.target.kind === "price" &&
    body.outcome === "confirm" &&
    (f.recordedRateKobo !== String(original.rate_kobo) ||
      r.values.amountKobo !== String(original.amount_kobo) ||
      parseQuantity(r.values.quantity) !==
        parseQuantity(String(original.quantity)) ||
      r.values.calculation !== "captured_rate")
  )
    return fail();
  const forbidden = await db.query(
    "SELECT id FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL AND code NOT IN ('capture_authorization_unresolved','capture_time_unresolved')",
    [purchaseId],
  );
  if (forbidden.rowCount) return fail();
}
async function inspectPhotos(
  db: pg.PoolClient,
  storage: EvidenceStorage,
  purchaseId: string,
  body: ReleaseProposalInput,
  personId: string,
  uploaderId: string,
) {
  const meter = await inspectReviewEvidence(db, storage, purchaseId, {
    assetId: body.meterAssetId,
    notes: body.reason,
    referenceIds: [],
  });
  const s = (
    await db.query<{ final_key: string; sha256: string; bytes: number }>(
      `SELECT v.final_key,s.sha256,s.bytes FROM held_release_sheet s JOIN held_release_sheet_validation v ON v.asset_id=s.id WHERE s.id=$1 AND s.purchase_id=$2 AND s.purpose='held_release_sheet' AND ((s.uploader_person_id=$3 AND s.uploader_id=$4 AND s.target=$5::jsonb) OR EXISTS(SELECT 1 FROM held_release_proposal p WHERE p.sheet_asset_id=s.id AND p.purchase_id=s.purchase_id))`,
      [
        body.sheetAssetId,
        purchaseId,
        personId,
        uploaderId,
        JSON.stringify(body.target),
      ],
    )
  ).rows[0];
  if (!s) return fail("evidence_unavailable", 422);
  let bytes: Buffer;
  try {
    bytes = await storage.read(s.final_key, SYNC_LIMITS.maxBytes);
  } catch (e) {
    if (e instanceof StorageNotFoundError || e instanceof StorageSizeError)
      return fail("evidence_unavailable", 422);
    return fail("storage_unavailable", 503);
  }
  try {
    await validatePhoto(bytes, s.sha256, s.bytes);
  } catch {
    return fail("evidence_unavailable", 422);
  }
  return {
    sheetDigest: s.sha256,
    sheetFinalKey: s.final_key,
    meterAssetId: body.meterAssetId,
    meterDigest: meter.digest,
  };
}
async function recheckPhotos(
  db: pg.PoolClient,
  purchaseId: string,
  body: ReleaseProposalInput,
  checked: Awaited<ReturnType<typeof inspectPhotos>>,
) {
  const row = await db.query(
    `SELECT s.id FROM held_release_sheet s JOIN held_release_sheet_validation v ON v.asset_id=s.id JOIN photo_asset m ON m.id=$3 AND m.purchase_id=s.purchase_id WHERE s.id=$1 AND s.purchase_id=$2 AND s.sha256=$4 AND v.final_key=$5 AND m.state='validated' AND m.validated_digest=$6 AND m.validated_digest=(SELECT expected_photo_digest FROM purchase WHERE id=$2)`,
    [
      body.sheetAssetId,
      purchaseId,
      body.meterAssetId,
      checked.sheetDigest,
      checked.sheetFinalKey,
      checked.meterDigest,
    ],
  );
  if (!row.rowCount) return fail("evidence_unavailable", 422);
}
function predicates(cs: TypedConclusion[]): AttestedPredicate[] {
  return cs.flatMap((c): AttestedPredicate[] => {
    switch (c.tag) {
      case "price_valid_throughout":
        return [{ kind: "rate", rateKobo: c.rateKobo, currency: c.currency }];
      case "card_before_replacement":
      case "card_after_replacement":
        return [{ kind: "card", cardId: c.cardId, customerId: c.customerId }];
      case "sale_day":
        return [{ kind: "day", day: c.day }];
      case "capture_authorized_throughout":
      case "capture_unauthorized_throughout":
        return [
          {
            kind: "authorization",
            accountId: c.accountId,
            pumpId: c.pumpId,
            authorized: c.tag === "capture_authorized_throughout",
          },
        ];
      case "campaign_membership_uniform":
        return c.campaignIds.map((campaignId) => ({
          kind: "campaign" as const,
          campaignId,
          inside: c.inside,
        }));
    }
  });
}
async function consistency(
  db: pg.PoolClient,
  purchaseId: string,
  e: Evaluation,
  id: string,
  outcome: "confirm" | "cancel",
) {
  const rows = (
    await db.query<{ content: { attestation?: AppliedAttestation } }>(
      "SELECT t.content FROM held_release_transition t JOIN held_release_proposal p ON p.id=t.proposal_id WHERE p.purchase_id=$1 AND t.state='approved' AND p.outcome='confirm' ORDER BY t.id",
      [purchaseId],
    )
  ).rows;
  const applied = rows.map((r) => r.content.attestation ?? fail());
  const current: AppliedAttestation = {
    decisionId: id,
    version: 1,
    fromMicros: e.attestedInterval.L,
    throughMicros: e.attestedInterval.U,
    predicates: predicates(e.conclusions),
    sourceIds: e.sources.map((s) => s.id),
  };
  // Cancellation supplies no affirmative conclusion. Check its range against retained
  // conclusions without inventing a date or letting it contradict an existing day.
  if (outcome === "cancel") {
    const retained = releaseConsistency(e.originalInterval, applied);
    const lower =
      BigInt(retained.fromMicros) > BigInt(current.fromMicros)
        ? retained.fromMicros
        : current.fromMicros;
    const upper =
      BigInt(retained.throughMicros) < BigInt(current.throughMicros)
        ? retained.throughMicros
        : current.throughMicros;
    if (BigInt(lower) > BigInt(upper)) return fail();
    return {
      applied,
      current,
      certificate: { ...retained, fromMicros: lower, throughMicros: upper },
    };
  }
  const certificate = releaseConsistency(e.originalInterval, [
    ...applied,
    current,
  ]);
  return { applied, current, certificate };
}
async function proposerCurrent(db: pg.PoolClient, p: ProposalRow) {
  const ok = await db.query(
    `SELECT u.id FROM auth_user u JOIN admin a ON a.user_id=u.id JOIN role r ON r.id=a.role_id WHERE u.id=$1 AND u.enabled AND u.kind='admin' AND NOT u.must_change_password AND r.enabled AND EXISTS(SELECT 1 FROM role_permission WHERE role_id=r.id AND permission_code='sales') AND EXISTS(SELECT 1 FROM role_permission WHERE role_id=r.id AND permission_code=$2)`,
    [p.proposer_id, permissions[p.target_kind]],
  );
  if (!ok.rowCount) return fail("proposal_stale", 409);
  try {
    const person = await independent(
      db,
      p.station_id,
      p.purchase_id,
      p.proposer_id,
    );
    if (payloadDigest(person) !== payloadDigest(p.provenance.person))
      return fail("proposal_stale", 409);
  } catch {
    return fail("proposal_stale", 409);
  }
}
async function effectiveValues(
  db: pg.PoolClient,
  purchaseId: string,
  revisionId: string | null,
  fallback: wire.SaleValues,
) {
  if (!revisionId) return fallback;
  const row = (
    await db.query<{ value: unknown }>(
      `SELECT ${sql.values("r")} value FROM purchase_revision r WHERE id=$1 AND purchase_id=$2`,
      [revisionId, purchaseId],
    )
  ).rows[0];
  if (!row) return fail();
  return wire.saleValuesSchema.parse(row.value);
}
async function appendTransition(
  db: pg.PoolClient,
  p: ProposalRow,
  state: "approved" | "rejected",
  actorId: string,
  decision: ReleaseDecision,
  extra: Record<string, unknown> = {},
) {
  const changed = await db.query(
    "UPDATE held_release_state SET state=$3,version=version+1 WHERE proposal_id=$1 AND version=$2 AND state='pending'",
    [p.id, p.version, state],
  );
  if (changed.rowCount !== 1) return fail("version_conflict", 409);
  await db.query(
    "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
    [
      decision.id,
      p.id,
      p.version + 1,
      state,
      actorId,
      JSON.stringify({ decision, ...extra }),
    ],
  );
}
export function createHeldReleaseService({
  pool,
  storage,
  env = process.env,
  readerFactory = createSaleEvidenceReader,
}: {
  pool: pg.Pool;
  storage: EvidenceStorage;
  env?: ReviewEnvironment;
  readerFactory?: () => SaleEvidenceReader;
}) {
  async function propose(
    token: string | undefined,
    purchaseId: string,
    input: unknown,
  ) {
    const body = releaseProposalInputSchema.parse(input),
      hash = payloadDigest({ purchaseId, ...body });
    safeReason(body.reason);
    const preflight = await transaction(pool, async (db) => {
      const a = await authority(db, token, env, body.target.kind),
        p = await sale.purchase(db, purchaseId, a.stationId),
        person = await independent(db, a.stationId, purchaseId, a.user_id);
      const old = await receipt(
        db,
        a.user_id,
        "propose",
        body.operationId,
        hash,
      );
      if (old) return { historical: old.response, person, actorId: a.user_id };
      await pinReleaseV2Policy(db, a.stationId, env);
      sale.guard(p, body);
      await target(db, purchaseId, body.target);
      return { historical: undefined, person, actorId: a.user_id };
    });
    if (preflight.historical !== undefined)
      return {
        proposal: releaseProposalSchema.parse(preflight.historical),
        replayed: true,
      };
    // Storage work does not hold the security lock: revocation can commit, and the
    // final transaction below must load authority again before applying anything.
    const photos = await transaction(pool, (db) =>
      inspectPhotos(
        db,
        storage,
        purchaseId,
        body,
        preflight.person.personId,
        preflight.actorId,
      ),
    );
    return transaction(pool, async (db) => {
      const a = await authority(db, token, env, body.target.kind);
      const p = await sale.purchase(db, purchaseId, a.stationId);
      const person = await independent(db, a.stationId, purchaseId, a.user_id);
      const old = await receipt(
        db,
        a.user_id,
        "propose",
        body.operationId,
        hash,
      );
      if (old)
        return {
          proposal: releaseProposalSchema.parse(old.response),
          replayed: true,
        };
      const policy = await pinReleaseV2Policy(db, a.stationId, env);
      sale.guard(p, body);
      await target(db, purchaseId, body.target);
      if (
        (
          await db.query(
            "SELECT proposal_id FROM held_release_state WHERE purchase_id=$1 AND state='pending'",
            [purchaseId],
          )
        ).rowCount
      )
        return fail("proposal_pending", 409);
      const candidate = await sale.candidate(db, p);
      await validateFacts(db, purchaseId, body, candidate);
      await recheckPhotos(db, purchaseId, body, photos);
      const evaluation = await classifyReleaseAdmission(db, purchaseId, body);
      const id = newId(),
        joint = await consistency(db, purchaseId, evaluation, id, body.outcome);
      await authority(db, token, env, body.target.kind);
      await independent(db, a.stationId, purchaseId, a.user_id);
      const actor = await actorSnapshot(db, a.user_id);
      const provenance: Provenance = {
        policy,
        evaluation,
        candidateDigest: payloadDigest(candidate),
        person,
        actor,
        certificate: joint.certificate,
        applied: joint.applied,
        expectedPostVersion: p.version + 1,
        proposedAuditId: null,
      };
      await db.query(
        "INSERT INTO held_release_proposal(id,purchase_id,station_id,target_kind,outcome,sheet_asset_id,proposer_id,proposer_person_id,content,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)",
        [
          id,
          purchaseId,
          a.stationId,
          body.target.kind,
          body.outcome,
          body.sheetAssetId,
          a.user_id,
          person.personId,
          JSON.stringify(body),
          JSON.stringify({ ...provenance, photos }),
        ],
      );
      await db.query(
        "INSERT INTO held_release_state(proposal_id,purchase_id) VALUES($1,$2)",
        [id, purchaseId],
      );
      const row = await scopedProposal(db, id, purchaseId, a.stationId);
      const after = {
        ...fields(row),
        reviewPolicyRelease: policy.release,
        reviewPolicyRevision: String(policy.revision),
      };
      const auditId = await writeReleaseAudit(db, {
        stationId: a.stationId,
        purchaseId,
        actorId: a.user_id,
        operationId: body.operationId,
        action: "held_release_proposed",
        before: null,
        after,
      });
      await db.query(
        "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,1,'pending',$3,$4::jsonb)",
        [
          newId(),
          id,
          a.user_id,
          JSON.stringify({
            person,
            actor,
            reason: body.reason,
            auditEventId: auditId,
          }),
        ],
      );
      await db.query(
        "UPDATE purchase SET version=version+1 WHERE id=$1 AND version=$2",
        [purchaseId, p.version],
      );
      await sale.markCampaigns(db, purchaseId);
      const response = await project(db, row);
      await saveReceipt(
        db,
        a.user_id,
        "propose",
        body.operationId,
        hash,
        response,
      );
      return { proposal: response, replayed: false };
    });
  }
  async function decide(
    token: string | undefined,
    purchaseId: string,
    proposalId: string,
    input: unknown,
  ) {
    const body = releaseDecisionInputSchema.parse(input),
      hash = payloadDigest({ purchaseId, proposalId, ...body });
    safeReason(body.reason);
    const preflight = await transaction(pool, async (db) => {
      const a = await authority(db, token, env),
        p = await sale.purchase(db, purchaseId, a.stationId),
        r = await scopedProposal(db, proposalId, purchaseId, a.stationId);
      requirePermission(a, permissions[r.target_kind]);
      await independent(db, a.stationId, purchaseId, a.user_id, r.proposer_id);
      const old = await receipt(
        db,
        a.user_id,
        "decision",
        body.operationId,
        hash,
      );
      if (old) return { historical: old.response, row: r };
      if (
        p.version !== body.expectedVersion ||
        p.current_revision_id !== body.expectedRevisionId ||
        r.version !== body.expectedProposalVersion
      )
        return fail("version_conflict", 409);
      if (r.state !== "pending") return fail("review_closed", 409);
      if (body.outcome === "approve") {
        await pinReleaseV2Policy(db, a.stationId, env);
        await proposerCurrent(db, r);
      }
      return { historical: undefined, row: r };
    });
    if (preflight.historical !== undefined)
      return releaseDecisionResponseSchema.parse(preflight.historical);
    const checkedPhotos =
      body.outcome === "approve"
        ? await transaction(pool, (db) =>
            inspectPhotos(
              db,
              storage,
              purchaseId,
              preflight.row.content,
              preflight.row.proposer_person_id,
              preflight.row.proposer_id,
            ),
          )
        : null;
    return transaction(pool, async (db) => {
      const a = await authority(db, token, env);
      const p = await sale.purchase(db, purchaseId, a.stationId),
        r = await scopedProposal(db, proposalId, purchaseId, a.stationId);
      requirePermission(a, permissions[r.target_kind]);
      const person = await independent(
        db,
        a.stationId,
        purchaseId,
        a.user_id,
        r.proposer_id,
      );
      const old = await receipt(
        db,
        a.user_id,
        "decision",
        body.operationId,
        hash,
      );
      if (old) return releaseDecisionResponseSchema.parse(old.response);
      if (
        p.version !== body.expectedVersion ||
        p.current_revision_id !== body.expectedRevisionId ||
        r.version !== body.expectedProposalVersion
      )
        return fail("version_conflict", 409);
      if (r.state !== "pending") return fail("review_closed", 409);
      const did = newId(),
        actor = await actorSnapshot(db, a.user_id),
        now = (await db.query<{ now: Date }>("SELECT clock_timestamp() now"))
          .rows[0]!.now;
      let result: wire.Decision | null = null;
      let extra: Record<string, unknown> = { person };
      let auditId: string;
      if (body.outcome === "reject") {
        const before = { ...fields(r), releaseDecisionId: null };
        auditId = await writeReleaseAudit(db, {
          stationId: a.stationId,
          purchaseId,
          actorId: a.user_id,
          operationId: body.operationId,
          action: "held_release_rejected",
          before,
          after: {
            ...before,
            releaseDecisionId: did,
            releaseState: "rejected",
          },
        });
        await db.query(
          "UPDATE purchase SET version=version+1 WHERE id=$1 AND version=$2",
          [purchaseId, p.version],
        );
      } else {
        const policy = await pinReleaseV2Policy(db, a.stationId, env);
        if (
          (
            await db.query(
              "SELECT id FROM sale_decision WHERE actor_user_id=$1 AND operation_id=$2",
              [a.user_id, body.operationId],
            )
          ).rowCount
        )
          return fail("operation_conflict", 409);
        await proposerCurrent(db, r);
        if (
          p.version !== r.provenance.expectedPostVersion ||
          payloadDigest(policy) !== payloadDigest(r.provenance.policy)
        )
          return fail("proposal_stale", 409);
        let candidate = await sale.candidate(db, p);
        if (payloadDigest(candidate) !== r.provenance.candidateDigest)
          return fail("proposal_stale", 409);
        await target(db, purchaseId, r.content.target);
        await validateFacts(db, purchaseId, r.content, candidate);
        if (!checkedPhotos) return fail();
        await recheckPhotos(db, purchaseId, r.content, checkedPhotos);
        const evaluation = await classifyReleaseAdmission(
          db,
          purchaseId,
          r.content,
        );
        if (
          payloadDigest(evaluation) !== payloadDigest(r.provenance.evaluation)
        )
          return fail("proposal_stale", 409);
        const joint = await consistency(
          db,
          purchaseId,
          evaluation,
          did,
          r.outcome,
        );
        if (
          payloadDigest(joint.applied) !== payloadDigest(r.provenance.applied)
        )
          return fail("proposal_stale", 409);
        await authority(db, token, env, r.target_kind);
        await independent(
          db,
          a.stationId,
          purchaseId,
          a.user_id,
          r.proposer_id,
        );
        await proposerCurrent(db, r);
        const before = candidate.values;
        const saleDecisionId = newId();
        if (r.outcome === "cancel")
          await sale.cancel(
            db,
            p,
            a.user_id,
            a.admin_id,
            saleDecisionId,
            body.reason,
            candidate,
            body.operationId,
          );
        else {
          const t = r.content.target;
          if (t.kind === "date") {
            const c = evaluation.conclusions.find((c) => c.tag === "sale_day");
            if (!c || c.tag !== "sale_day") return fail();
            candidate = await sale.dateRevision(
              db,
              p,
              candidate,
              c.day,
              a.user_id,
              body.operationId,
              hash,
              saleDecisionId,
              body.reason,
            );
          }
          if (t.kind === "capture")
            await db.query(
              "UPDATE purchase_validation_block SET resolved_at=clock_timestamp(),resolution_reference=$2,closure_kind='confirmed',version=version+1 WHERE purchase_id=$1 AND id=ANY($3::uuid[]) AND resolved_at IS NULL",
              [purchaseId, saleDecisionId, t.blocks.map((b) => b.id)],
            );
          else {
            const changed = await db.query(
              "UPDATE purchase_hold SET state='resolved',resolved_by=$3,resolution_operation_id=$4,resolution_reason=$5,resolved_at=clock_timestamp(),resolution_revision_id=$6,version=version+1 WHERE id=$1 AND purchase_id=$2 AND state='open' AND version=$7",
              [
                t.holdId,
                purchaseId,
                a.admin_id,
                body.operationId,
                body.reason,
                candidate.id,
                t.expectedHoldVersion,
              ],
            );
            if (changed.rowCount !== 1) return fail("version_conflict", 409);
          }
          await sale.accept(db, p, candidate, a.user_id, body.reason);
        }
        const current = await sale.purchase(db, purchaseId, a.stationId);
        const holds = z
          .array(wire.holdDetailSchema)
          .parse(
            (
              await db.query(
                `SELECT ${sql.holds(false)} data FROM purchase p WHERE p.id=$1`,
                [purchaseId],
              )
            ).rows[0]!.data,
          )
          .filter((h) => h.state === "open");
        const blocks = (
          await db.query<{ code: string }>(
            "SELECT code FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL ORDER BY code",
            [purchaseId],
          )
        ).rows.map((b) => b.code);
        const after = {
          ...fields(r),
          releaseState: "approved",
          releaseDecisionId: did,
          approverId: actor.id,
          releaseConclusion:
            r.outcome === "confirm"
              ? "sheet_attested_confirm"
              : "sheet_attested_cancel",
          reviewPolicyRelease: policy.release,
          reviewPolicyRevision: String(policy.revision),
          decisionId: saleDecisionId,
          reviewEvaluationId: saleDecisionId,
          ...saleAuditValues(
            await effectiveValues(
              db,
              purchaseId,
              current.current_revision_id,
              candidate.values,
            ),
            current.current_revision_id,
            current.status === "credited",
          ),
          ...(await saleAuditGates(db, purchaseId)),
          ...(r.target_kind === "date" && r.outcome === "confirm"
            ? { verifiedSaleDate: candidate.values.verifiedSaleDate }
            : {}),
        };
        const proposedEvent = (
          await db.query<{ content: { auditEventId: string } }>(
            "SELECT content FROM held_release_transition WHERE proposal_id=$1 AND state='pending'",
            [proposalId],
          )
        ).rows[0];
        if (!proposedEvent?.content.auditEventId) return fail();
        auditId = await writeReleaseAudit(db, {
          stationId: a.stationId,
          purchaseId,
          actorId: a.user_id,
          operationId: body.operationId,
          relatedEventIds: [proposedEvent.content.auditEventId],
          action: "held_release_approved",
          before: {
            ...Object.fromEntries(Object.keys(after).map((key) => [key, null])),
            ...fields(r),
            reviewPolicyRelease: policy.release,
            reviewPolicyRevision: String(policy.revision),
            ...saleAuditValues(
              await effectiveValues(
                db,
                purchaseId,
                p.current_revision_id,
                before,
              ),
              p.current_revision_id,
              p.status === "credited",
            ),
            ...p.auditGates,
          },
          after,
        });
        result = wire.decisionSchema.parse({
          id: saleDecisionId,
          purchaseId,
          operationId: body.operationId,
          kind: "held_release",
          outcome: r.outcome,
          actor,
          reason: body.reason,
          decidedAt: now.toISOString(),
          auditEventId: auditId,
          appliedPurchaseVersion: current.version,
          appliedRevisionId: current.current_revision_id,
          before,
          after: candidate.values,
          creditedAfter:
            current.status === "credited" &&
            holds.length === 0 &&
            blocks.length === 0,
          remainingHolds: holds,
          policyBlocks: blocks,
        });
        await db.query(
          `INSERT INTO sale_decision(id,purchase_id,operation_id,actor_user_id,payload_digest,kind,outcome,expected_purchase_version,expected_revision_id,result_revision_id,applied_purchase_version,before_values,after_values,evidence_asset_id,reason,decided_at,audit_event_id,response,evidence_evaluation) VALUES($1,$2,$3,$4,$5,'held_release',$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17::jsonb,$18::jsonb)`,
          [
            saleDecisionId,
            purchaseId,
            body.operationId,
            a.user_id,
            hash,
            r.outcome,
            p.version,
            p.current_revision_id,
            current.current_revision_id,
            current.version,
            JSON.stringify(before),
            JSON.stringify(candidate.values),
            r.content.meterAssetId,
            body.reason,
            now,
            auditId,
            JSON.stringify(result),
            JSON.stringify({
              proposalId,
              policy,
              evaluation,
              certificate: joint.certificate,
            }),
          ],
        );
        await db.query(
          "INSERT INTO review_evaluation(decision_id,purchase_id,provenance) VALUES($1,$2,$3::jsonb)",
          [
            saleDecisionId,
            purchaseId,
            JSON.stringify({
              policy,
              target: r.content.target,
              interval: evaluation.originalInterval,
              attestedInterval: evaluation.attestedInterval,
              sources: evaluation.sources,
              conclusions: evaluation.conclusions,
              result,
              proposalId,
              proposer: r.provenance.person,
              approver: person,
              certificate: joint.certificate,
            }),
          ],
        );
        extra = {
          ...extra,
          attestation: joint.current,
          originalInterval: evaluation.originalInterval,
          certificate: joint.certificate,
          saleDecisionId,
        };
      }
      const decision: ReleaseDecision = {
        id: did,
        proposalId,
        operationId: body.operationId,
        outcome: body.outcome,
        actor,
        reason: body.reason,
        decidedAt: now.toISOString(),
        auditEventId: auditId,
        result,
      };
      await appendTransition(
        db,
        r,
        body.outcome === "approve" ? "approved" : "rejected",
        a.user_id,
        decision,
        extra,
      );
      await sale.markCampaigns(db, purchaseId);
      const response = {
        proposal: await project(
          db,
          await scopedProposal(db, proposalId, purchaseId, a.stationId),
        ),
        decision,
      };
      await saveReceipt(
        db,
        a.user_id,
        "decision",
        body.operationId,
        hash,
        response,
      );
      return releaseDecisionResponseSchema.parse(response);
    });
  }
  async function get(
    token: string | undefined,
    purchaseId: string,
    proposalId: string,
  ) {
    return transaction(pool, async (db) => {
      const a = await authority(db, token, env);
      await sale.purchase(db, purchaseId, a.stationId);
      const p = await scopedProposal(db, proposalId, purchaseId, a.stationId);
      requirePermission(a, permissions[p.target_kind]);
      return project(db, p);
    });
  }
  async function list(
    token: string | undefined,
    purchaseId: string,
    input: unknown = {},
  ) {
    const q = z
      .strictObject({
        cursor: z.string().max(4096).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(input);
    return transaction(pool, async (db) => {
      const a = await authority(db, token, env);
      await sale.purchase(db, purchaseId, a.stationId);
      const kinds = (Object.keys(permissions) as Kind[]).filter((k) =>
        a.permissions.includes(permissions[k]),
      );
      if (!kinds.length) return fail("permission_denied", 403);
      const scope = payloadDigest({
          purchaseId,
          stationId: a.stationId,
          user: a.user_id,
          kinds,
        }),
        secret = adminConfig().secret,
        cursor = decodeCursor(secret, scope, q.cursor);
      const rows = (
        await db.query<ProposalRow>(
          `SELECT p.*,s.state,s.version,to_char(p.proposed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at FROM held_release_proposal p JOIN held_release_state s ON s.proposal_id=p.id WHERE p.purchase_id=$1 AND p.station_id=$2 AND p.target_kind=ANY($3::text[]) AND ($4::timestamptz IS NULL OR (p.proposed_at,p.id)<($4::timestamptz,$5::uuid)) ORDER BY p.proposed_at DESC,p.id DESC LIMIT $6`,
          [
            purchaseId,
            a.stationId,
            kinds,
            cursor?.at ?? null,
            cursor?.id ?? null,
            q.limit + 1,
          ],
        )
      ).rows;
      const more = rows.length > q.limit,
        shown = rows.slice(0, q.limit),
        last = shown.at(-1);
      return {
        items: await Promise.all(shown.map((p) => project(db, p))),
        nextCursor:
          more && last
            ? encodeCursor(secret, scope, last.cursor_at!, last.id)
            : null,
      };
    });
  }
  async function photoAccess(
    token: string | undefined,
    purchaseId: string,
    proposalId: string,
    input: unknown,
  ) {
    const body = releasePhotoAccessSchema.parse(input);
    return transaction(pool, async (db) => {
      const a = await authority(db, token, env);
      await sale.purchase(db, purchaseId, a.stationId);
      const p = await scopedProposal(db, proposalId, purchaseId, a.stationId);
      requirePermission(a, permissions[p.target_kind]);
      if (p.sheet_asset_id !== body.assetId)
        return fail("evidence_unavailable", 404);
      const asset = (
        await db.query<{ display_key: string }>(
          "SELECT v.display_key FROM held_release_sheet s JOIN held_release_sheet_validation v ON v.asset_id=s.id WHERE s.id=$1 AND s.purchase_id=$2 AND s.station_id=$3 AND s.purpose='held_release_sheet'",
          [body.assetId, purchaseId, a.stationId],
        )
      ).rows[0];
      if (!asset) return fail("evidence_unavailable", 404);
      try {
        const reader = readerFactory();
        await reader.read(asset.display_key, SYNC_LIMITS.maxBytes);
        const expiresAt = new Date(Date.now() + 60000);
        const url = await reader.signGet(asset.display_key, expiresAt);
        await authority(db, token, env, p.target_kind);
        return {
          url,
          expiresAt: expiresAt.toISOString(),
          assetId: body.assetId,
        };
      } catch (e) {
        if (e instanceof AuthError) throw e;
        if (e instanceof StorageNotFoundError)
          return fail("evidence_unavailable", 404);
        return fail("storage_unavailable", 503);
      }
    });
  }
  return { propose, decide, get, list, photoAccess };
}
