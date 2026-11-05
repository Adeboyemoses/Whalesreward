import type pg from "pg";
import { requireSession } from "../../lib/authz";
import { digest } from "../auth/crypto";
import { AuthError } from "../auth/errors";
import { SyncError } from "./errors";
import type { SaleStatus } from "../../../shared/contracts/sync";
export async function transaction<T>(
  pool: pg.Pool,
  run: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await run(db);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function authority(
  db: pg.PoolClient,
  token: string | undefined,
  write = true,
) {
  if (!token) throw new AuthError("unauthenticated", 401);
  const session = await requireSession(db, digest(token));
  const r = (
    await db.query<{ id: string; expired: boolean }>(
      `SELECT a.id,c.offline_expires_at<=clock_timestamp() AS expired FROM attendant a JOIN capture_context c ON c.attendant_id=a.id AND c.id=$2 WHERE a.user_id=$1`,
      [session.user_id, session.capture_context_id],
    )
  ).rows[0];
  if (!r) throw new AuthError("unauthenticated", 401);
  if (write && r.expired) throw new SyncError("online_sign_in_required", 403);
  return { attendantId: r.id, userId: session.user_id };
}
export type Purchase = {
  id: string;
  operation_id: string;
  originating_attendant_id: string;
  payload_digest: string;
  sale_code: string;
  version: number;
  status: SaleStatus["state"];
  current_revision_id: string | null;
  customer_id: string | null;
  card_id: string | null;
  card_code: string;
  server_received_at: Date;
  capture_context_id: string;
  assignment_id: string;
  station_id: string;
  product_id: string;
  rate_kobo: string;
  currency: string;
  expected_photo_digest: string;
  expected_photo_bytes: string;
  cancellation_reason: string | null;
};
export async function ownedPurchase(
  db: pg.PoolClient,
  id: string,
  attendantId: string,
): Promise<Purchase> {
  const p = (
    await db.query<Purchase>(
      "SELECT * FROM purchase WHERE id=$1 AND originating_attendant_id=$2 FOR UPDATE",
      [id, attendantId],
    )
  ).rows[0];
  if (!p) throw new SyncError("sale_not_found", 404);
  return p;
}
export async function view(
  db: pg.PoolClient,
  p: Purchase,
): Promise<SaleStatus> {
  const customer = p.customer_id
    ? ((
        await db.query<{ id: string; name: string; category: string }>(
          "SELECT id,name,category FROM customer WHERE id=$1",
          [p.customer_id],
        )
      ).rows[0] ?? null)
    : null;
  const photoValidated =
    (
      await db.query(
        "SELECT 1 FROM photo_asset WHERE purchase_id=$1 AND state='validated'",
        [p.id],
      )
    ).rowCount! > 0;
  const holds = (
    await db.query<{ kind: "price" | "card" | "date"; reasonCode: string }>(
      `SELECT kind,reason_code AS "reasonCode" FROM purchase_hold WHERE purchase_id=$1 AND state='open' ORDER BY kind`,
      [p.id],
    )
  ).rows;
  return {
    purchaseId: p.id,
    operationId: p.operation_id,
    saleCode: p.sale_code,
    version: p.version,
    state: p.status,
    detailsReceived: true,
    photoValidated,
    credited:
      p.status === "credited" &&
      p.current_revision_id !== null &&
      photoValidated &&
      customer !== null &&
      holds.length === 0,
    currentRevisionId: p.current_revision_id,
    customer,
    holds,
    cancellationReason: p.cancellation_reason,
    pendingReason:
      p.status === "received"
        ? "lookup_pending"
        : p.status === "photo_pending"
          ? "photo_required"
          : p.status === "finalizing"
            ? "validation_pending"
            : p.status === "held"
              ? "policy_review_required"
              : null,
    serverReceivedAt: p.server_received_at.toISOString(),
  };
}
export async function audit(
  db: pg.PoolClient,
  userId: string,
  purchaseId: string,
  operationId: string,
  action: string,
  after: unknown,
) {
  const { newId } = await import("../../lib/ids");
  await db.query(
    `INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,operation_id,before,after,reason,occurred_at) VALUES($1,$2,'attendant',$3,'purchase',$4,$5,'{}',$6,$3,clock_timestamp())`,
    [newId(), userId, action, purchaseId, operationId, JSON.stringify(after)],
  );
}
