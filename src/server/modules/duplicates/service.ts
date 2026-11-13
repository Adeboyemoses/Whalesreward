import {
  writeAudit,
  auditTarget,
  auditSeller,
  auditSystem,
} from "../audit/write";
import type pg from "pg";
import { newId } from "../../lib/ids";
import { duplicateWindow, duplicateWindowSchema } from "./config";
export async function enqueueDuplicateDetection(
  db: pg.PoolClient,
  purchaseId: string,
) {
  const station = (
    await db.query("SELECT station_id FROM purchase WHERE id=$1", [purchaseId])
  ).rows[0];
  await db.query(
    "INSERT INTO duplicate_detection_intent(id,purchase_id,policy) VALUES($1,$2,$3)",
    [
      newId(),
      purchaseId,
      JSON.stringify(duplicateWindow(process.env, station?.station_id)),
    ],
  );
}
/** A transaction-scoped row lease rolls back automatically after a worker crash. */
export async function runDuplicateBatch(pool: pg.Pool) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const intent = (
      await db.query(
        "SELECT i.*,p.station_id FROM duplicate_detection_intent i JOIN purchase p ON p.id=i.purchase_id WHERE NOT i.done ORDER BY i.created_at,i.id LIMIT 1 FOR UPDATE OF i SKIP LOCKED",
      )
    ).rows[0];
    if (!intent) {
      await db.query("COMMIT");
      return false;
    }
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('reporting:'||$1::text,0))",
      [intent.station_id],
    );
    const policy = duplicateWindowSchema.safeParse(intent.policy);
    const ids = (
      await db.query(
        "SELECT p.id FROM purchase p WHERE p.station_id=$1 AND p.id<>$2 AND ($3::uuid IS NULL OR p.id>$3) AND EXISTS (SELECT 1 FROM sync_validation v WHERE v.purchase_id=p.id) ORDER BY p.id LIMIT 100",
        [intent.station_id, intent.purchase_id, intent.cursor_id],
      )
    ).rows;
    for (const { id } of ids) {
      await db.query(
        "SELECT id FROM purchase WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [[intent.purchase_id, id]],
      );
      const match = (
        await db.query(
          `SELECT a.id FROM purchase a JOIN purchase b ON b.id=$2
LEFT JOIN purchase_revision ar ON ar.id=a.current_revision_id LEFT JOIN purchase_revision br ON br.id=b.current_revision_id
WHERE a.id=$1 AND a.status<>'cancelled' AND b.status<>'cancelled' AND (
EXISTS (SELECT 1 FROM photo_asset x JOIN photo_asset y ON y.purchase_id=b.id AND y.state='validated' AND y.validated_digest=x.validated_digest WHERE x.purchase_id=a.id AND x.state='validated' AND x.validated_digest IS NOT NULL)
OR ($3::int IS NOT NULL AND a.customer_id=b.customer_id AND a.product_id=b.product_id
AND coalesce(ar.basis,a.basis)=coalesce(br.basis,b.basis)
AND ((coalesce(ar.basis,a.basis)='amount' AND a.currency=b.currency AND coalesce(ar.entered_amount_kobo,a.entered_amount_kobo)=coalesce(br.entered_amount_kobo,b.entered_amount_kobo))
OR (coalesce(ar.basis,a.basis)='quantity' AND a.unit=b.unit AND coalesce(ar.entered_quantity,a.entered_quantity)=coalesce(br.entered_quantity,b.entered_quantity)))
AND abs(extract(epoch FROM (a.app_captured_at-b.app_captured_at)))<=$3))`,
          [
            intent.purchase_id,
            id,
            policy.success ? policy.data.windowSeconds : null,
          ],
        )
      ).rows.length;
      if (!match) continue;
      const pair = [intent.purchase_id, id].sort();
      const inserted = await db.query(
        "INSERT INTO duplicate_flag(id,purchase_id,other_purchase_id,reason,state,version) VALUES($1,$2,$3,'suspected_duplicate','open',1) ON CONFLICT(purchase_id,other_purchase_id) DO NOTHING RETURNING id",
        [newId(), ...pair],
      );
      if (!inserted.rowCount) continue;
      await db.query(
        "UPDATE purchase SET version=version+1 WHERE id=ANY($1::uuid[])",
        [pair],
      );
      await db.query(
        "INSERT INTO duplicate_reporting_state(station_id,generation) VALUES($1,1) ON CONFLICT(station_id) DO UPDATE SET generation=duplicate_reporting_state.generation+1",
        [intent.station_id],
      );
      await writeAudit(db, {
        stationId: intent.station_id,
        action: "duplicate_flagged",
        actor: auditSystem("validation"),
        target: await auditTarget(db, "purchase", pair[0]!, intent.station_id),
        originatingSeller: await auditSeller(db, pair[0]!),
        reason: "Suspected duplicate",
        before: null,
        after: {
          flagId: inserted.rows[0].id,
          purchaseIds: pair,
          duplicateState: "open",
        },
      });
    }
    await db.query(
      "UPDATE duplicate_detection_intent SET cursor_id=$2,done=$3 WHERE id=$1",
      [intent.id, ids.at(-1)?.id ?? intent.cursor_id, ids.length < 100],
    );
    await db.query("COMMIT");
    return true;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
