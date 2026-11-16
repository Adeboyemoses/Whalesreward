import { RECONCILIATION_DIGEST } from "./reconciliation-policy";
import type pg from "pg";
import {
  managerSchema,
  censusSchema,
  exclusionSchema,
  exclusionDecisionSchema,
  phoneCheckSchema,
} from "../../../shared/contracts/giveaway-phones";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { transaction, receipt, type LiveAdmin } from "../admin-access/repo";
import type { AdminConfig } from "../admin-access/config";
import { AuthError } from "../auth/errors";
import { newId } from "../../lib/ids";
import { releasePerson } from "../reviews/release-people";
import { phoneReadiness } from "./phone-readiness";
type Kind = "initial" | "revision";
type Phone = {
  id: string;
  version: number;
  label: string;
  attendantIds: string[];
  state: string;
};
type CampaignRow = {
  id: string;
  station_id: string;
  version: number;
  data_version: string;
  current_timing_version_id: string | null;
  latest_snapshot_id: string | null;
  manager_designation_id: string | null;
  phone_census_id: string | null;
  phone_check_id: string | null;
  manager_admin_id: string | null;
  census_version: number | null;

  policy_version: string | null;
};
export type PhoneAudit = (
  db: pg.PoolClient,
  actor: LiveAdmin,
  campaignId: string,
  operationId: string,
  action: string,
  fields: Record<string, unknown>,
  related?: string[],
) => Promise<string>;
export type CampaignProjection = (
  db: pg.PoolClient,
  campaignId: string,
) => Promise<unknown>;
function publicExclusion(value: Record<string, unknown>) {
  const result = { ...value };
  delete result.operationId;
  delete result.proposerUserId;
  delete result.proposerPerson;
  delete result.approverPerson;
  return result;
}
function publicCheck(value: Record<string, unknown>) {
  const result = { ...value };
  delete result.designationId;
  delete result.operationId;
  delete result.reason;
  return result;
}
function fail(code: string, status = 409): never {
  throw new AuthError(code, status);
}
async function context(
  db: pg.PoolClient,
  token: string | undefined,
  campaignId: string,
) {
  await securityLock(db);
  const actor = await requireAdminSession(db, token);
  requirePermission(actor, "sales");
  const s = (
    await db.query(
      `SELECT station_id FROM campaign WHERE id=$1 AND station_id=(SELECT id FROM station ORDER BY id LIMIT 1)`,
      [campaignId],
    )
  ).rows[0];
  if (!s) fail("not_found", 404);
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('reporting:'||$1,0))",
    [s.station_id],
  );
  await db.query("SELECT id FROM campaign WHERE id=$1 FOR UPDATE", [
    campaignId,
  ]);
  const c = (
    await db.query<CampaignRow>(
      `SELECT c.*,r.data_version::text,d.manager_admin_id,pc.version AS census_version,CASE WHEN pd.evaluator_identity='reconciliation-v1' AND pd.semantics_digest='${RECONCILIATION_DIGEST}' AND pd.partial_uploads='exact_incomplete' AND pd.approval_reference='WHR-158 / WHR-162 / Earl 16 Nov 2026' THEN sp.policy_version END AS policy_version
 FROM campaign c JOIN station_reporting_state r ON r.station_id=c.station_id
 LEFT JOIN giveaway_manager_designation d ON d.id=c.manager_designation_id
 LEFT JOIN giveaway_phone_census pc ON pc.id=c.phone_census_id
 LEFT JOIN settings_version t ON t.id=c.current_timing_version_id
 LEFT JOIN station_reconciliation_policy sp ON sp.station_id=c.station_id LEFT JOIN reconciliation_policy_definition pd ON pd.policy_version=sp.policy_version WHERE c.id=$1`,
      [campaignId],
    )
  ).rows[0]!;
  return { actor, c };
}
function grant(actor: LiveAdmin, kind: Kind) {
  requirePermission(actor, "leaderboards");
  requirePermission(
    actor,
    kind === "initial" ? "giveawayFinalize" : "giveawayRevise",
  );
}
async function manager(db: pg.PoolClient, actor: LiveAdmin, c: CampaignRow) {
  if (actor.admin_id !== c.manager_admin_id) fail("permission_denied", 403);
  try {
    return await releasePerson(db, c.station_id, actor.user_id);
  } catch {
    fail("independent_admin_required", 403);
  }
}
async function readyTime(db: pg.PoolClient, c: CampaignRow, kind: Kind) {
  if (c.policy_version !== "reconciliation-v1")
    fail("reconciliation_policy_unconfigured");
  const passed = (
    await db.query<{ passed: boolean }>(
      `SELECT clock_timestamp()>s.upload_deadline AS passed
     FROM settings_version s WHERE s.id=$1 AND s.campaign_id=$2 AND s.station_id=$3`,
      [c.current_timing_version_id, c.id, c.station_id],
    )
  ).rows[0]?.passed;
  if (!passed) fail("finalization_blocked");
  if (kind === "initial" && c.latest_snapshot_id) fail("snapshot_exists");
  if (kind === "revision" && !c.latest_snapshot_id) fail("snapshot_missing");
}
function guard(
  c: CampaignRow,
  input: {
    expectedVersion: number;
    expectedDataVersion: string;
    expectedSettingsVersionId: string | null;
    expectedPreviousSnapshotId: string | null;
    expectedCensusVersion: number;
  },
) {
  if (c.latest_snapshot_id !== input.expectedPreviousSnapshotId)
    fail("snapshot_superseded");
  if (
    c.version !== input.expectedVersion ||
    c.data_version !== input.expectedDataVersion ||
    c.current_timing_version_id !== input.expectedSettingsVersionId ||
    (c.census_version ?? 1) !== input.expectedCensusVersion
  )
    fail("version_conflict");
}
async function advance(db: pg.PoolClient, c: CampaignRow, bumped = false) {
  if (!bumped)
    await db.query(
      "UPDATE campaign SET version=version+1,reconciliation_required=true WHERE id=$1",
      [c.id],
    );
  await db.query(
    "UPDATE station_reporting_state SET data_version=data_version+1,last_writer_transaction=pg_current_xact_id() WHERE station_id=$1 AND last_writer_transaction IS DISTINCT FROM pg_current_xact_id()",
    [c.station_id],
  );
  return (
    await db.query(
      "SELECT data_version::text FROM station_reporting_state WHERE station_id=$1",
      [c.station_id],
    )
  ).rows[0].data_version as string;
}
async function actorProjection(db: pg.PoolClient, actor: LiveAdmin) {
  return (
    await db.query(
      "SELECT a.id,a.admin_code AS code,u.display_name AS name FROM admin a JOIN auth_user u ON u.id=a.user_id WHERE a.id=$1",
      [actor.admin_id],
    )
  ).rows[0];
}
async function required(db: pg.PoolClient, stationId: string) {
  return (
    await db.query<{ id: string }>(
      `SELECT DISTINCT a.attendant_id AS id FROM assignment a JOIN pump p ON p.id=a.pump_id WHERE p.station_id=$1 UNION SELECT originating_attendant_id AS id FROM purchase WHERE station_id=$1 ORDER BY id`,
      [stationId],
    )
  ).rows.map((r) => r.id);
}
async function census(db: pg.PoolClient, c: CampaignRow): Promise<Phone[]> {
  if (!c.phone_census_id) fail("census_incomplete", 422);
  return (
    await db.query(
      "SELECT content FROM giveaway_phone_census WHERE id=$1 AND campaign_id=$2",
      [c.phone_census_id, c.id],
    )
  ).rows[0].content.phones;
}
async function partial(
  db: pg.PoolClient,
  c: CampaignRow,
  ids: { purchaseId: string; expectedPurchaseVersion: number }[],
  phone: Phone,
) {
  if (new Set(ids.map((x) => x.purchaseId)).size !== ids.length)
    fail("invalid_request", 400);
  const result = [];
  for (const source of ids) {
    const p = (
      await db.query(
        `SELECT p.*,EXISTS(SELECT 1 FROM photo_receipt_observation o WHERE o.purchase_id=p.id) AS observed,EXISTS(SELECT 1 FROM purchase_revision r WHERE r.purchase_id=p.id AND r.state='accepted') AS ever_accepted FROM purchase p WHERE p.id=$1 AND p.station_id=$2 FOR SHARE`,
        [source.purchaseId, c.station_id],
      )
    ).rows[0];
    if (
      !p ||
      !phone.attendantIds.includes(p.originating_attendant_id) ||
      p.current_revision_id ||
      p.ever_accepted ||
      !["received", "photo_pending"].includes(p.status) ||
      p.observed
    )
      fail("exclusion_source_invalid", 422);
    if (p.version !== source.expectedPurchaseVersion) fail("exclusion_stale");
    result.push({
      purchaseId: p.id,
      purchaseVersion: p.version,
      originatingAttendantId: p.originating_attendant_id,
      state: p.status,
      detailsReceivedAt: p.server_received_at.toISOString(),
      amountKobo: p.amount_kobo,
      currency: p.currency,
      quantity: p.quantity,
      unit: p.unit,
    });
  }
  return result;
}
export function createPhoneService(
  pool: pg.Pool,
  config: AdminConfig,
  audit: PhoneAudit,
  project: CampaignProjection,
  onReplay?: () => void,
) {
  const domainReceipt: typeof receipt = async (
    db,
    configuration,
    actor,
    kind,
    input,
    run,
  ) => {
    const existing = (
      await db.query(
        "SELECT 1 FROM mutation_receipt WHERE actor_user_id=$1 AND operation_kind=$2 AND operation_id=$3",
        [actor.user_id, kind, input.operationId],
      )
    ).rowCount;
    const result = await receipt(db, configuration, actor, kind, input, run);
    if (existing) onReplay?.();
    return result;
  };
  return {
    async designate(
      token: string | undefined,
      campaignId: string,
      input: unknown,
    ) {
      const b = managerSchema.parse(input);
      return transaction(pool, async (db) => {
        const { actor, c } = await context(db, token, campaignId);
        requirePermission(actor, "settings");
        if (!actor.is_owner) fail("owner_required", 403);
        return domainReceipt(
          db,
          config,
          actor,
          "giveaway_manager",
          { ...b, campaignId },
          async () => {
            if (c.version !== b.expectedVersion) fail("version_conflict");
            if (c.manager_admin_id === b.managerAdminId) fail("no_change");
            const target = (
              await db.query(
                `SELECT a.id FROM admin a JOIN auth_user u ON u.id=a.user_id JOIN role r ON r.id=a.role_id
                 JOIN LATERAL (SELECT verified FROM held_release_person_binding WHERE station_id=$2 AND user_id=u.id ORDER BY version DESC LIMIT 1) person ON person.verified
                 WHERE a.id=$1 AND u.enabled AND u.kind='admin' AND r.enabled AND NOT u.must_change_password
                 AND (SELECT count(DISTINCT permission_code) FROM role_permission WHERE role_id=r.id AND permission_code=ANY($3::text[]))=3`,
                [
                  b.managerAdminId,
                  c.station_id,
                  [
                    "sales",
                    "leaderboards",
                    c.latest_snapshot_id
                      ? "giveawayRevise"
                      : "giveawayFinalize",
                  ],
                ],
              )
            ).rows[0];
            if (!target) fail("manager_invalid", 422);
            const id = newId();
            const auditEventId = await audit(
              db,
              actor,
              c.id,
              b.operationId,
              "giveaway_manager_designated",
              { managerDesignationId: id, managerAdminId: b.managerAdminId },
            );
            await db.query(
              "INSERT INTO giveaway_manager_designation(id,campaign_id,manager_admin_id,content) VALUES($1,$2,$3,$4)",
              [
                id,
                c.id,
                b.managerAdminId,
                {
                  reason: b.reason,
                  auditEventId,
                  actorId: actor.admin_id,
                  operationId: b.operationId,
                },
              ],
            );
            await db.query(
              "UPDATE campaign SET manager_designation_id=$2,version=version+1,reconciliation_required=true WHERE id=$1",
              [c.id, id],
            );
            await advance(db, c, true);
            return { campaign: await project(db, c.id), auditEventId };
          },
        );
      });
    },
    async census(
      token: string | undefined,
      campaignId: string,
      input: unknown,
    ) {
      const b = censusSchema.parse(input);
      return transaction(pool, async (db) => {
        const { actor, c } = await context(db, token, campaignId);
        grant(actor, b.kind);
        await manager(db, actor, c);
        return domainReceipt(
          db,
          config,
          actor,
          "giveaway_census",
          { ...b, campaignId },
          async () => {
            guard(c, b);
            await readyTime(db, c, b.kind);
            const requiredIds = await required(db, c.station_id);
            const supplied = new Set(b.phones.flatMap((p) => p.attendantIds));
            if (requiredIds.some((id) => !supplied.has(id)))
              fail("census_incomplete", 422);
            const valid = (
              await db.query<{ id: string }>(
                "SELECT id FROM attendant WHERE id=ANY($1::uuid[])",
                [[...supplied]],
              )
            ).rows;
            if (valid.length !== supplied.size) fail("not_found", 404);
            const prior = c.phone_census_id ? await census(db, c) : [];
            const phones = b.phones.map((p) => {
              if (new Set(p.attendantIds).size !== p.attendantIds.length)
                fail("invalid_request", 400);
              const old = p.id ? prior.find((q) => q.id === p.id) : null;
              if (p.id && !old) fail("not_found", 404);
              return {
                ...p,
                id: p.id ?? newId(),
                version: old ? old.version + 1 : 1,
                state: "unchecked",
              };
            });
            if (new Set(phones.map((p) => p.id)).size !== phones.length)
              fail("invalid_request", 400);
            const id = newId(),
              version = (c.census_version ?? 1) + 1;
            const auditEventId = await audit(
              db,
              actor,
              c.id,
              b.operationId,
              "giveaway_phone_census_recorded",
              { phoneCensusId: id, censusVersion: version, actionKind: b.kind },
            );
            await db.query(
              "INSERT INTO giveaway_phone_census(id,campaign_id,version,designation_id,content) VALUES($1,$2,$3,$4,$5)",
              [
                id,
                c.id,
                version,
                c.manager_designation_id,
                {
                  phones,
                  reason: b.reason,
                  kind: b.kind,
                  auditEventId,
                  actorId: actor.admin_id,
                  operationId: b.operationId,
                },
              ],
            );
            await db.query(
              "UPDATE campaign SET phone_census_id=$2,version=version+1,reconciliation_required=true WHERE id=$1",
              [c.id, id],
            );
            const dataVersion = await advance(db, c, true);
            return {
              census: {
                id,
                campaignId: c.id,
                version,
                managerAdminId: c.manager_admin_id,
                dataVersion,
              },
              campaign: await project(db, c.id),
              auditEventId,
            };
          },
        );
      });
    },
    async propose(
      token: string | undefined,
      campaignId: string,
      phoneId: string,
      input: unknown,
    ) {
      const b = exclusionSchema.parse(input);
      return transaction(pool, async (db) => {
        const { actor, c } = await context(db, token, campaignId);
        grant(actor, b.kind);
        await manager(db, actor, c);
        return domainReceipt(
          db,
          config,
          actor,
          "giveaway_phone_exclusion",
          { ...b, campaignId, phoneId },
          async () => {
            guard(c, b);
            await readyTime(db, c, b.kind);
            const phone = (await census(db, c)).find((p) => p.id === phoneId);
            if (!phone) fail("not_found", 404);
            if (phone.version !== b.expectedPhoneVersion)
              fail("version_conflict");
            const pending = (
              await db.query(
                `SELECT 1 FROM giveaway_phone_exclusion e JOIN LATERAL(SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=e.id ORDER BY version DESC LIMIT 1)t ON true WHERE e.campaign_id=$1 AND e.content->>'phoneId'=$2 AND t.state='pending'`,
                [c.id, phoneId],
              )
            ).rowCount;
            if (pending) fail("exclusion_pending");
            const partialSources = await partial(
              db,
              c,
              b.partialSources,
              phone,
            );
            const id = newId();
            const auditEventId = await audit(
              db,
              actor,
              c.id,
              b.operationId,
              "giveaway_phone_unavailable_proposed",
              {
                phoneExclusionId: id,
                phoneId,
                censusVersion: c.census_version,
                phoneVersion: phone.version,
                exclusionVersion: 1,
                phoneExclusionState: "pending",
                proposerAdminId: actor.admin_id,
                actionKind: b.kind,
              },
            );
            const time = (
              await db.query("SELECT clock_timestamp() AS at")
            ).rows[0].at.toISOString();
            const attendants = (
              await db.query(
                `SELECT a.id,a.staff_code AS "staffCode",u.display_name AS name,u.username FROM attendant a JOIN auth_user u ON u.id=a.user_id WHERE a.id=ANY($1::uuid[]) ORDER BY a.id`,
                [phone.attendantIds],
              )
            ).rows;
            const content = {
              id,
              campaignId: c.id,
              phoneId,
              version: 1,
              censusId: c.phone_census_id,
              censusVersion: c.census_version,
              phoneVersion: phone.version,
              designationId: c.manager_designation_id,
              settingsVersionId: c.current_timing_version_id,
              policyVersion: c.policy_version,
              previousSnapshotId: c.latest_snapshot_id,
              phoneLabel: phone.label,
              attendants,
              partialSources,
              kind: b.kind,
              state: "pending",
              operationId: b.operationId,
              proposerUserId: actor.user_id,
              proposerPerson: await releasePerson(
                db,
                c.station_id,
                actor.user_id,
              ),
              proposedBy: await actorProjection(db, actor),
              proposedAt: time,
              decidedBy: null,
              decidedAt: null,
              reason: b.reason,
              decisionReason: null,
              auditEventId,
            };
            if (Buffer.byteLength(JSON.stringify(content)) > 32768)
              fail("request_too_large", 413);
            await db.query(
              "INSERT INTO giveaway_phone_exclusion(id,campaign_id,census_id,content) VALUES($1,$2,$3,$4)",
              [id, c.id, c.phone_census_id, content],
            );
            await db.query(
              "INSERT INTO giveaway_phone_exclusion_transition(id,exclusion_id,version,state,content) VALUES($1,$2,1,'pending',$3)",
              [newId(), id, { auditEventId }],
            );
            await advance(db, c);
            return {
              exclusion: publicExclusion(content),
              campaign: await project(db, c.id),
            };
          },
        );
      });
    },
    async decide(
      token: string | undefined,
      campaignId: string,
      exclusionId: string,
      input: unknown,
    ) {
      const b = exclusionDecisionSchema.parse(input);
      return transaction(pool, async (db) => {
        const { actor, c } = await context(db, token, campaignId);
        const e = (
          await db.query(
            `SELECT e.content,t.version,t.state,t.content AS transition FROM giveaway_phone_exclusion e JOIN LATERAL(SELECT * FROM giveaway_phone_exclusion_transition WHERE exclusion_id=e.id ORDER BY version DESC LIMIT 1)t ON true WHERE e.id=$1 AND e.campaign_id=$2`,
            [exclusionId, c.id],
          )
        ).rows[0];
        if (!e) fail("not_found", 404);
        grant(actor, e.content.kind);
        const a = await releasePerson(db, c.station_id, actor.user_id),
          p = await releasePerson(db, c.station_id, e.content.proposerUserId);
        if (a.personId === p.personId) fail("independent_admin_required", 403);
        return domainReceipt(
          db,
          config,
          actor,
          "giveaway_phone_decision",
          { ...b, campaignId, exclusionId },
          async () => {
            if (
              e.content.proposerPerson?.bindingId !== p.bindingId ||
              e.content.proposerPerson?.version !== p.version
            )
              fail("exclusion_stale");
            if (e.version !== b.expectedVersion) fail("version_conflict");
            if (e.state !== "pending")
              fail(
                e.state === "superseded"
                  ? "exclusion_stale"
                  : "exclusion_closed",
              );
            if (
              e.content.censusId !== c.phone_census_id ||
              e.content.designationId !== c.manager_designation_id ||
              e.content.settingsVersionId !== c.current_timing_version_id ||
              e.content.previousSnapshotId !== c.latest_snapshot_id ||
              e.content.policyVersion !== c.policy_version
            )
              fail("exclusion_stale");
            if (b.decision === "approve") {
              const live = (
                await db.query(
                  `SELECT 1 FROM admin a JOIN auth_user u ON u.id=a.user_id JOIN role r ON r.id=a.role_id
                WHERE a.id=$1 AND a.user_id=$2 AND u.enabled AND r.enabled AND NOT u.must_change_password
                AND (SELECT count(DISTINCT permission_code) FROM role_permission WHERE role_id=r.id AND permission_code=ANY($3::text[]))=3`,
                  [
                    c.manager_admin_id,
                    e.content.proposerUserId,
                    [
                      "sales",
                      "leaderboards",
                      e.content.kind === "initial"
                        ? "giveawayFinalize"
                        : "giveawayRevise",
                    ],
                  ],
                )
              ).rowCount;
              if (!live) fail("permission_denied", 403);
            }
            await readyTime(db, c, e.content.kind);
            const phone = (await census(db, c)).find(
              (p) => p.id === e.content.phoneId,
            )!;
            await partial(
              db,
              c,
              e.content.partialSources.map(
                (s: { purchaseId: string; purchaseVersion: number }) => ({
                  purchaseId: s.purchaseId,
                  expectedPurchaseVersion: s.purchaseVersion,
                }),
              ),
              phone,
            );
            const auditEventId = await audit(
              db,
              actor,
              c.id,
              b.operationId,
              b.decision === "approve"
                ? "giveaway_phone_unavailable_approved"
                : "giveaway_phone_unavailable_rejected",
              {
                phoneExclusionId: exclusionId,
                phoneId: phone.id,
                exclusionVersion: e.version + 1,
                phoneExclusionState:
                  b.decision === "approve" ? "approved" : "rejected",
                proposerAdminId: e.content.proposedBy.id,
                approverAdminId: actor.admin_id,
                actionKind: e.content.kind,
              },
              [e.content.auditEventId],
            );
            const content = {
              ...e.content,
              version: e.version + 1,
              state: b.decision === "approve" ? "approved" : "rejected",
              decidedBy: await actorProjection(db, actor),
              approverPerson: a,
              decidedAt: (
                await db.query("SELECT clock_timestamp() AS at")
              ).rows[0].at.toISOString(),
              decisionReason: b.reason,
              auditEventId,
            };
            await db.query(
              "INSERT INTO giveaway_phone_exclusion_transition(id,exclusion_id,version,state,content) VALUES($1,$2,$3,$4,$5)",
              [newId(), exclusionId, content.version, content.state, content],
            );
            await advance(db, c);
            return {
              exclusion: publicExclusion(content),
              campaign: await project(db, c.id),
            };
          },
        );
      });
    },
    async check(token: string | undefined, campaignId: string, input: unknown) {
      const b = phoneCheckSchema.parse(input);
      return transaction(pool, async (db) => {
        const { actor, c } = await context(db, token, campaignId);
        grant(actor, b.kind);
        await manager(db, actor, c);
        return domainReceipt(
          db,
          config,
          actor,
          "giveaway_phone_check",
          { ...b, campaignId },
          async () => {
            guard(c, b);
            await readyTime(db, c, b.kind);
            const phones = await census(db, c);
            if (
              b.entries.length !== phones.length ||
              new Set(b.entries.map((e) => e.phoneId)).size !== phones.length
            )
              fail("census_incomplete", 422);
            const entries = [];
            for (const entry of b.entries) {
              const phone = phones.find((p) => p.id === entry.phoneId);
              if (!phone || phone.version !== entry.expectedPhoneVersion)
                fail("phone_check_stale");
              if ((entry.result === "empty") !== (entry.exclusionId === null))
                fail("invalid_request", 400);
              if (entry.exclusionId) {
                const e = (
                  await db.query(
                    `SELECT e.content,t.state FROM giveaway_phone_exclusion e JOIN LATERAL(SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=e.id ORDER BY version DESC LIMIT 1)t ON true WHERE e.id=$1 AND e.campaign_id=$2`,
                    [entry.exclusionId, c.id],
                  )
                ).rows[0];
                if (
                  !e ||
                  e.state !== "approved" ||
                  e.content.phoneId !== phone.id ||
                  e.content.censusId !== c.phone_census_id ||
                  e.content.designationId !== c.manager_designation_id ||
                  e.content.settingsVersionId !== c.current_timing_version_id ||
                  e.content.previousSnapshotId !== c.latest_snapshot_id ||
                  e.content.kind !== b.kind
                )
                  fail("phone_check_stale");
                await partial(
                  db,
                  c,
                  e.content.partialSources.map(
                    (s: { purchaseId: string; purchaseVersion: number }) => ({
                      purchaseId: s.purchaseId,
                      expectedPurchaseVersion: s.purchaseVersion,
                    }),
                  ),
                  phone,
                );
              }
              entries.push({
                phoneId: phone.id,
                phoneVersion: phone.version,
                attendantIds: phone.attendantIds,
                result: entry.result,
                exclusionId: entry.exclusionId,
              });
            }
            const current = await phoneReadiness(db, c.id, b.kind);
            if (current.status.pendingExclusions !== "0")
              fail("phone_exclusion_pending");
            const id = newId(),
              auditEventId = await audit(
                db,
                actor,
                c.id,
                b.operationId,
                "giveaway_phone_check_recorded",
                {
                  phoneCheckId: id,
                  phoneCensusId: c.phone_census_id,
                  censusVersion: c.census_version,
                  actionKind: b.kind,
                },
              );
            const sourceDataVersion = await advance(db, c, true);
            const content = {
              id,
              campaignId: c.id,
              kind: b.kind,
              operationId: b.operationId,
              reason: b.reason,
              manager: await actorProjection(db, actor),
              checkedAt: (
                await db.query("SELECT clock_timestamp() AS at")
              ).rows[0].at.toISOString(),
              sourceDataVersion,
              settingsVersionId: c.current_timing_version_id,
              censusVersion: c.census_version,
              previousSnapshotId: c.latest_snapshot_id,
              policyVersion: c.policy_version,
              censusId: c.phone_census_id,
              designationId: c.manager_designation_id,
              auditEventId,
            };
            await db.query(
              "INSERT INTO giveaway_phone_check(id,campaign_id,census_id,content,entries) VALUES($1,$2,$3,$4,$5)",
              [id, c.id, c.phone_census_id, content, JSON.stringify(entries)],
            );
            await db.query(
              "UPDATE campaign SET phone_check_id=$2,version=version+1,reconciliation_required=true WHERE id=$1",
              [c.id, id],
            );
            return {
              phoneCheck: publicCheck(content),
              campaign: await project(db, c.id),
            };
          },
        );
      });
    },
  };
}
