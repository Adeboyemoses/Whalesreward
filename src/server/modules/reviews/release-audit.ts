import type pg from "pg";
import {
  writeAudit,
  auditActor,
  auditTarget,
  auditSeller,
  auditSystem,
} from "../audit/write";

export async function writeReleaseAudit(
  db: pg.PoolClient,
  input: {
    stationId: string;
    purchaseId: string;
    actorId: string | null;
    operationId: string | null;
    action:
      | "held_release_proposed"
      | "held_release_approved"
      | "held_release_rejected"
      | "held_release_superseded";
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
    relatedEventIds?: string[];
  },
) {
  return writeAudit(db, {
    stationId: input.stationId,
    action: input.action,
    actor: input.actorId
      ? await auditActor(db, input.actorId)
      : auditSystem("validation"),
    target: await auditTarget(db, "purchase", input.purchaseId, input.stationId),
    originatingSeller: await auditSeller(db, input.purchaseId),
    operationId: input.operationId,
    reason: {
      held_release_proposed: "Held sale release proposed",
      held_release_approved: "Held sale release approved",
      held_release_rejected: "Held sale release rejected",
      held_release_superseded: "Held sale release superseded",
    }[input.action],
    before: input.before,
    after: input.after,
    relatedEventIds: input.relatedEventIds,
  });
}
