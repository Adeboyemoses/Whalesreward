import type pg from "pg";
import { createHash } from "node:crypto";
import { authId } from "../../../shared/contracts/auth";
import {
  photoAccessInputSchema,
  photoAccessSchema,
} from "../../../shared/contracts/sales";
import { SYNC_LIMITS } from "../../../shared/contracts/sync";
import { transaction } from "../admin-access/repo";
import { AuthError } from "../auth/errors";
import { salesAuthority, type Audience } from "./service";
import {
  createSaleEvidenceReader,
  EvidenceObjectMissing,
  SALE_PHOTO_TTL_SECONDS,
  type SaleEvidenceReader,
} from "../../adapters/sale-evidence";
type Asset = {
  id: string;
  state: string;
  final_key: string | null;
  validated_digest: string | null;
  validated_bytes: string | null;
  deleted_at: Date | null;
  media_type: string | null;
};
export async function readSalePhoto(
  pool: pg.Pool,
  token: string | undefined,
  audience: Audience,
  purchaseId: string,
  input: unknown = {},
  readerFactory: () => SaleEvidenceReader = createSaleEvidenceReader,
) {
  authId.parse(purchaseId);
  const selected =
    audience === "admin" ? photoAccessInputSchema.parse(input).assetId : null;
  return transaction(pool, async (db) => {
    const scope = await salesAuthority(db, token, audience);
    const find = async () => {
      const purchase = (
        await db.query(
          `SELECT id FROM purchase WHERE id=$1 AND station_id=$2 AND ($3::uuid IS NULL OR originating_attendant_id=$3)`,
          [purchaseId, scope.stationId, scope.attendantId],
        )
      ).rows[0];
      if (!purchase) throw new AuthError("not_found", 404);
      const asset = (
        await db.query<Asset>(
          `SELECT id,state,final_key,validated_digest,validated_bytes::text,deleted_at,media_type FROM photo_asset WHERE purchase_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY (state='validated') DESC,created_at DESC,id DESC LIMIT 1`,
          [purchaseId, selected],
        )
      ).rows[0];
      if (!asset) throw new AuthError("evidence_unavailable", 404);
      if (asset.state === "deleted" || asset.deleted_at)
        throw new AuthError("evidence_deleted", 410);
      if (asset.state !== "validated")
        throw new AuthError("evidence_pending", 409);
      if (
        !asset.final_key ||
        !asset.validated_digest ||
        !asset.validated_bytes ||
        asset.media_type !== "image/jpeg"
      )
        throw new AuthError("evidence_unavailable", 404);
      return asset as Asset & {
        final_key: string;
        validated_digest: string;
        validated_bytes: string;
      };
    };
    const asset = await find();
    // Configuration failures must not mask authentication or resource failures.
    let reader: SaleEvidenceReader;
    try {
      reader = readerFactory();
    } catch {
      throw new AuthError("storage_unavailable", 503);
    }
    try {
      if (audience === "admin") {
        if (
          !(await reader.available(
            asset.final_key,
            BigInt(asset.validated_bytes),
          ))
        )
          throw new AuthError("evidence_unavailable", 404);
        const expiresAt = new Date(Date.now() + SALE_PHOTO_TTL_SECONDS * 1000);
        const url = await reader.signGet(asset.final_key, expiresAt);
        await salesAuthority(db, token, audience);
        const current = await find();
        if (current.id !== asset.id || current.final_key !== asset.final_key)
          throw new AuthError("evidence_unavailable", 404);
        return photoAccessSchema.parse({
          url,
          expiresAt: expiresAt.toISOString(),
          assetId: asset.id,
        });
      }
      const bytes = await reader.read(asset.final_key, SYNC_LIMITS.maxBytes);
      if (
        BigInt(bytes.length) !== BigInt(asset.validated_bytes) ||
        createHash("sha256").update(bytes).digest("hex") !==
          asset.validated_digest
      )
        throw new AuthError("evidence_unavailable", 404);
      // This is the authorization boundary immediately before the JPEG response.
      await salesAuthority(db, token, audience);
      const current = await find();
      if (
        current.id !== asset.id ||
        current.validated_digest !== asset.validated_digest
      )
        throw new AuthError("evidence_unavailable", 404);
      return bytes;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      if (e instanceof EvidenceObjectMissing)
        throw new AuthError("evidence_unavailable", 404);
      throw new AuthError("storage_unavailable", 503);
    }
  });
}
