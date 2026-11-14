import { m4SettingsAuditSchema } from "../../../shared/contracts/audit";
import { createHash } from "node:crypto";
import type pg from "pg";
import {
  settingsSchema,
  timingSchema,
  reviewedSettingsSchema,
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
import { requireTimingPolicy, recordedTimingPolicy } from "./policy";
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
  const pin = c?.current_timing_version_id
    ? (
        await db.query(
          `SELECT *,to_char(launch_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') launch_text,
    to_char(purchase_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') start_text,
    to_char(purchase_cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cutoff_text,
    to_char(upload_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') deadline_text
    FROM settings_version WHERE id=$1 AND station_id=$2 AND campaign_id=$3`,
          [c.current_timing_version_id, station.id, c.id],
        )
      ).rows[0]
    : null;
  if (c?.current_timing_version_id && !pin)
    throw new AuthError("temporarily_unavailable", 503);
  if (
    c &&
    !pin &&
    (
      await db.query(
        "SELECT 1 FROM settings_version WHERE station_id=$1 AND campaign_id=$2 LIMIT 1",
        [station.id, c.id],
      )
    ).rowCount
  )
    throw new AuthError("temporarily_unavailable", 503);
  const timing = c
    ? timingSchema.parse({
        launchAt: pin?.launch_text ?? null,
        purchaseStart: pin?.start_text ?? null,
        purchaseCutoff: pin?.cutoff_text ?? null,
        graceHours:
          pin?.grace_hours ??
          (pin?.upload_deadline && pin?.purchase_cutoff
            ? (pin.upload_deadline.getTime() - pin.purchase_cutoff.getTime()) /
              3600000
            : null),
        uploadDeadline: pin?.deadline_text ?? null,
        timezone: pin?.timezone ?? station.timezone,
        policyVersion: pin?.timing_policy_version ?? null,
      })
    : null;
  const timingLocked = c
    ? (
        await db.query(
          `SELECT EXISTS(SELECT 1 FROM giveaway_snapshot WHERE campaign_id=$1) OR ($2::timestamptz IS NOT NULL AND clock_timestamp()>=$2::timestamptz) AS locked`,
          [c.id, timing?.purchaseStart],
        )
      ).rows[0].locked
    : false;
  return settingsSchema.parse({
    version: state?.settings_version ?? 1,
    settingsVersionId: saved?.id ?? null,
    timingPolicyVersion: await recordedTimingPolicy(db, station.id),
    timingLocked,
    campaign: c
      ? {
          id: c.id,
          name: c.name,
          version: c.version,
          settingsVersionId: c.current_timing_version_id ?? null,
          timing,
          dataVersion: state?.data_version ?? "0",
          latestSnapshotId: c.latest_snapshot_id ?? null,
          reconciliationRequired: c.reconciliation_required,
          reconciledDataVersion: c.reconciled_data_version ?? null,
        }
      : null,
    retention: saved?.full_snapshot
      ? settingsSchema.shape.retention.parse(saved.full_snapshot.retention)
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
      timing: before.timingPolicyVersion,
      retention: before.retention.policyVersion,
    },
  };
  return {
    ...comparison,
    reviewDigest: hash({ ...comparison, actorId }),
    asOf,
  };
}
async function normalizeTimingRequest<
  T extends { launchAt: string; purchaseStart: string; purchaseCutoff: string },
>(db: pg.PoolClient, p: T): Promise<T> {
  const normalized = (
    await db.query(
      `SELECT to_char($1::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "launchAt",to_char($2::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "purchaseStart",to_char($3::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "purchaseCutoff"`,
      [p.launchAt, p.purchaseStart, p.purchaseCutoff],
    )
  ).rows[0];
  return { ...p, ...normalized };
}
type TimingInput = ReturnType<typeof timingReviewSchema.parse>;
async function timingReview(
  db: pg.PoolClient,
  before: Settings,
  p: TimingInput,
  actorId: string,
  asOf: string,
) {
  if (p.kind === "create" && before.campaign)
    throw new AuthError("campaign_exists", 409);
  if (p.kind === "update" && p.campaignId !== before.campaign?.id)
    throw new AuthError("not_found", 404);
  if (
    p.expectedVersion !== before.version ||
    (p.kind === "update" &&
      p.expectedCampaignVersion !== before.campaign?.version)
  )
    throw new AuthError("version_conflict", 409);
  const policy = await requireTimingPolicy(db, before.station.id);
  if (
    !Number.isSafeInteger(p.graceHours) ||
    p.graceHours < 0 ||
    p.graceHours > 2147483647
  )
    throw new AuthError("timing_invalid", 422);
  try {
    new Intl.DateTimeFormat("en", { timeZone: p.timezone });
  } catch {
    throw new AuthError("timing_invalid", 422);
  }
  // PostgreSQL preserves the supported microsecond precision; no JS date rounding.
  if (
    [p.launchAt, p.purchaseStart, p.purchaseCutoff].some((v) =>
      /\.\d{7,}/.test(v),
    )
  )
    throw new AuthError("timing_invalid", 422);
  let timing: ReturnType<typeof timingSchema.parse>;
  try {
    const row = (
      await db.query(
        `SELECT
      to_char($1::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "launchAt",
      to_char($2::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "purchaseStart",
      to_char($3::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "purchaseCutoff",
      to_char(($3::timestamptz+$4::integer*interval '1 hour') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "uploadDeadline",
      $1::timestamptz<=$2::timestamptz AND $2::timestamptz<$3::timestamptz AS valid`,
        [p.launchAt, p.purchaseStart, p.purchaseCutoff, p.graceHours],
      )
    ).rows[0];
    if (!row.valid) throw new Error("ordering");
    timing = timingSchema.parse({
      launchAt: row.launchAt,
      purchaseStart: row.purchaseStart,
      purchaseCutoff: row.purchaseCutoff,
      uploadDeadline: row.uploadDeadline,
      graceHours: p.graceHours,
      timezone: p.timezone,
      policyVersion: policy,
    });
  } catch {
    throw new AuthError("timing_invalid", 422);
  }
  if (
    before.timingLocked ||
    !(
      await db.query("SELECT clock_timestamp()<$1::timestamptz AS allowed", [
        timing.purchaseStart,
      ])
    ).rows[0].allowed
  )
    throw new AuthError("timing_locked", 409);
  if (p.kind === "update" && hash(before.campaign!.timing) === hash(timing))
    throw new AuthError("no_change", 409);
  const after = reviewedSettingsSchema.parse({
    ...before,
    campaign: before.campaign
      ? { ...before.campaign, timing }
      : {
          id: null,
          name: `${before.station.name} campaign`,
          version: 1,
          settingsVersionId: null,
          timing,
          dataVersion:
            (
              await db.query(
                "SELECT data_version::text FROM station_reporting_state WHERE station_id=$1",
                [before.station.id],
              )
            ).rows[0]?.data_version ?? "0",
          latestSnapshotId: null,
          reconciliationRequired: true,
          reconciledDataVersion: null,
        },
  });
  const proposal = {
    kind: p.kind,
    campaignId: p.campaignId,
    launchAt: timing.launchAt,
    purchaseStart: timing.purchaseStart,
    purchaseCutoff: timing.purchaseCutoff,
    timezone: timing.timezone,
    graceHours: timing.graceHours,
    reason: p.reason,
  };
  const comparison = {
    section: "giveaway" as const,
    expectedVersion: p.expectedVersion,
    expectedCampaignVersion: p.expectedCampaignVersion,
    before,
    after,
    proposal,
    policyVersions: {
      timing: policy,
      retention: before.retention.policyVersion,
    },
  };
  return {
    ...comparison,
    reviewDigest: hash({ ...comparison, actorId }),
    asOf,
  };
}
async function commitTiming(
  db: pg.PoolClient,
  station: { id: string; name: string; timezone: string },
  actor: Awaited<ReturnType<typeof requireAdminSession>>,
  p: ReturnType<typeof timingConfirmSchema.parse>,
) {
  await db.query(
    "INSERT INTO station_reporting_state(station_id) VALUES($1) ON CONFLICT DO NOTHING",
    [station.id],
  );
  await db.query(
    "SELECT station_id FROM station_reporting_state WHERE station_id=$1 FOR UPDATE",
    [station.id],
  );
  await db.query("SELECT id FROM campaign WHERE station_id=$1 FOR UPDATE", [
    station.id,
  ]);
  const before = await snapshot(db, station);
  const review = await timingReview(
    db,
    before,
    p,
    actor.user_id,
    await now(db),
  );
  if (review.reviewDigest !== p.reviewDigest)
    throw new AuthError("review_stale", 409);
  if (before.version === 2147483647 || before.campaign?.version === 2147483647)
    throw new AuthError("version_conflict", 409);
  const id = newId(),
    campaignId = before.campaign?.id ?? newId(),
    auditId = newId(),
    changeId = newId(),
    version = before.version + 1,
    campaignVersion = before.campaign ? before.campaign.version + 1 : 1;
  const timing = review.after.campaign!.timing;
  const actorSnapshot = await auditActor(db, actor.user_id);
  if (actorSnapshot.kind !== "admin")
    throw new AuthError("permission_denied", 403);
  // Final fresh clock after every lock and comparison, immediately before writes.
  const final = (
    await db.query(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at,
    clock_timestamp()<$1::timestamptz AND ($2::timestamptz IS NULL OR clock_timestamp()<$2::timestamptz)
    AND NOT EXISTS(SELECT 1 FROM giveaway_snapshot WHERE campaign_id=$3) allowed`,
      [
        timing.purchaseStart,
        before.campaign?.timing.purchaseStart ?? null,
        campaignId,
      ],
    )
  ).rows[0];
  if (!final.allowed) throw new AuthError("timing_locked", 409);
  const at = final.at;
  if (p.kind === "create")
    await db.query(
      "INSERT INTO campaign(id,station_id,name,version,reconciliation_required,current_timing_version_id) VALUES($1,$2,$3,1,true,$4)",
      [campaignId, station.id, review.after.campaign!.name, id],
    );
  const after = settingsSchema.parse({
    ...review.after,
    version,
    settingsVersionId: id,
    campaign: {
      ...review.after.campaign,
      id: campaignId,
      version: campaignVersion,
      settingsVersionId: id,
      dataVersion: (BigInt(review.after.campaign!.dataVersion) + 1n).toString(),
      reconciliationRequired: true,
      reconciledDataVersion: null,
    },
  });
  await db.query(
    `INSERT INTO settings_version(id,station_id,campaign_id,version,purchase_start,purchase_cutoff,upload_deadline,timezone,retention_days,effective_from,actor_id,reason,full_snapshot,previous_version_id,section,grace_hours,launch_at,timing_policy_version,retention_policy_version,stored_copy_policy,operation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,'giveaway',$15,$16,$17,$18,$19,$20)`,
    [
      id,
      station.id,
      campaignId,
      version,
      timing.purchaseStart,
      timing.purchaseCutoff,
      timing.uploadDeadline,
      timing.timezone,
      after.retention.days,
      at,
      actor.admin_id,
      p.reason,
      JSON.stringify(after),
      before.settingsVersionId,
      timing.graceHours,
      timing.launchAt,
      timing.policyVersion,
      after.retention.policyVersion,
      after.retention.storedCopyPolicy,
      p.operationId,
    ],
  );
  const result = await db.query(
    "UPDATE station_reporting_state SET settings_version=$2,current_settings_version_id=$3,launch_at=$6 WHERE station_id=$1 AND settings_version=$4 AND current_settings_version_id IS NOT DISTINCT FROM $5::uuid",
    [
      station.id,
      version,
      id,
      p.expectedVersion,
      before.settingsVersionId,
      timing.launchAt,
    ],
  );
  if (result.rowCount !== 1) throw new AuthError("version_conflict", 409);
  const campaignResult =
    p.kind === "create"
      ? { rowCount: 1 }
      : await db.query(
          "UPDATE campaign SET current_timing_version_id=$2,version=$3,reconciliation_required=true,reconciled_data_version=NULL WHERE id=$1 AND station_id=$4 AND version=$5",
          [
            campaignId,
            id,
            campaignVersion,
            station.id,
            p.kind === "create" ? 1 : p.expectedCampaignVersion,
          ],
        );
  if (campaignResult.rowCount !== 1)
    throw new AuthError("version_conflict", 409);
  const change = settingsChangeSchema.parse({
    id: changeId,
    section: "giveaway",
    kind: p.kind,
    campaignId,
    version,
    previousVersionId: before.settingsVersionId,
    appliedAt: at,
    actor: {
      id: actor.admin_id,
      code: actorSnapshot.code,
      name: actorSnapshot.nameAtEvent,
    },
    reason: p.reason,
    before: before.campaign?.timing ?? null,
    after: timing,
    auditEventId: auditId,
  });
  const fields = [
    {
      field: "campaignId",
      before: before.campaign?.id ?? null,
      after: campaignId,
    },
    { field: "settingsVersionId", before: before.settingsVersionId, after: id },
    {
      field: "settingsVersion",
      before: String(before.version),
      after: String(version),
    },
    {
      field: "campaignVersion",
      before: before.campaign ? String(before.campaign.version) : null,
      after: String(campaignVersion),
    },
    ...(
      [
        "launchAt",
        "purchaseStart",
        "purchaseCutoff",
        "graceHours",
        "uploadDeadline",
        "timezone",
        "policyVersion",
      ] as const
    ).map((field) => ({
      field: field === "policyVersion" ? "timingPolicyVersion" : field,
      before:
        before.campaign?.timing[field] == null
          ? null
          : String(before.campaign.timing[field]),
      after: timing[field] == null ? null : String(timing[field]),
    })),
  ];
  await writeSettingsAudit(
    db,
    m4SettingsAuditSchema.parse({
      id: auditId,
      eventCode: `AUD-${auditId}`,
      schemaVersion: 2,
      stationId: station.id,
      occurredAt: at,
      area: "settings",
      action:
        p.kind === "create" ? "campaign_created" : "giveaway_timing_changed",
      actor: actorSnapshot,
      originatingSeller: null,
      target: {
        kind: p.kind === "create" ? "campaign" : "settings",
        id: p.kind === "create" ? campaignId : id,
        code: p.kind === "create" ? `CAMPAIGN-${campaignId}` : `SETTINGS-${id}`,
        subjectAtEvent: null,
      },
      operationId: p.operationId,
      correlationId: p.operationId,
      reason: p.reason,
      relatedEventIds: [],
      changes: fields,
    }),
  );
  await db.query(
    "INSERT INTO settings_change(id,station_id,settings_version_id,version,section,applied_at,snapshot,before_values,after_values,audit_event_id) VALUES($1,$2,$3,$4,'giveaway',$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)",
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
  return change;
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
    if (section === "giveaway") {
      if (!actor.is_owner) throw new AuthError("owner_required", 403);
      return timingReview(
        db,
        await snapshot(db, station),
        timingReviewSchema.parse(parsed),
        actor.user_id,
        await now(db),
      );
    }
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
    if (section === "giveaway" && !actor.is_owner)
      throw new AuthError("owner_required", 403);
    let replayed = true;
    const data = await receipt(
      db,
      config,
      actor,
      `settings-${section}-confirm`,
      section === "giveaway"
        ? await normalizeTimingRequest(db, timingConfirmSchema.parse(parsed))
        : parsed,
      async () => {
        replayed = false;
        if (section === "giveaway")
          return commitTiming(
            db,
            station,
            actor,
            timingConfirmSchema.parse(parsed),
          );
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
