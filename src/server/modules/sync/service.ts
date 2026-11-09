import { lookupReceiptConfig, type LookupReceiptKeys } from "./lookup-receipt";
import { issueLookupReceipt, freezeLookupEvidence } from "./lookup-evidence";
import type pg from "pg";
import {
  originalSaleSchema,
  uploadSchema,
  finalizeSchema,
  lookupSchema,
  SYNC_LIMITS,
  type OriginalSale,
  type UploadRequest,
  type FinalizeRequest,
  type LookupInput,
  type Lookup,
  type UploadPermission,
} from "../../../shared/contracts/sync";
import { parseKobo } from "../../../shared/money";
import {
  parseQuantity,
  amountToQuantity,
  quantityToAmount,
} from "../../../shared/quantity";
import { newId } from "../../lib/ids";
import type { EvidenceStorage } from "../../adapters/storage";
import { StorageSizeError } from "../../adapters/storage";
import { SyncError } from "./errors";
import { canonicalJson, payloadDigest } from "./canonical";
import {
  transaction,
  authority,
  ownedPurchase,
  view,
  audit,
  type Purchase,
} from "./repo";
import { validatePhoto } from "./photo";
import { settle } from "./settle";
function parsed<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  value: unknown,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new SyncError("invalid_request", 400);
  return r.data!;
}
function calculation(sale: OriginalSale) {
  try {
    const rate = parseKobo(sale.rateKobo),
      amount = parseKobo(sale.entry.amountKobo),
      quantity = parseQuantity(sale.entry.quantity, sale.quantityPrecision);
    if (sale.entry.basis === "amount") {
      if (
        amount !== parseKobo(sale.entry.enteredAmountKobo) ||
        quantity !==
          parseQuantity(amountToQuantity(amount, rate, sale.quantityPrecision))
      )
        throw new Error();
    } else if (
      quantity !==
        parseQuantity(sale.entry.enteredQuantity, sale.quantityPrecision) ||
      amount !==
        quantityToAmount(
          sale.entry.enteredQuantity,
          rate,
          sale.quantityPrecision,
        )
    )
      throw new Error();
  } catch {
    throw new SyncError("calculation_invalid", 422);
  }
}
type Context = {
  attendant_id: string;
  assignment_id: string;
  station_id: string;
  pump_id: string;
  product_id: string;
  seller_name: string;
  seller_username: string;
  unit: string;
  product_code: string;
};
export function createSyncService({
  pool,
  storage,
  lookupReceiptKeys = lookupReceiptConfig,
}: {
  pool: pg.Pool;
  storage: EvidenceStorage;
  lookupReceiptKeys?: () => LookupReceiptKeys;
}) {
  async function resolve(token: string | undefined, id: string) {
    return transaction(pool, async (db) => {
      const auth = await authority(db, token);
      const p = await ownedPurchase(db, id, auth.attendantId);
      if (p.status !== "received") return view(db, p);
      const linked = (
        await db.query<{ card_id: string; customer_id: string }>(
          `SELECT c.id AS card_id,l.customer_id FROM card c JOIN card_customer_link l ON l.card_id=c.id WHERE c.code=$1 AND l.linked_at<=(SELECT server_received_at FROM purchase WHERE id=$2) ORDER BY l.linked_at DESC LIMIT 1`,
          [p.card_code, p.id],
        )
      ).rows[0];
      const next = linked ? "photo_pending" : "cancelled";
      await db.query(
        `UPDATE purchase SET card_id=$2,customer_id=$3,status=$4,cancellation_reason=$5,version=version+1 WHERE id=$1 AND status='received' AND version=$6`,
        [
          id,
          linked?.card_id ?? null,
          linked?.customer_id ?? null,
          next,
          linked ? null : "customer_not_found",
          p.version,
        ],
      );
      if (!linked)
        await audit(
          db,
          auth.userId,
          p.id,
          p.operation_id,
          "purchase.cancelled",
          { reason: "customer_not_found" },
        );
      return view(db, await ownedPurchase(db, id, auth.attendantId));
    });
  }
  return {
    async identity(token: string | undefined) {
      return transaction(pool, (db) => authority(db, token, false));
    },
    async lookup(
      token: string | undefined,
      input: LookupInput,
      receiptCapable = false,
    ): Promise<Lookup> {
      const body = parsed(lookupSchema, input);
      const code = body.source === "code" ? body.code : body.qr;
      return transaction(pool, async (db) => {
        const auth = await authority(db, token);
        const card = (
          await db.query<{ id: string; state: string; status: string }>(
            `SELECT c.id,c.state,b.status FROM card c JOIN card_batch b ON b.id=c.batch_id WHERE c.code=$1 FOR SHARE OF c,b`,
            [code],
          )
        ).rows[0];
        if (card?.state === "retired")
          throw new SyncError("card_unavailable", 422);
        const customer =
          card && card.status === "active"
            ? (
                await db.query<{ id: string; name: string; category: string }>(
                  `SELECT c.id,c.name,c.category FROM card_customer_link l JOIN customer c ON c.id=l.customer_id WHERE l.card_id=$1 AND l.ended_at IS NULL`,
                  [card.id],
                )
              ).rows[0]
            : undefined;
        if (!customer) throw new SyncError("customer_not_found", 404);
        return {
          cardCode: code,
          customer,
          lookedUpAt: new Date().toISOString(),
          ...(receiptCapable
            ? {
                lookupReceipt: await issueLookupReceipt(
                  db,
                  auth.captureContextId,
                  auth.attendantId,
                  card!.id,
                  lookupReceiptKeys(),
                ),
              }
            : {}),
        };
      });
    },
    async submit(token: string | undefined, input: OriginalSale) {
      const sale = parsed(originalSaleSchema, input);
      const hash = payloadDigest(sale);
      const inserted = await transaction(pool, async (db) => {
        const auth = await authority(db, token);
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `original:${auth.attendantId}:${sale.operationId}`,
        ]);
        const existing = (
          await db.query<Purchase>(
            "SELECT * FROM purchase WHERE originating_attendant_id=$1 AND operation_id=$2 FOR UPDATE",
            [auth.attendantId, sale.operationId],
          )
        ).rows[0];
        if (existing) {
          if (existing.payload_digest !== hash)
            throw new SyncError("operation_conflict", 409);
          return { id: existing.id, created: false };
        }
        calculation(sale);
        const ctx = (
          await db.query<Context>(
            `SELECT c.attendant_id,c.assignment_id,c.seller_name,c.seller_username,p.id AS pump_id,p.station_id,p.product_id,pr.unit,pr.code AS product_code FROM capture_context c JOIN assignment a ON a.id=c.assignment_id AND a.attendant_id=c.attendant_id JOIN pump p ON p.id=a.pump_id JOIN product pr ON pr.id=p.product_id WHERE c.id=$1 AND c.attendant_id=$2 AND c.assignment_id=$3`,
            [sale.captureContextId, auth.attendantId, sale.assignmentId],
          )
        ).rows[0];
        if (!ctx) throw new SyncError("capture_context_invalid", 422);
        if (
          ctx.unit !== sale.unit ||
          (ctx.product_code === "cooking_gas"
            ? sale.medium !== "cylinder"
            : sale.medium === "cylinder")
        )
          throw new SyncError("medium_invalid", 422);
        const price = (
          await db.query(
            "SELECT 1 FROM product_price_version WHERE id=$1 AND station_id=$2 AND product_id=$3 AND quantity_precision=$4 AND rate_kobo=$5 AND currency=$6",
            [
              sale.priceVersionId,
              ctx.station_id,
              ctx.product_id,
              sale.quantityPrecision,
              sale.rateKobo,
              sale.currency,
            ],
          )
        ).rowCount;
        if (!price) throw new SyncError("calculation_invalid", 422);
        const id = newId();
        const evidence = await freezeLookupEvidence(
          db,
          sale.lookupReceipt,
          sale.captureContextId,
          auth.attendantId,
          ctx.station_id,
          sale.cardCode,
          lookupReceiptKeys(),
        );
        await db.query(
          `INSERT INTO purchase(id,originating_attendant_id,operation_id,payload_digest,sale_code,capture_context_id,assignment_id,station_id,pump_id,product_id,seller_name,seller_username,card_code,app_captured_at,server_received_at,price_version_id,basis,entered_amount_kobo,entered_quantity,amount_kobo,quantity,rate_kobo,currency,unit,quantity_precision,medium,expected_photo_digest,expected_photo_bytes,status,version,lookup_receipt_input,lookup_receipt_status,lookup_receipt_claims,capture_lower_bound,capture_policy_version)
     VALUES($1,$2,$3,$4,'S'||nextval('sync_sale_code_seq'),$5,$6,$7,$8,$9,$10,$11,$12,$13,$27::timestamptz,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'received',1,$28::jsonb,$29,$30::jsonb,$31::timestamptz,'p23-3')`,
          [
            id,
            auth.attendantId,
            sale.operationId,
            hash,
            sale.captureContextId,
            sale.assignmentId,
            ctx.station_id,
            ctx.pump_id,
            ctx.product_id,
            ctx.seller_name,
            ctx.seller_username,
            sale.cardCode,
            sale.appCapturedAt,
            sale.priceVersionId,
            sale.entry.basis,
            sale.entry.basis === "amount" ? sale.entry.enteredAmountKobo : null,
            sale.entry.basis === "quantity" ? sale.entry.enteredQuantity : null,
            sale.entry.amountKobo,
            sale.entry.quantity,
            sale.rateKobo,
            sale.currency,
            sale.unit,
            sale.quantityPrecision,
            sale.medium,
            sale.photo.sha256,
            sale.photo.bytes,
            evidence.receivedAt,
            canonicalJson(sale.lookupReceipt ?? null),
            evidence.status,
            evidence.claims ? JSON.stringify(evidence.claims) : null,
            evidence.lowerBound,
          ],
        );
        return { id, created: true };
      });
      // This separate transaction is intentional: a lookup outage cannot erase R.
      return {
        status: await resolve(token, inserted.id),
        created: inserted.created,
      };
    },
    async status(token: string | undefined, operationId: string) {
      return transaction(pool, async (db) => {
        const auth = await authority(db, token, false);
        const p = (
          await db.query<Purchase>(
            "SELECT * FROM purchase WHERE originating_attendant_id=$1 AND operation_id=$2",
            [auth.attendantId, operationId],
          )
        ).rows[0];
        if (!p) throw new SyncError("sale_not_found", 404);
        return view(db, p);
      });
    },
    async uploadPermission(
      token: string | undefined,
      purchaseId: string,
      input: UploadRequest,
    ): Promise<UploadPermission> {
      const body = parsed(uploadSchema, input);
      const asset = await transaction(pool, async (db) => {
        const auth = await authority(db, token);
        const p = await ownedPurchase(db, purchaseId, auth.attendantId);
        const existing = (
          await db.query<{
            id: string;
            staging_key: string;
            staging_expires_at: Date;
            expected_digest: string;
            expected_bytes: string;
          }>(
            "SELECT * FROM photo_asset WHERE purchase_id=$1 AND upload_operation_id=$2",
            [p.id, body.operationId],
          )
        ).rows[0];
        if (
          existing &&
          (existing.expected_digest !== body.sha256 ||
            existing.expected_bytes !== String(body.bytes))
        )
          throw new SyncError("operation_conflict", 409);
        if (
          body.sha256 !== p.expected_photo_digest ||
          String(body.bytes) !== p.expected_photo_bytes
        )
          throw new SyncError("photo_metadata_invalid", 422);
        if (!["photo_pending", "finalizing"].includes(p.status))
          throw new SyncError("sale_not_uploadable", 409);
        if (existing) {
          if (existing.staging_expires_at.getTime() <= Date.now())
            throw new SyncError("upload_permission_expired", 409);
          return existing;
        }
        const id = newId(),
          key = `staging/${newId()}/${newId()}`;
        return (
          await db.query<{
            id: string;
            staging_key: string;
            staging_expires_at: Date;
          }>(
            `INSERT INTO photo_asset(id,purchase_id,upload_operation_id,state,staging_key,staging_expires_at,expected_digest,expected_bytes) VALUES($1,$2,$3,'staged',$4,clock_timestamp()+interval '5 minutes',$5,$6) RETURNING id,staging_key,staging_expires_at`,
            [id, p.id, body.operationId, key, body.sha256, body.bytes],
          )
        ).rows[0]!;
      });
      try {
        const signed = await storage.signPut(
          asset.staging_key,
          asset.staging_expires_at,
          body.bytes,
        );
        return {
          uploadId: asset.id,
          method: "PUT",
          ...signed,
          expiresAt: asset.staging_expires_at.toISOString(),
          maxBytes: SYNC_LIMITS.maxBytes,
        };
      } catch {
        throw new SyncError("temporarily_unavailable", 503);
      }
    },
    async finalize(
      token: string | undefined,
      purchaseId: string,
      input: FinalizeRequest,
    ) {
      const body = parsed(finalizeSchema, input),
        hash = payloadDigest(body);
      const staged = await transaction(pool, async (db) => {
        const auth = await authority(db, token),
          p = await ownedPurchase(db, purchaseId, auth.attendantId);
        const existing = (
          await db.query<{ payload_digest: string; completed_at: Date | null }>(
            "SELECT * FROM sync_finalize_operation WHERE purchase_id=$1 AND operation_id=$2",
            [p.id, body.operationId],
          )
        ).rows[0];
        if (existing && existing.payload_digest !== hash)
          throw new SyncError("operation_conflict", 409);
        if (existing?.completed_at) return { done: await view(db, p) };
        if (p.version !== body.expectedVersion)
          throw new SyncError("stale_version", 409);
        if (p.status !== "photo_pending")
          throw new SyncError("sale_not_uploadable", 409);
        const asset = (
          await db.query<{ id: string; staging_key: string }>(
            "SELECT id,staging_key FROM photo_asset WHERE id=$1 AND purchase_id=$2 AND state='staged'",
            [body.uploadId, p.id],
          )
        ).rows[0];
        if (!asset) throw new SyncError("upload_not_found", 422);
        if (!existing)
          await db.query(
            "INSERT INTO sync_finalize_operation(purchase_id,operation_id,payload_digest,upload_id,expected_version) VALUES($1,$2,$3,$4,$5)",
            [p.id, body.operationId, hash, body.uploadId, body.expectedVersion],
          );
        return { p, asset };
      });
      if (staged.done) return staged.done;
      const { p, asset } = staged;
      let bytes: Buffer;
      try {
        bytes = await storage.read(asset!.staging_key, SYNC_LIMITS.maxBytes);
      } catch (e) {
        if (e instanceof StorageSizeError)
          throw new SyncError("photo_invalid", 422, "size_exceeded");
        throw new SyncError("storage_unavailable", 503);
      }
      const photo = await validatePhoto(
        bytes,
        p!.expected_photo_digest,
        Number(p!.expected_photo_bytes),
      );
      const finalKey = `final/${newId()}/${newId()}`;
      try {
        await storage.writeFinal(finalKey, bytes);
      } catch {
        throw new SyncError("storage_unavailable", 503);
      }
      // No DB lock is held during storage. Revoke/disable wins before this authority check.
      return transaction(pool, async (db) => {
        const auth = await authority(db, token);
        const current = await ownedPurchase(db, purchaseId, auth.attendantId);
        const op = (
          await db.query<{ completed_at: Date | null }>(
            "SELECT completed_at FROM sync_finalize_operation WHERE purchase_id=$1 AND operation_id=$2",
            [purchaseId, body.operationId],
          )
        ).rows[0]!;
        if (op.completed_at) return view(db, current);
        if (current.version !== body.expectedVersion)
          throw new SyncError("stale_version", 409);
        if (current.status !== "photo_pending")
          throw new SyncError("sale_not_uploadable", 409);
        await db.query(
          "UPDATE purchase SET status='finalizing',version=version+1 WHERE id=$1 AND status='photo_pending' AND version=$2",
          [purchaseId, body.expectedVersion],
        );
        const validated = await db.query(
          `UPDATE photo_asset SET state='validated',final_key=$3,validated_digest=$4,validated_bytes=$5,width=$6,height=$7,media_type='image/jpeg',validated_at=clock_timestamp() WHERE id=$1 AND purchase_id=$2 AND state='staged'`,
          [
            body.uploadId,
            purchaseId,
            finalKey,
            photo!.digest,
            photo!.bytes,
            photo!.width,
            photo!.height,
          ],
        );
        if (validated.rowCount !== 1) throw new SyncError("stale_version", 409);
        await settle(db, current, auth.userId, body.operationId, body.uploadId);
        await db.query(
          "UPDATE sync_finalize_operation SET completed_at=clock_timestamp() WHERE purchase_id=$1 AND operation_id=$2 AND completed_at IS NULL",
          [purchaseId, body.operationId],
        );
        return view(db, await ownedPurchase(db, purchaseId, auth.attendantId));
      });
    },
  };
}
