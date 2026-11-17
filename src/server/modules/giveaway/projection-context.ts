import type pg from "pg";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireAdminSession, requirePermission } from "../../lib/authz";
import { AuthError } from "../auth/errors";
import { campaignData } from "./data";
import { releasePerson } from "../reviews/release-people";
import { recordedReconciliationPolicy } from "./policy";
export type ProjectionAction =
  | "checklist"
  | "results"
  | "managers"
  | "attendants"
  | "phones"
  | "incomplete-sources";
export const opaque = (secret: string, value: unknown) =>
  createHmac("sha256", secret)
    .update(JSON.stringify(value))
    .digest("base64url");
export function pack(secret: string, value: unknown) {
  const p = Buffer.from(JSON.stringify(value)).toString("base64url");
  return p + "." + opaque(secret, p);
}
export function unpack(secret: string, value: string): unknown {
  try {
    const [p, s, ...rest] = value.split(".");
    if (!p || !s || rest.length) throw Error();
    const a = Buffer.from(s),
      b = Buffer.from(opaque(secret, p));
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw Error();
    return JSON.parse(Buffer.from(p, "base64url").toString());
  } catch {
    throw new AuthError("invalid_request", 400);
  }
}
export async function projectionContext(
  db: pg.PoolClient,
  token: string | undefined,
  campaignId: string,
  action: ProjectionAction,
) {
  await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await db.query("SELECT id FROM security_state WHERE id=true FOR SHARE");
  const actor = await requireAdminSession(db, token);
  if (action === "managers") {
    requirePermission(actor, "settings");
    requirePermission(actor, "sales");
    if (!actor.is_owner) throw new AuthError("owner_required", 403);
  } else {
    requirePermission(actor, "leaderboards");
    if (action !== "checklist") requirePermission(actor, "sales");
  }
  const stations = (
    await db.query<{ id: string }>("SELECT id FROM station ORDER BY id LIMIT 2")
  ).rows;
  if (stations.length !== 1)
    throw new AuthError("temporarily_unavailable", 503);
  const station = stations[0]!;
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('reporting:'||$1::text,0))",
    [station.id],
  );
  const c = await campaignData(db, station.id, campaignId);
  const kind = c.latest_snapshot_id
    ? ("revision" as const)
    : ("initial" as const);
  const inventory = (
    await db.query(
      `SELECT d.manager_admin_id,pc.version census_version,pc.content census_content,ch.content check_content,ch.entries check_entries FROM campaign c LEFT JOIN giveaway_manager_designation d ON d.id=c.manager_designation_id LEFT JOIN giveaway_phone_census pc ON pc.id=c.phone_census_id AND pc.campaign_id=c.id LEFT JOIN giveaway_phone_check ch ON ch.id=c.phone_check_id AND ch.campaign_id=c.id WHERE c.id=$1`,
      [c.id],
    )
  ).rows[0];
  if (["attendants", "phones", "incomplete-sources"].includes(action)) {
    requirePermission(
      actor,
      kind === "initial" ? "giveawayFinalize" : "giveawayRevise",
    );
    if (actor.admin_id !== inventory.manager_admin_id)
      throw new AuthError("permission_denied", 403);
    try {
      await releasePerson(db, station.id, actor.user_id);
    } catch {
      throw new AuthError("independent_admin_required", 403);
    }
  }
  return {
    actor,
    c,
    kind,
    inventory,
    policy: await recordedReconciliationPolicy(db, station.id),
  };
}
export type ProjectionContext = Awaited<ReturnType<typeof projectionContext>>;
/** Digest only retained non-secret state; the response contains only the HMAC. */
export async function projectionView(
  db: pg.PoolClient,
  secret: string,
  ctx: ProjectionContext,
) {
  const { c, actor, kind, inventory, policy } = ctx;
  const identities = (
    await db.query(
      `SELECT a.id,a.admin_code,u.id user_id,u.display_name,u.username,u.enabled,u.must_change_password,u.auth_version,r.id role_id,r.enabled role_enabled,r.is_owner,ARRAY(SELECT permission_code FROM role_permission WHERE role_id=r.id ORDER BY permission_code) permissions,(SELECT jsonb_build_object('id',b.id,'version',b.version,'person',b.person_id,'verified',b.verified) FROM held_release_person_binding b WHERE b.station_id=$1 AND b.user_id=u.id ORDER BY b.version DESC LIMIT 1) binding FROM admin a JOIN auth_user u ON u.id=a.user_id JOIN role r ON r.id=a.role_id ORDER BY a.id`,
      [c.station_id],
    )
  ).rows;
  const accounts = (
    await db.query(
      `SELECT a.id,a.staff_code,u.display_name,u.username,u.enabled,coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'from',x.effective_from,'to',x.effective_until) ORDER BY x.id) FROM assignment x JOIN pump p ON p.id=x.pump_id WHERE x.attendant_id=a.id AND p.station_id=$1),'[]') assignments FROM attendant a JOIN auth_user u ON u.id=a.user_id WHERE a.id IN (SELECT x.attendant_id FROM assignment x JOIN pump p ON p.id=x.pump_id WHERE p.station_id=$1 UNION SELECT originating_attendant_id FROM purchase WHERE station_id=$1) ORDER BY a.id`,
      [c.station_id],
    )
  ).rows;
  const guard = {
    expectedVersion: c.version,
    expectedSettingsVersionId: c.current_timing_version_id,
    expectedDataVersion: c.data_version,
    expectedPreviousSnapshotId: c.latest_snapshot_id,
  };
  const pins = {
    kind,
    guard,
    censusId: c.phone_census_id,
    censusVersion: inventory.census_version ?? 1,
    designationId: c.manager_designation_id,
    phoneCheckId: c.phone_check_id,
    reconciliationPolicyVersion: policy,
  };
  const viewToken = opaque(secret, {
    actor: {
      id: actor.id,
      admin: actor.admin_id,
      role: actor.role_id,
      owner: actor.is_owner,
      permissions: [...actor.permissions].sort(),
      authVersion: actor.auth_version,
    },
    campaign: c.id,
    ...pins,
    timing: [c.timing_policy_version, c.after_cutoff, c.after_deadline],
    identities,
    accounts,
    inventory,
  });
  return { asOf: c.now.toISOString(), viewToken, ...pins };
}
