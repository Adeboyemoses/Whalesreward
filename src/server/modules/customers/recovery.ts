import type pg from "pg";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import * as wire from "../../../shared/contracts/customer-recovery";
import { authId } from "../../../shared/contracts/auth";
import { pageSchema } from "../../../shared/contracts/admin";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { newId } from "../../lib/ids";
import { transaction, receipt, type LiveAdmin } from "../admin-access/repo";
import type { AdminConfig } from "../admin-access/config";
import { hmac } from "../auth/crypto";
import { AuthError } from "../auth/errors";
import { consumeLimits } from "../auth/rate-limit";
import { stationId, cursorId, nextCursor } from "../station/repo";
import { phoneNormalizer, type PhoneNormalizer } from "../../adapters/phone";
import {
  requirePhoneVerification,
  type PhoneVerificationAdapter,
} from "../../adapters/phone-verification";

export const recoveryWriteSchemas = {
  "phone-change": wire.phoneChangeSchema,
  issue: wire.issueCardVerificationSchema,
  verify: wire.verifyCardSchema,
  replace: wire.replaceCardSchema,
  "case-create": wire.managerCaseSchema,
};
export type RecoveryWrite = keyof typeof recoveryWriteSchemas;
export type RecoveryOptions = {
  adapter?: PhoneVerificationAdapter;
  normalizer?: PhoneNormalizer;
  ip?: string;
};
const mask = (phone: string | null) =>
  phone ? `•••• ${phone.slice(-4)}` : null;
async function authority(
  db: pg.PoolClient,
  token: string | undefined,
  action: string,
) {
  await securityLock(db);
  const actor = await requireAdminSession(db, token);
  requirePermission(actor, "customers");
  if (action === "cases" || action === "case")
    requirePermission(actor, "recovery", "managerRecovery");
  else if (action !== "changes") requirePermission(actor, "recovery");
  return actor;
}
async function customer(db: pg.PoolClient, id: string) {
  const station = await stationId(db);
  const c = (
    await db.query(
      `SELECT * FROM customer WHERE id=$1 AND (registered_station_id=$2 OR registered_station_id IS NULL) FOR UPDATE`,
      [id, station],
    )
  ).rows[0];
  if (!c) throw new AuthError("not_found", 404);
  return c;
}
async function activeCard(db: pg.PoolClient, id: string) {
  return (
    await db.query(
      `SELECT c.*,l.id AS link_id FROM card_customer_link l JOIN card c ON c.id=l.card_id JOIN card_batch b ON b.id=c.batch_id WHERE l.customer_id=$1 AND l.ended_at IS NULL AND c.state='linked' AND c.retired_at IS NULL AND b.status='active'`,
      [id],
    )
  ).rows[0];
}
async function actorView(db: pg.PoolClient, actor: LiveAdmin) {
  const r = (
    await db.query(
      "SELECT a.admin_code,u.display_name FROM admin a JOIN auth_user u ON u.id=a.user_id WHERE a.id=$1",
      [actor.admin_id],
    )
  ).rows[0];
  return {
    id: actor.admin_id,
    code: r.admin_code,
    name: wire.recoveryText.parse(r.display_name),
  };
}
async function invalidate(db: pg.PoolClient, id: string) {
  await db.query(
    "UPDATE verification_challenge SET revoked_at=clock_timestamp(),version=version+1 WHERE customer_id=$1 AND purpose='replace_card' AND consumed_at IS NULL AND revoked_at IS NULL",
    [id],
  );
  await db.query(
    "UPDATE phone_verification_delivery SET state='superseded',fencing_version=fencing_version+1 WHERE customer_id=$1 AND state IN ('pending','sending','sent')",
    [id],
  );
}
async function event(
  db: pg.PoolClient,
  actor: LiveAdmin,
  target: string,
  action: string,
  reason: string,
  values: Record<string, unknown>,
  at: Date,
  operationId: string,
) {
  const id = newId();
  await db.query(
    `INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,"before","after",reason,occurred_at,operation_id,actor_snapshot) VALUES($1,$2,'user',$3,$4,$5,'null'::jsonb,$6,$7,$8,$9,$10)`,
    [
      id,
      actor.user_id,
      action,
      action === "manager_case_recorded" ? "manager_case" : "customer",
      target,
      values,
      reason,
      at,
      operationId,
      await actorView(db, actor),
    ],
  );
  return id;
}
async function identityView(db: pg.PoolClient, id: string) {
  const r = (
    await db.query(
      `SELECT i.*,oc.code AS old_code,nc.code AS new_code FROM customer_identity_change i LEFT JOIN card oc ON oc.id=i.old_card_id LEFT JOIN card nc ON nc.id=i.new_card_id WHERE i.id=$1`,
      [id],
    )
  ).rows[0];
  return wire.identityChangeSchema.parse({
    id: r.id,
    operationId: r.operation_id,
    customerId: r.customer_id,
    customerVersion: r.customer_version,
    kind: r.kind,
    oldPhoneMasked: mask(r.old_phone_normalized),
    newPhoneMasked: mask(r.new_phone_normalized),
    oldCardCode: r.old_code ?? null,
    newCardCode: r.new_code ?? null,
    verification: r.verification_method,
    actor: r.actor_snapshot,
    reason: r.reason,
    appliedAt: r.applied_at.toISOString(),
    auditEventId: r.audit_event_id,
  });
}
function caseView(r: pg.QueryResultRow) {
  return wire.managerCaseViewSchema.parse({
    id: r.id,
    customerId: r.customer_id,
    version: r.version,
    state: r.state,
    customerVersionAtIntake: r.customer_version_at_intake,
    createdBy: r.actor_snapshot,
    createdAt: r.created_at.toISOString(),
    customerPresent: r.customer_present,
    reason: r.reason,
    verificationNotes: r.verification_notes,
    auditEventId: r.audit_event_id,
  });
}
async function challenge(
  db: pg.PoolClient,
  id: string,
  customerId: string,
  actor: LiveAdmin,
) {
  const r = (
    await db.query(
      `SELECT v.*,d.state AS delivery_state,d.destination_phone,d.lease_until,clock_timestamp() AS now FROM verification_challenge v JOIN phone_verification_delivery d ON d.id=v.phone_delivery_id WHERE v.id=$1 AND v.customer_id=$2 AND v.purpose='replace_card' AND v.issuer_admin_id=$3 AND v.issuer_session_id=$4 AND d.challenge_id=v.id FOR UPDATE OF v,d`,
      [id, customerId, actor.admin_id, actor.id],
    )
  ).rows[0];
  if (!r) throw new AuthError("not_found", 404);
  return r;
}
function challengeView(r: pg.QueryResultRow) {
  const state = r.consumed_at
    ? "consumed"
    : r.revoked_at
      ? r.delivery_state === "failed"
        ? "failed"
        : "revoked"
      : r.now >= r.expires_at
        ? "expired"
        : r.verified_at
          ? "verified"
          : r.delivery_state === "sent"
            ? "sent"
            : r.delivery_state === "failed"
              ? "failed"
              : "delivery_pending";
  return wire.phoneChallengeSchema.parse({
    id: r.id,
    customerId: r.customer_id,
    version: r.version,
    expiresAt: r.expires_at.toISOString(),
    resendAfter: r.resend_after.toISOString(),
    state,
    registeredPhoneMasked: mask(r.destination_phone),
    verifiedAt: r.verified_at?.toISOString() ?? null,
  });
}
function bound(
  r: pg.QueryResultRow,
  c: pg.QueryResultRow,
  card: pg.QueryResultRow | undefined,
  config: AdminConfig,
) {
  return (
    !r.revoked_at &&
    !r.consumed_at &&
    r.now < r.expires_at &&
    (r.verified_at || r.attempts < r.max_attempts) &&
    r.delivery_state === "sent" &&
    r.customer_version === c.version &&
    String(r.phone_generation) === String(c.phone_verification_generation) &&
    card?.id === r.active_card_id &&
    card?.version === r.active_card_version &&
    r.target_digest ===
      hmac(config.secret, "customer-phone-target-v1", c.phone_normalized)
  );
}
async function insertIdentity(
  db: pg.PoolClient,
  actor: LiveAdmin,
  c: pg.QueryResultRow,
  input: { operationId: string; reason: string },
  kind: "phone_change" | "card_replacement",
  at: Date,
  oldPhone: string | null,
  newPhone: string | null,
  oldCard: string | null,
  newCard: string | null,
  challengeId: string | null,
) {
  const id = newId(),
    method = kind === "phone_change" ? "card_present" : "registered_phone_code";
  const values =
    kind === "phone_change"
      ? { phoneChanged: true, verificationMethod: method }
      : {
          oldCardCode: (
            await db.query("SELECT code FROM card WHERE id=$1", [oldCard])
          ).rows[0].code,
          newCardCode: (
            await db.query("SELECT code FROM card WHERE id=$1", [newCard])
          ).rows[0].code,
          verificationMethod: method,
        };
  const auditId = await event(
    db,
    actor,
    c.id,
    kind === "phone_change" ? "phone_changed" : "card_replaced",
    input.reason,
    values,
    at,
    input.operationId,
  );
  await db.query(
    `INSERT INTO customer_identity_change(id,customer_id,actor_id,operation_id,kind,challenge_id,verification_evidence,reason,customer_version,verification_method,old_phone_normalized,new_phone_normalized,old_card_id,new_card_id,applied_at,audit_event_id,actor_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$7,$10,$11,$12,$13,$14,$15,$16)`,
    [
      id,
      c.id,
      actor.admin_id,
      input.operationId,
      kind,
      challengeId,
      method,
      input.reason,
      c.version + 1,
      oldPhone,
      newPhone,
      oldCard,
      newCard,
      at,
      auditId,
      await actorView(db, actor),
    ],
  );
  return identityView(db, id);
}

export async function recoveryRead(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  action: "context" | "challenge" | "changes" | "cases" | "case",
  customerId: string,
  input: unknown = {},
  targetId?: string,
) {
  authId.parse(customerId);
  if (targetId) authId.parse(targetId);
  return transaction(pool, async (db) => {
    const actor = await authority(db, token, action),
      c = await customer(db, customerId);
    if (action === "context") {
      const card = await activeCard(db, c.id);
      return wire.recoveryContextSchema.parse({
        customerId: c.id,
        customerVersion: c.version,
        phoneMasked: mask(c.phone_normalized),
        activeCard: card
          ? { id: card.id, code: card.code, version: card.version }
          : null,
      });
    }
    if (action === "challenge")
      return challengeView(await challenge(db, targetId!, c.id, actor));
    if (action === "case") {
      const r = (
        await db.query(
          "SELECT * FROM customer_recovery_case WHERE id=$1 AND customer_id=$2",
          [targetId, c.id],
        )
      ).rows[0];
      if (!r) throw new AuthError("not_found", 404);
      return caseView(r);
    }
    const { cursor, limit } = pageSchema.parse(input),
      scope = JSON.stringify([
        actor.user_id,
        c.registered_station_id,
        c.id,
        action,
      ]),
      after = cursorId(config.secret, scope, cursor);
    const table =
      action === "changes"
        ? "customer_identity_change"
        : "customer_recovery_case";
    const rows = (
      await db.query(
        `SELECT * FROM ${table} WHERE customer_id=$1 AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM ${table} WHERE id=$2 AND customer_id=$1)) ORDER BY created_at DESC,id DESC LIMIT $3`,
        [c.id, after, limit + 1],
      )
    ).rows;
    const items =
      action === "changes"
        ? await Promise.all(
            rows.slice(0, limit).map((r) => identityView(db, r.id)),
          )
        : rows.slice(0, limit).map(caseView);
    return {
      items,
      nextCursor:
        rows.length > limit
          ? nextCursor(config.secret, scope, rows[limit - 1].id)
          : null,
    };
  });
}

export async function recoveryWrite(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  action: RecoveryWrite,
  customerId: string,
  input: unknown,
  options: RecoveryOptions = {},
  challengeId?: string,
): Promise<unknown> {
  authId.parse(customerId);
  if (challengeId) authId.parse(challengeId);
  const parsed = recoveryWriteSchemas[action].parse(input);
  if (action === "verify")
    return verify(
      pool,
      config,
      token,
      customerId,
      challengeId!,
      wire.verifyCardSchema.parse(parsed),
      options,
    );
  if (action === "issue")
    return issue(
      pool,
      config,
      token,
      customerId,
      wire.issueCardVerificationSchema.parse(parsed),
      options,
    );
  try {
    return await transaction(pool, async (db) => {
      const actor = await authority(db, token, action),
        c = await customer(db, customerId);
      if (action === "replace") requirePhoneVerification(options.adapter);
      const normalized =
        action === "phone-change"
          ? (options.normalizer ?? phoneNormalizer()).normalize(
              wire.phoneChangeSchema.parse(parsed).newPhone,
            )
          : undefined;
      return receipt(
        db,
        config,
        actor,
        `customer-${action}`,
        {
          ...parsed,
          ...(normalized ? { newPhone: normalized } : {}),
          customerId,
        },
        async () => {
          if (c.version !== parsed.expectedVersion)
            throw new AuthError("version_conflict", 409);
          const at = (await db.query("SELECT clock_timestamp() AS now")).rows[0]
            .now as Date;
          if (action === "case-create") {
            const p = wire.managerCaseSchema.parse(parsed);
            if (
              (
                await db.query(
                  "SELECT 1 FROM customer_recovery_case WHERE customer_id=$1",
                  [c.id],
                )
              ).rowCount
            )
              throw new AuthError("case_already_open", 409);
            const id = newId(),
              auditId = await event(
                db,
                actor,
                id,
                "manager_case_recorded",
                "Customer recovery intake",
                { caseId: id, verificationMethod: "manager_intake" },
                at,
                p.operationId,
              );
            const r = (
              await db.query(
                `INSERT INTO customer_recovery_case(id,customer_id,customer_version_at_intake,actor_id,operation_id,customer_present,reason,verification_notes,audit_event_id,actor_snapshot) VALUES($1,$2,$3,$4,$5,true,$6,$7,$8,$9) RETURNING *`,
                [
                  id,
                  c.id,
                  c.version,
                  actor.admin_id,
                  p.operationId,
                  p.reason,
                  p.verificationNotes,
                  auditId,
                  await actorView(db, actor),
                ],
              )
            ).rows[0];
            return caseView(r);
          }
          const card = await activeCard(db, c.id);
          if (!card)
            throw new AuthError(
              "card_unavailable",
              action === "phone-change" ? 422 : 409,
            );
          if (action === "phone-change") {
            const p = wire.phoneChangeSchema.parse(parsed);
            await db.query("SELECT id FROM card WHERE id=$1 FOR UPDATE", [
              card.id,
            ]);
            if (
              card.code !== p.activeCardCode ||
              card.version !== p.expectedCardVersion
            )
              throw new AuthError("card_changed", 409);
            if (normalized === c.phone_normalized)
              throw new AuthError("no_change", 409);
            const changed = await db.query(
              "UPDATE customer SET phone_normalized=$1,version=version+1,phone_verification_generation=phone_verification_generation+1 WHERE id=$2 AND version=$3",
              [normalized, c.id, c.version],
            );
            if (changed.rowCount !== 1)
              throw new AuthError("version_conflict", 409);
            await invalidate(db, c.id);
            return insertIdentity(
              db,
              actor,
              c,
              p,
              "phone_change",
              at,
              c.phone_normalized,
              normalized!,
              null,
              null,
              null,
            );
          }
          const p = wire.replaceCardSchema.parse(parsed);
          const ch = await challenge(db, p.challengeId, c.id, actor);
          if (
            !bound(ch, c, card, config) ||
            !ch.verified_at ||
            ch.version !== p.expectedChallengeVersion
          )
            throw new AuthError("verification_unavailable", 422);
          if (card.version !== p.expectedOldCardVersion)
            throw new AuthError("card_changed", 409);
          // Sync takes SHARE on these same card rows before historical resolution.
          await db.query(
            "SELECT id FROM card_batch WHERE id IN (SELECT batch_id FROM card WHERE id=$1 OR code=$2) ORDER BY id FOR UPDATE",
            [card.id, p.newCardCode],
          );
          const locked = (
            await db.query(
              "SELECT * FROM card WHERE id=$1 OR code=$2 ORDER BY id FOR UPDATE",
              [card.id, p.newCardCode],
            )
          ).rows;
          const next = locked.find((r) => r.code === p.newCardCode);
          if (
            !next ||
            next.state !== "unassigned" ||
            next.retired_at ||
            (
              await db.query(
                "SELECT 1 FROM card_batch WHERE id=$1 AND status='active'",
                [next.batch_id],
              )
            ).rowCount !== 1 ||
            (
              await db.query(
                "SELECT 1 FROM card_customer_link WHERE card_id=$1",
                [next.id],
              )
            ).rowCount
          )
            throw new AuthError("card_unavailable", 409);
          const used = await db.query(
            "UPDATE verification_challenge SET consumed_at=$1,version=version+1 WHERE id=$2 AND version=$3 AND consumed_at IS NULL AND revoked_at IS NULL",
            [at, ch.id, ch.version],
          );
          if (used.rowCount !== 1)
            throw new AuthError("verification_unavailable", 422);
          const retired = await db.query(
            "UPDATE card SET state='retired',retired_at=$1,retirement_reason='replaced',replaced_by_card_id=$2,version=version+1 WHERE id=$3 AND version=$4 AND state='linked'",
            [at, next.id, card.id, p.expectedOldCardVersion],
          );
          if (retired.rowCount !== 1) throw new AuthError("card_changed", 409);
          await db.query(
            "UPDATE card_customer_link SET ended_at=$1 WHERE id=$2 AND ended_at IS NULL",
            [at, card.link_id],
          );
          const linked = await db.query(
            "UPDATE card SET state='linked',version=version+1 WHERE id=$1 AND version=$2 AND state='unassigned' AND retired_at IS NULL",
            [next.id, next.version],
          );
          if (linked.rowCount !== 1)
            throw new AuthError("card_unavailable", 409);
          await db.query(
            "INSERT INTO card_customer_link(id,card_id,customer_id,linked_at,actor_user_id,reason) VALUES($1,$2,$3,$4,$5,$6)",
            [newId(), next.id, c.id, at, actor.user_id, p.reason],
          );
          await db.query(
            "UPDATE customer SET version=version+1,phone_verification_generation=phone_verification_generation+1 WHERE id=$1 AND version=$2",
            [c.id, c.version],
          );
          await invalidate(db, c.id);
          return insertIdentity(
            db,
            actor,
            c,
            p,
            "card_replacement",
            at,
            null,
            null,
            card.id,
            next.id,
            ch.id,
          );
        },
      );
    });
  } catch (e) {
    if (
      (e as { code?: string; constraint?: string }).code === "23505" &&
      (e as { constraint?: string }).constraint === "uq_customer_phone"
    )
      throw new AuthError("phone_in_use", 409);
    throw e;
  }
}

async function issue(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  customerId: string,
  p: z.infer<typeof wire.issueCardVerificationSchema>,
  options: RecoveryOptions,
) {
  // Authenticate and scope before provider configuration or rate information.
  const actor = await transaction(pool, async (db) => {
    const a = await authority(db, token, "issue");
    await customer(db, customerId);
    return a;
  });
  const adapter = requirePhoneVerification(options.adapter);
  await consumeLimits(pool, config.secret, [
    { key: `phone-send-customer:replace_card:${customerId}`, capacity: 3 },
    { key: `phone-send-actor:${actor.user_id}`, capacity: 10 },
    { key: `phone-send-ip:${options.ip ?? "unknown"}`, capacity: 30 },
  ]);
  let created = false;
  const initial = await transaction(pool, async (db) => {
    const live = await authority(db, token, "issue"),
      c = await customer(db, customerId);
    return receipt(
      db,
      config,
      live,
      "customer-issue",
      { ...p, customerId },
      async () => {
        if (c.version !== p.expectedVersion)
          throw new AuthError("version_conflict", 409);
        const card = await activeCard(db, c.id);
        if (!card) throw new AuthError("card_unavailable", 409);
        const tooSoon = (
          await db.query(
            "SELECT 1 FROM verification_challenge WHERE customer_id=$1 AND purpose='replace_card' AND resend_after>clock_timestamp() ORDER BY created_at DESC LIMIT 1",
            [c.id],
          )
        ).rowCount;
        if (tooSoon)
          throw new AuthError(
            "rate_limited",
            429,
            Math.ceil(adapter.policy.resendMs / 1000),
          );
        await invalidate(db, c.id);
        const generation = (
          await db.query(
            "UPDATE customer SET phone_verification_generation=phone_verification_generation+1 WHERE id=$1 RETURNING phone_verification_generation",
            [c.id],
          )
        ).rows[0].phone_verification_generation;
        const id = newId(),
          deliveryId = newId(),
          target = hmac(
            config.secret,
            "customer-phone-target-v1",
            c.phone_normalized,
          );
        await db.query(
          `INSERT INTO verification_challenge(id,customer_id,purpose,target_digest,secret_hash,expires_at,attempts,max_attempts,operation_id,version,issuer_admin_id,issuer_session_id,customer_version,active_card_id,active_card_version,phone_generation,target_key_version,secret_key_version,phone_delivery_id,resend_after) VALUES($1,$2,'replace_card',$3,$4,clock_timestamp()+($5::bigint*interval '1 millisecond'),0,$6,$7,1,$8,$9,$10,$11,$12,$13,'v1','test-v1',$14,clock_timestamp()+($15::bigint*interval '1 millisecond'))`,
          [
            id,
            c.id,
            target,
            hmac(
              config.secret,
              "undelivered-phone-intent",
              randomBytes(32).toString("hex"),
            ),
            adapter.policy.lifetimeMs,
            adapter.policy.maxAttempts,
            p.operationId,
            live.admin_id,
            live.id,
            c.version,
            card.id,
            card.version,
            generation,
            deliveryId,
            adapter.policy.resendMs,
          ],
        );
        await db.query(
          `INSERT INTO phone_verification_delivery(id,customer_id,generation,challenge_id,issuer_admin_id,purpose,destination_phone,target_hmac,key_version,state,lease_nonce,lease_until,fencing_version) VALUES($1,$2,$3,$4,$5,'replace_card',$6,$7,'v1','sending',$8,clock_timestamp()+interval '30 seconds',1)`,
          [
            deliveryId,
            c.id,
            generation,
            id,
            live.admin_id,
            c.phone_normalized,
            target,
            newId(),
          ],
        );
        created = true;
        return challengeView(await challenge(db, id, c.id, live));
      },
    );
  });
  if (!created) {
    // A same-key retry never calls delivery again. An abandoned lease is unusable.
    await transaction(pool, async (db) => {
      const live = await authority(db, token, "issue");
      await customer(db, customerId);
      const ch = await challenge(db, initial.id, customerId, live);
      if (ch.delivery_state === "sending" && ch.lease_until <= ch.now)
        await failDelivery(db, ch.id, "delivery_uncertain");
    });
    return initial;
  }
  const generation = (
    await pool.query(
      "SELECT phone_generation FROM verification_challenge WHERE id=$1",
      [initial.id],
    )
  ).rows[0].phone_generation as string;
  let result: Awaited<ReturnType<PhoneVerificationAdapter["request"]>>;
  try {
    result = await adapter.request(
      customerId,
      "replace_card",
      String(generation),
    );
  } catch {
    result = { outcome: "unavailable" };
  }
  try {
    const completed = await transaction(pool, async (db) => {
      const live = await authority(db, token, "issue"),
        c = await customer(db, customerId),
        ch = await challenge(db, initial.id, customerId, live),
        card = await activeCard(db, c.id);
      if (
        result.outcome !== "sent" ||
        !/^[a-f0-9]{64}$/.test(result.verifier) ||
        result.keyVersion !== "test-v1" ||
        ch.delivery_state !== "sending" ||
        ch.revoked_at ||
        ch.now >= ch.expires_at ||
        ch.lease_until <= ch.now ||
        String(ch.phone_generation) !==
          String(c.phone_verification_generation) ||
        ch.customer_version !== c.version ||
        ch.active_card_id !== card?.id ||
        ch.active_card_version !== card?.version
      ) {
        await failDelivery(db, ch.id, "delivery_unavailable");
        return null;
      }
      await db.query(
        "UPDATE verification_challenge SET secret_hash=$1,version=version+1 WHERE id=$2 AND version=$3",
        [result.verifier, ch.id, ch.version],
      );
      await db.query(
        "UPDATE phone_verification_delivery SET state='sent',lease_nonce=NULL,lease_until=NULL,fencing_version=fencing_version+1 WHERE id=$1 AND state='sending'",
        [ch.phone_delivery_id],
      );
      return initial;
    });
    if (!completed) throw new AuthError("delivery_unavailable", 503);
    return completed;
  } catch (e) {
    await transaction(pool, (db) =>
      failDelivery(db, initial.id, "authority_unavailable"),
    );
    throw e;
  }
}
async function failDelivery(db: pg.PoolClient, id: string, code: string) {
  await db.query(
    "UPDATE verification_challenge SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1 AND consumed_at IS NULL AND revoked_at IS NULL",
    [id],
  );
  await db.query(
    "UPDATE phone_verification_delivery SET state='failed',failure_code=$2,lease_nonce=NULL,lease_until=NULL,fencing_version=fencing_version+1 WHERE challenge_id=$1 AND state IN ('pending','sending')",
    [id, code],
  );
}
async function verify(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  customerId: string,
  challengeId: string,
  p: z.infer<typeof wire.verifyCardSchema>,
  options: RecoveryOptions,
) {
  const actor = await transaction(pool, async (db) => {
    const a = await authority(db, token, "verify");
    await customer(db, customerId);
    return a;
  });
  const adapter = requirePhoneVerification(options.adapter);
  await consumeLimits(pool, config.secret, [
    { key: `phone-verify-customer:replace_card:${customerId}`, capacity: 10 },
    { key: `phone-verify-actor:${actor.user_id}`, capacity: 10 },
    { key: `phone-verify-ip:${options.ip ?? "unknown"}`, capacity: 30 },
  ]);
  const result = await transaction(pool, async (db) => {
    const live = await authority(db, token, "verify"),
      c = await customer(db, customerId);
    const ch = await challenge(db, challengeId, c.id, live),
      card = await activeCard(db, c.id);
    const request = hmac(
      config.secret,
      "phone-attempt-v1",
      JSON.stringify([
        customerId,
        challengeId,
        p.operationId,
        p.expectedVersion,
        p.expectedChallengeVersion,
        p.code,
      ]),
    );
    const old = (
      await db.query(
        "SELECT * FROM phone_verification_attempt WHERE actor_user_id=$1 AND operation_id=$2",
        [live.user_id, p.operationId],
      )
    ).rows[0];
    if (old) {
      if (old.request_hmac !== request)
        throw new AuthError("operation_conflict", 409);
      return old.outcome === "verified" ? old.result_snapshot : null;
    }
    let verified = false;
    if (
      bound(ch, c, card, config) &&
      c.version === p.expectedVersion &&
      ch.version === p.expectedChallengeVersion &&
      !ch.verified_at
    )
      verified = (await adapter.verify(ch.id, p.code)) === "verified";
    if (!ch.revoked_at && !ch.consumed_at && ch.attempts < ch.max_attempts) {
      await db.query(
        "UPDATE verification_challenge SET attempts=attempts+1,verified_at=CASE WHEN $1 THEN clock_timestamp() ELSE verified_at END,version=version+1 WHERE id=$2 AND version=$3",
        [verified, ch.id, ch.version],
      );
    }
    const current = await challenge(db, ch.id, c.id, live),
      snapshot = verified ? challengeView(current) : null;
    await db.query(
      "INSERT INTO phone_verification_attempt(id,challenge_id,actor_user_id,operation_id,request_hmac,key_version,outcome,applied_challenge_version,result_snapshot) VALUES($1,$2,$3,$4,$5,'v1',$6,$7,$8)",
      [
        newId(),
        ch.id,
        live.user_id,
        p.operationId,
        request,
        verified ? "verified" : "unavailable",
        current.version,
        snapshot,
      ],
    );
    return snapshot;
  });
  if (!result) throw new AuthError("verification_unavailable", 422);
  return result;
}
