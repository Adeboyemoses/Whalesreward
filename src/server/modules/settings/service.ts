import { createHash } from "node:crypto";
import type pg from "pg";
import {
  settingsSchema,
  settingsChangeSchema,
  settingsHistorySchema,
  retentionReviewSchema,
  retentionConfirmSchema,
  timingReviewSchema,
  timingConfirmSchema,
  type Settings,
  type SettingsSection,
} from "../../../shared/contracts/settings";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { newId } from "../../lib/ids";
import { transaction, receipt } from "../admin-access/repo";
import type { AdminConfig } from "../admin-access/config";
import { AuthError } from "../auth/errors";
import { auditActor } from "../audit/write";
import { writeSettingsAudit } from "../audit/write-settings";
import { requireTimingPolicy } from "./policy";
import { decodeCursor, encodeCursor } from "../sales/cursor";
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
const hash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
async function authority(
  db: pg.PoolClient,
  token: string | undefined,
  write = false,
) {
  if (write) await securityLock(db);
  else await db.query("SELECT id FROM security_state WHERE id=true FOR SHARE");
  const actor = await requireAdminSession(db, token);
  requirePermission(actor, "settings");
  const stations = (
    await db.query("SELECT * FROM station ORDER BY id LIMIT 2 FOR SHARE")
  ).rows;
  if (stations.length !== 1)
    throw new AuthError("temporarily_unavailable", 503);
  return { actor, station: stations[0]! };
}
async function snapshot(
  db: pg.PoolClient,
  station: { id: string; name: string; timezone: string },
): Promise<Settings> {
  const state = (
    await db.query(
      "SELECT * FROM station_reporting_state WHERE station_id=$1 FOR SHARE",
      [station.id],
    )
  ).rows[0];
  const saved = state?.current_settings_version_id
    ? (
        await db.query(
          `SELECT *,to_char(purchase_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS purchase_start_text,to_char(purchase_cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS purchase_cutoff_text,to_char(upload_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS upload_deadline_text,COALESCE(grace_hours, CASE WHEN mod(extract(epoch FROM upload_deadline-purchase_cutoff),3600)=0 THEN (extract(epoch FROM upload_deadline-purchase_cutoff)/3600)::integer END) AS effective_grace_hours FROM settings_version WHERE id=$1 AND station_id=$2`,
          [state.current_settings_version_id, station.id],
        )
      ).rows[0]
    : null;
  // An untracked legacy settings row cannot silently become approved current state.
  if (state?.current_settings_version_id && !saved)
    throw new AuthError("temporarily_unavailable", 503);
  const products = (
    await db.query(
      `SELECT p.code AS product,(SELECT quantity_precision FROM product_price_version v WHERE v.product_id=p.id AND v.station_id=$1 ORDER BY v.effective_from DESC,v.id DESC LIMIT 1) AS "quantityPrecision" FROM product p ORDER BY p.code`,
      [station.id],
    )
  ).rows;
  const campaigns = (
    await db.query(
      "SELECT * FROM campaign WHERE station_id=$1 ORDER BY created_at DESC,id DESC LIMIT 2",
      [station.id],
    )
  ).rows;
  if (campaigns.length > 1) throw new AuthError("temporarily_unavailable", 503);
  const c = campaigns[0];
  const timing = saved?.full_snapshot
    ? settingsSchema.parse(saved.full_snapshot).campaign?.timing
    : null;
  return settingsSchema.parse({
    version: state?.settings_version ?? 1,
    settingsVersionId: saved?.id ?? null,
    campaign: c
      ? {
          id: c.id,
          name: c.name,
          version: c.version,
          settingsVersionId: c.current_timing_version_id ?? null,
          timing: timing ?? {
            launchAt: state?.launch_at?.toISOString() ?? null,
            purchaseStart: saved?.purchase_start_text ?? null,
            purchaseCutoff: saved?.purchase_cutoff_text ?? null,
            graceHours: saved?.effective_grace_hours ?? null,
            uploadDeadline: saved?.upload_deadline_text ?? null,
            timezone: saved?.timezone ?? station.timezone,
            policyVersion: saved?.timing_policy_version ?? null,
          },
          dataVersion: state?.data_version ?? "0",
          latestSnapshotId: c.latest_snapshot_id ?? null,
          reconciliationRequired: c.reconciliation_required,
          reconciledDataVersion: c.reconciled_data_version ?? null,
        }
      : null,
    retention: saved?.full_snapshot
      ? settingsSchema.parse(saved.full_snapshot).retention
      : {
          days: saved?.retention_days ?? null,
          deletionEnabled: false,
          policyVersion: null,
          storedCopyPolicy: "unconfigured",
        },
    station: {
      id: station.id,
      name: station.name,
      timezone: station.timezone,
      moneyDecimals: 2,
      products,
    },
  });
}
const now = async (db: pg.PoolClient) =>
  (
    await db.query<{ at: string }>(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
    )
  ).rows[0]!.at;
export async function readSettings(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  action: "get" | "history",
  input: unknown = {},
) {
  const query =
    action === "history" ? settingsHistorySchema.parse(input) : null;
  return transaction(pool, async (db) => {
    const { station } = await authority(db, token);
    if (!query) return snapshot(db, station);
    const scope = JSON.stringify([
      "settings-history-v1",
      station.id,
      query.section ?? null,
    ]);
    const cursor = decodeCursor(config.secret, scope, query.cursor);
    let beforeVersion: number | null = null;
    if (cursor) {
      const r = (
        await db.query(
          "SELECT version FROM settings_change WHERE id=$1 AND station_id=$2 AND ($3::text IS NULL OR section=$3)",
          [cursor.id, station.id, query.section ?? null],
        )
      ).rows[0];
      if (!r) throw new AuthError("invalid_request", 400);
      beforeVersion = r.version;
    }
    const rows = (
      await db.query(
        "SELECT id,snapshot FROM settings_change WHERE station_id=$1 AND ($2::text IS NULL OR section=$2) AND ($3::integer IS NULL OR version<$3) ORDER BY version DESC LIMIT $4",
        [station.id, query.section ?? null, beforeVersion, query.limit + 1],
      )
    ).rows;
    const items = rows
      .slice(0, query.limit)
      .map((r) => settingsChangeSchema.parse(r.snapshot));
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(config.secret, scope, last.appliedAt, last.id)
          : null,
    };
  });
}
function retentionReview(
  before: Settings,
  input: unknown,
  actorId: string,
  asOf: string,
) {
  const p = retentionReviewSchema.parse(input);
  if (p.expectedVersion !== before.version)
    throw new AuthError("version_conflict", 409);
  if (
    p.days !== null &&
    (!Number.isInteger(p.days) || p.days < 1 || p.days > 36500)
  )
    throw new AuthError("retention_invalid", 422);
  if (p.days === before.retention.days) throw new AuthError("no_change", 409);
  const proposal = { days: p.days, reason: p.reason };
  const after: Settings = {
    ...before,
    retention: {
      ...before.retention,
      days: p.days,
      policyVersion: null,
      deletionEnabled: false,
    },
  };
  const comparison = {
    section: "retention" as const,
    expectedVersion: p.expectedVersion,
    expectedCampaignVersion: null,
    before,
    after,
    proposal,
    policyVersions: {
      timing: before.campaign?.timing.policyVersion ?? null,
      retention: before.retention.policyVersion,
    },
  };
  return {
    ...comparison,
    reviewDigest: hash({ ...comparison, actorId }),
    asOf,
  };
}
export async function reviewSettings(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  section: SettingsSection,
  input: unknown,
) {
  void config;
  const parsed =
    section === "retention"
      ? retentionReviewSchema.parse(input)
      : timingReviewSchema.parse(input);
  return transaction(pool, async (db) => {
    const { actor, station } = await authority(db, token);
    if (section === "giveaway") return requireTimingPolicy();
    return retentionReview(
      await snapshot(db, station),
      parsed,
      actor.user_id,
      await now(db),
    );
  });
}
export async function confirmSettings(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  section: SettingsSection,
  input: unknown,
) {
  const parsed =
    section === "retention"
      ? retentionConfirmSchema.parse(input)
      : timingConfirmSchema.parse(input);
  return transaction(pool, async (db) => {
    const { actor, station } = await authority(db, token, true);
    let replayed = true;
    const data = await receipt(
      db,
      config,
      actor,
      `settings-${section}-confirm`,
      parsed,
      async () => {
        replayed = false;
        if (section === "giveaway") return requireTimingPolicy();
        const p = retentionConfirmSchema.parse(parsed);
        // Creation is part of confirmation only. Reviews and GETs never create state.
        await db.query(
          "INSERT INTO station_reporting_state(station_id) VALUES($1) ON CONFLICT DO NOTHING",
          [station.id],
        );
        await db.query(
          "SELECT station_id FROM station_reporting_state WHERE station_id=$1 FOR UPDATE",
          [station.id],
        );
        const before = await snapshot(db, station),
          at = await now(db);
        const review = retentionReview(
          before,
          {
            days: p.days,
            reason: p.reason,
            expectedVersion: p.expectedVersion,
          },
          actor.user_id,
          at,
        );
        if (review.reviewDigest !== p.reviewDigest)
          throw new AuthError("review_stale", 409);
        if (before.version === 2147483647)
          throw new AuthError("version_conflict", 409);
        const id = newId(),
          auditId = newId(),
          changeId = newId(),
          version = before.version + 1;
        const after = { ...review.after, version, settingsVersionId: id };
        const actorSnapshot = await auditActor(db, actor.user_id);
        if (actorSnapshot.kind !== "admin")
          throw new AuthError("permission_denied", 403);
        const change = settingsChangeSchema.parse({
          id: changeId,
          section: "retention",
          version,
          previousVersionId: before.settingsVersionId,
          appliedAt: at,
          actor: {
            id: actor.admin_id,
            code: actorSnapshot.code,
            name: actorSnapshot.nameAtEvent,
          },
          reason: p.reason,
          before: before.retention,
          after: after.retention,
          auditEventId: auditId,
        });
        const timing = before.campaign?.timing;
        await db.query(
          `INSERT INTO settings_version(id,station_id,campaign_id,version,purchase_start,purchase_cutoff,upload_deadline,timezone,retention_days,effective_from,actor_id,reason,full_snapshot,previous_version_id,section,grace_hours,launch_at,timing_policy_version,retention_policy_version,stored_copy_policy,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,'retention',$15,$16,$17,NULL,$18,$19)`,
          [
            id,
            station.id,
            before.campaign?.id ?? null,
            version,
            timing?.purchaseStart ?? null,
            timing?.purchaseCutoff ?? null,
            timing?.uploadDeadline ?? null,
            timing?.timezone ?? station.timezone,
            p.days,
            at,
            actor.admin_id,
            p.reason,
            JSON.stringify(after),
            before.settingsVersionId,
            timing?.graceHours ?? null,
            timing?.launchAt ?? null,
            timing?.policyVersion ?? null,
            after.retention.storedCopyPolicy,
            p.operationId,
          ],
        );
        await writeSettingsAudit(db, {
          id: auditId,
          eventCode: `AUD-${auditId}`,
          schemaVersion: 2,
          stationId: station.id,
          occurredAt: at,
          area: "settings",
          action: "retention_intent_changed",
          actor: actorSnapshot,
          originatingSeller: null,
          target: {
            kind: "settings",
            id,
            code: `SETTINGS-${id}`,
            subjectAtEvent: null,
          },
          operationId: p.operationId,
          correlationId: p.operationId,
          reason: p.reason,
          relatedEventIds: [],
          changes: [
            {
              field: "settingsVersionId",
              before: before.settingsVersionId,
              after: id,
            },
            {
              field: "settingsVersion",
              before: String(before.version),
              after: String(version),
            },
            {
              field: "retentionDays",
              before:
                before.retention.days === null
                  ? null
                  : String(before.retention.days),
              after: p.days === null ? null : String(p.days),
            },
            { field: "deletionEnabled", before: false, after: false },
          ],
        });
        await db.query(
          "INSERT INTO settings_change(id,station_id,settings_version_id,version,section,applied_at,snapshot,before_values,after_values,audit_event_id) VALUES($1,$2,$3,$4,'retention',$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)",
          [
            changeId,
            station.id,
            id,
            version,
            at,
            JSON.stringify(change),
            JSON.stringify(change.before),
            JSON.stringify(change.after),
            auditId,
          ],
        );
        const result = await db.query(
          "UPDATE station_reporting_state SET settings_version=$2,current_settings_version_id=$3 WHERE station_id=$1 AND settings_version=$4 AND current_settings_version_id IS NOT DISTINCT FROM $5::uuid",
          [
            station.id,
            version,
            id,
            p.expectedVersion,
            before.settingsVersionId,
          ],
        );
        if (result.rowCount !== 1) throw new AuthError("version_conflict", 409);
        return change;
      },
    );
    return { data: settingsChangeSchema.parse(data), replayed };
  });
}
