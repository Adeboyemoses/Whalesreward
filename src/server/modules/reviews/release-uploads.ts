import type pg from "pg";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { newId } from "../../lib/ids";
import {
  releaseSheetReservationSchema,
  releaseSheetFinalizeSchema,
  releaseTargetSchema,
} from "../../../shared/contracts/held-release";
import type { EvidenceStorage } from "../../adapters/storage";
import { transaction } from "../sync/repo";
import { payloadDigest } from "../sync/canonical";
import { AuthError } from "../auth/errors";
import { releaseAuthority } from "./release-authority";
import { prepareReleaseSheet } from "./release-photo";
import { pinReleaseV2Policy, type ReviewEnvironment } from "./config";

type Sheet = {
  id: string;
  purchase_id: string;
  station_id: string;
  uploader_id: string;
  uploader_person_id: string;
  target: z.infer<typeof releaseTargetSchema>;
  sha256: string;
  bytes: number;
  staging_key: string;
  expires_at: Date;
};
async function receipt(
  db: pg.PoolClient,
  actor: string,
  kind: string,
  id: string,
  digest: string,
) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `held-release-receipt:${actor}:${kind}:${id}`,
  ]);
  const row = (
    await db.query(
      "SELECT payload_digest,response FROM held_release_receipt WHERE actor_id=$1 AND operation_kind=$2 AND operation_id=$3",
      [actor, kind, id],
    )
  ).rows[0];
  if (row && row.payload_digest !== digest)
    throw new AuthError("operation_conflict", 409);
  return row?.response;
}
async function save(
  db: pg.PoolClient,
  actor: string,
  kind: string,
  id: string,
  digest: string,
  response: unknown,
) {
  await db.query(
    "INSERT INTO held_release_receipt(actor_id,operation_kind,operation_id,payload_digest,response) VALUES($1,$2,$3,$4,$5::jsonb)",
    [actor, kind, id, digest, JSON.stringify(response)],
  );
}
export function createReleaseUploadsService({
  pool,
  storage,
  env = process.env,
}: {
  pool: pg.Pool;
  storage: EvidenceStorage;
  env?: ReviewEnvironment;
}) {
  async function load(
    db: pg.PoolClient,
    token: string | undefined,
    purchaseId: string,
    uploadId: string,
  ) {
    // Scope by purchase before authority; caller receives only a non-disclosing failure.
    const sheet = (
      await db.query<Sheet>(
        "SELECT * FROM held_release_sheet WHERE id=$1 AND purchase_id=$2 AND purpose='held_release_sheet'",
        [uploadId, purchaseId],
      )
    ).rows[0];
    if (!sheet) throw new AuthError("not_found", 404);
    const auth = await releaseAuthority(
      db,
      token,
      releaseTargetSchema.parse(sheet.target).kind,
      purchaseId,
    );
    if (
      sheet.station_id !== auth.actor.stationId ||
      sheet.uploader_id !== auth.actor.user_id ||
      sheet.uploader_person_id !== auth.person.personId
    )
      throw new AuthError("not_found", 404);
    return { sheet, ...auth };
  }
  async function current(db: pg.PoolClient, sheet: Sheet) {
    await db.query("SELECT id FROM held_release_sheet WHERE id=$1 FOR UPDATE", [
      sheet.id,
    ]);
    if (
      (
        await db.query(
          "SELECT asset_id FROM held_release_sheet_validation WHERE asset_id=$1",
          [sheet.id],
        )
      ).rowCount
    )
      throw new AuthError("evidence_already_validated", 409);
    const expired = (
      await db.query("SELECT $1::timestamptz<=clock_timestamp() AS expired", [
        sheet.expires_at,
      ])
    ).rows[0].expired;
    if (expired) throw new AuthError("upload_expired", 409);
  }
  return {
    async reserve(token: string | undefined, purchaseId: string, raw: unknown) {
      const input = releaseSheetReservationSchema.parse(raw),
        digest = payloadDigest({ purchaseId, input });
      return transaction(pool, async (db) => {
        const auth = await releaseAuthority(
          db,
          token,
          input.target.kind,
          purchaseId,
        );
        const previous = await receipt(
          db,
          auth.actor.user_id,
          "sheet-reserve",
          input.operationId,
          digest,
        );
        if (previous) {
          const retained = (
            await db.query(
              "SELECT uploader_person_id FROM held_release_sheet WHERE id=$1 AND purchase_id=$2 AND uploader_id=$3",
              [previous.assetId, purchaseId, auth.actor.user_id],
            )
          ).rows[0];
          if (!retained || retained.uploader_person_id !== auth.person.personId)
            throw new AuthError("independent_reviewer_required", 403);
          return { data: previous, replayed: true };
        }
        const policy = await pinReleaseV2Policy(db, auth.actor.stationId, env);
        if (input.target.kind === "capture") {
          const blocks = (
            await db.query(
              "SELECT id,version,code FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL AND code IN ('capture_authorization_unresolved','capture_time_unresolved') ORDER BY id",
              [purchaseId],
            )
          ).rows;
          if (!blocks.length) throw new AuthError("review_closed", 409);
          if (payloadDigest(blocks) !== payloadDigest(input.target.blocks))
            throw new AuthError("version_conflict", 409);
        } else {
          const hold = (
            await db.query(
              "SELECT kind,state,version FROM purchase_hold WHERE id=$1 AND purchase_id=$2",
              [input.target.holdId, purchaseId],
            )
          ).rows[0];
          if (!hold) throw new AuthError("not_found", 404);
          if (hold.kind !== input.target.kind)
            throw new AuthError("hold_kind_mismatch", 422);
          if (hold.state !== "open") throw new AuthError("review_closed", 409);
          if (hold.version !== input.target.expectedHoldVersion)
            throw new AuthError("version_conflict", 409);
        }
        const id = newId();
        await db.query(
          `INSERT INTO held_release_sheet(id,purchase_id,station_id,uploader_id,uploader_person_id,target,sha256,bytes,staging_key,expires_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,clock_timestamp()+interval '15 minutes')`,
          [
            id,
            purchaseId,
            auth.actor.stationId,
            auth.actor.user_id,
            auth.person.personId,
            JSON.stringify(input.target),
            input.sha256,
            input.bytes,
            `staging/${policy.scope.environment}/held_release_sheet/${randomUUID()}`,
          ],
        );
        const data = { uploadId: id, assetId: id };
        await save(
          db,
          auth.actor.user_id,
          "sheet-reserve",
          input.operationId,
          digest,
          data,
        );
        return { data, replayed: false };
      });
    },
    async uploadUrl(
      token: string | undefined,
      purchaseId: string,
      uploadId: string,
      raw: unknown,
    ) {
      z.strictObject({}).parse(raw);
      return transaction(pool, async (db) => {
        const { sheet, actor } = await load(db, token, purchaseId, uploadId);
        await pinReleaseV2Policy(db, actor.stationId, env);
        await current(db, sheet);
        const now = (await db.query("SELECT clock_timestamp() AS now")).rows[0]
          .now as Date;
        const expiresAt = new Date(
          Math.min(sheet.expires_at.getTime(), now.getTime() + 300000),
        );
        let signed;
        try {
          signed = await storage.signPut(
            sheet.staging_key,
            expiresAt,
            sheet.bytes,
          );
        } catch {
          throw new AuthError("storage_unavailable", 503);
        }
        await releaseAuthority(db, token, sheet.target.kind, purchaseId);
        await current(db, sheet);
        return {
          url: signed.url,
          expiresAt: expiresAt.toISOString(),
          assetId: sheet.id,
          maxBytes: sheet.bytes,
        };
      });
    },
    async finalize(
      token: string | undefined,
      purchaseId: string,
      uploadId: string,
      raw: unknown,
    ) {
      const input = releaseSheetFinalizeSchema.parse(raw),
        digest = payloadDigest({ purchaseId, uploadId, input });
      const initial = await transaction(pool, async (db) => {
        const auth = await load(db, token, purchaseId, uploadId);
        const previous = await receipt(
          db,
          auth.actor.user_id,
          "sheet-finalize",
          input.operationId,
          digest,
        );
        if (previous) return { previous };
        const policy = await pinReleaseV2Policy(db, auth.actor.stationId, env);
        await current(db, auth.sheet);
        return { auth, policy };
      });
      if ("previous" in initial) return initial.previous;
      const prepared = await prepareReleaseSheet(
        storage,
        {
          stagingKey: initial.auth.sheet.staging_key,
          digest: initial.auth.sheet.sha256,
          bytes: initial.auth.sheet.bytes,
        },
        initial.policy.scope.environment,
      );
      return transaction(pool, async (db) => {
        const auth = await load(db, token, purchaseId, uploadId);
        const previous = await receipt(
          db,
          auth.actor.user_id,
          "sheet-finalize",
          input.operationId,
          digest,
        );
        if (previous) return previous;
        const policy = await pinReleaseV2Policy(db, auth.actor.stationId, env);
        if (
          payloadDigest(policy) !== payloadDigest(initial.policy) ||
          auth.person.bindingId !== initial.auth.person.bindingId
        )
          throw new AuthError("proposal_stale", 409);
        await current(db, auth.sheet);
        await db.query(
          "INSERT INTO held_release_sheet_validation(asset_id,final_key,display_key) VALUES($1,$2,$3)",
          [uploadId, prepared.finalKey, prepared.displayKey],
        );
        const response = { assetId: uploadId, state: "validated" };
        await save(
          db,
          auth.actor.user_id,
          "sheet-finalize",
          input.operationId,
          digest,
          response,
        );
        return response;
      });
    },
  };
}
