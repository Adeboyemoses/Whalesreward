import type pg from "pg";
import { AuthError } from "../auth/errors";
import {
  releaseConsistency,
  type AppliedAttestation,
} from "./release-consistency";
/** Caller holds the shared station-generation and purchase locks through commit. */
export async function assertAppliedReleaseConsistency(
  db: pg.PoolClient,
  purchaseId: string,
) {
  const rows = (
    await db.query<{
      original: { L: string; U: string };
      attestation: AppliedAttestation | null;
    }>(
      `SELECT p.provenance->'evaluation'->'originalInterval' original,t.content->'attestation' attestation FROM held_release_proposal p JOIN held_release_state s ON s.proposal_id=p.id LEFT JOIN held_release_transition t ON t.proposal_id=p.id AND t.version=s.version AND t.state='approved' WHERE p.purchase_id=$1 AND p.outcome='confirm' AND s.state='approved' ORDER BY p.id`,
      [purchaseId],
    )
  ).rows;
  if (!rows.length) return;
  const original = rows[0]!.original;
  if (
    !original ||
    rows.some(
      (r) =>
        !r.attestation ||
        JSON.stringify(r.original) !== JSON.stringify(original),
    )
  )
    throw new AuthError("evidence_insufficient", 422);
  releaseConsistency(
    original,
    rows.map((r) => r.attestation!),
    purchaseId,
  );
}
/** Union these purchase IDs with ordinary M4 blockers; never sum duplicate entries. */
export async function pendingReleaseBlockers(
  db: Pick<pg.PoolClient, "query">,
  stationId: string,
) {
  const rows = (
    await db.query<{ purchase_id: string; target_kind: string }>(
      `SELECT DISTINCT p.purchase_id,p.target_kind FROM held_release_proposal p JOIN held_release_state s ON s.proposal_id=p.id WHERE p.station_id=$1 AND s.state='pending' ORDER BY p.purchase_id`,
      [stationId],
    )
  ).rows;
  return {
    holds: rows
      .filter((r) => r.target_kind !== "capture")
      .map((r) => r.purchase_id),
    policyBlocks: rows
      .filter((r) => r.target_kind === "capture")
      .map((r) => r.purchase_id),
  };
}

/** Invoked after the ordinary closing mutation has written its actual audit event. */
export async function supersedeClosedRelease(
  db: pg.PoolClient,
  purchaseId: string,
  stationId: string,
  closingAuditEventId: string,
) {
  const { newId } = await import("../../lib/ids");
  const { writeReleaseAudit } = await import("./release-audit");
  const rows = (
    await db.query<{
      id: string;
      version: number;
      target_kind: string;
      outcome: string;
      target: { kind: string; holdId?: string; blocks?: { id: string }[] };
    }>(
      `SELECT p.id,s.version,p.target_kind,p.outcome,p.content->'target' target FROM held_release_proposal p JOIN held_release_state s ON s.proposal_id=p.id WHERE p.purchase_id=$1 AND p.station_id=$2 AND s.state='pending' FOR UPDATE OF s`,
      [purchaseId, stationId],
    )
  ).rows;
  for (const p of rows) {
    const open =
      p.target.kind === "capture"
        ? (
            await db.query(
              "SELECT id FROM purchase_validation_block WHERE purchase_id=$1 AND id=ANY($2::uuid[]) AND resolved_at IS NULL",
              [purchaseId, p.target.blocks?.map((b) => b.id) ?? []],
            )
          ).rowCount
        : (
            await db.query(
              "SELECT id FROM purchase_hold WHERE purchase_id=$1 AND id=$2 AND state='open'",
              [purchaseId, p.target.holdId],
            )
          ).rowCount;
    if (open) continue;
    const before = {
      releaseProposalId: p.id,
      releaseState: "pending",
      releaseTargetKind: p.target_kind,
      releaseOutcome: p.outcome,
    };
    const auditId = await writeReleaseAudit(db, {
      stationId,
      purchaseId,
      actorId: null,
      operationId: null,
      action: "held_release_superseded",
      before,
      after: { ...before, releaseState: "superseded" },
      relatedEventIds: [closingAuditEventId],
    });
    await db.query(
      "UPDATE held_release_state SET state='superseded',version=version+1 WHERE proposal_id=$1 AND state='pending' AND version=$2",
      [p.id, p.version],
    );
    await db.query(
      "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,$3,'superseded',NULL,$4::jsonb)",
      [
        newId(),
        p.id,
        p.version + 1,
        JSON.stringify({ auditEventId: auditId, closingAuditEventId }),
      ],
    );
  }
}
