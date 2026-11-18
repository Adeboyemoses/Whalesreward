import {
  managerCandidatePredicate,
  requiredAttendantsQuery,
  incompleteCandidate,
} from "./selection-predicates";
import type pg from "pg";
import { z } from "zod";
import { AuthError } from "../auth/errors";
import {
  managerChoiceSchema,
  currentDesignationSchema,
  attendantChoiceSchema,
  phoneChoiceSchema,
  incompleteChoiceSchema,
} from "../../../shared/contracts/giveaway-projections";
import type { ProjectionContext } from "./projection-context";
import { phoneReadiness } from "./phone-readiness";
export function retained<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AuthError("temporarily_unavailable", 503);
  return parsed.data;
}
export async function managers(db: pg.PoolClient, ctx: ProjectionContext) {
  const rows = (
    await db.query(
      `SELECT a.id AS "adminId",a.admin_code AS "adminCode",u.display_name AS name,true AS "personVerified",ARRAY(SELECT k FROM (VALUES ('initial','giveawayFinalize'),('revision','giveawayRevise')) AS kinds(k,p) WHERE EXISTS(SELECT 1 FROM role_permission WHERE role_id=r.id AND permission_code=kinds.p)) AS "eligibleFor" FROM admin a JOIN auth_user u ON u.id=a.user_id JOIN role r ON r.id=a.role_id JOIN LATERAL(SELECT verified FROM held_release_person_binding WHERE station_id=$2 AND user_id=u.id ORDER BY version DESC LIMIT 1)b ON b.verified WHERE ($1::uuid IS NULL OR a.id=$1) AND ${managerCandidatePredicate} ORDER BY a.id`,
      [
        null,
        ctx.c.station_id,
        [
          "sales",
          "leaderboards",
          ctx.kind === "initial" ? "giveawayFinalize" : "giveawayRevise",
        ],
      ],
    )
  ).rows;
  let currentDesignation = null;
  if (ctx.c.manager_designation_id) {
    const row = (
      await db.query(
        `SELECT d.id,jsonb_build_object('adminId',a.id,'adminCode',a.admin_code,'name',u.display_name) manager FROM giveaway_manager_designation d JOIN admin a ON a.id=d.manager_admin_id JOIN auth_user u ON u.id=a.user_id WHERE d.id=$1 AND d.campaign_id=$2`,
        [ctx.c.manager_designation_id, ctx.c.id],
      )
    ).rows[0];
    currentDesignation = retained(currentDesignationSchema, row);
  }
  return {
    items: rows.map((r) => retained(managerChoiceSchema, r)),
    currentDesignation,
  };
}
export async function attendants(db: pg.PoolClient, ctx: ProjectionContext) {
  const rows = (
    await db.query(
      `WITH required AS (${requiredAttendantsQuery}) SELECT q.id AS "attendantId",a.staff_code AS "staffCode",u.display_name AS name,u.username,u.enabled,EXISTS(SELECT 1 FROM assignment x JOIN pump p ON p.id=x.pump_id WHERE x.attendant_id=q.id AND p.station_id=$1 AND x.effective_until IS NULL) AS "hasCurrentAssignment",true AS required FROM required q LEFT JOIN attendant a ON a.id=q.id LEFT JOIN auth_user u ON u.id=a.user_id ORDER BY q.id`,
      [ctx.c.station_id],
    )
  ).rows;
  return rows.map((r) => retained(attendantChoiceSchema, r));
}
export async function phones(db: pg.PoolClient, ctx: ProjectionContext) {
  if (!ctx.c.phone_census_id) return [];
  const raw = retained(
    z
      .array(
        z.strictObject({
          id: phoneChoiceSchema.shape.id,
          version: phoneChoiceSchema.shape.version,
          label: phoneChoiceSchema.shape.label,
          attendantIds: phoneChoiceSchema.shape.attendantIds,
          state: phoneChoiceSchema.shape.state,
        }),
      )
      .max(100),
    ctx.inventory.census_content?.phones,
  );
  if (
    new Set(raw.map((p) => p.id)).size !== raw.length ||
    raw.some((p) => new Set(p.attendantIds).size !== p.attendantIds.length)
  )
    throw new AuthError("temporarily_unavailable", 503);
  const status = await phoneReadiness(db, ctx.c.id, ctx.kind);
  const exclusions = (
    await db.query(
      `SELECT e.content,t.state FROM giveaway_phone_exclusion e JOIN LATERAL(SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=e.id ORDER BY version DESC LIMIT 1)t ON true WHERE e.campaign_id=$1 AND e.census_id=$2 ORDER BY e.id`,
      [ctx.c.id, ctx.c.phone_census_id],
    )
  ).rows;
  return raw
    .map((p) => {
      const exclusion = exclusions.find(
        (e) =>
          e.content.phoneId === p.id &&
          ["pending", "approved"].includes(e.state),
      );
      const empty =
        ctx.inventory.check_content?.sourceDataVersion === ctx.c.data_version &&
        ctx.inventory.check_entries?.some(
          (e: { phoneId: string; result: string }) =>
            e.phoneId === p.id && e.result === "empty",
        );
      return retained(phoneChoiceSchema, {
        ...p,
        state: exclusion
          ? exclusion.state === "approved"
            ? "unavailable_approved"
            : "unavailable_pending"
          : empty
            ? "empty"
            : "unchecked",
        censusId: ctx.c.phone_census_id,
        censusVersion: ctx.inventory.census_version,
        phoneCheckState: status.status.state,
      });
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
export async function incomplete(
  db: pg.PoolClient,
  ctx: ProjectionContext,
  phoneId: string,
) {
  const phone = (await phones(db, ctx)).find((p) => p.id === phoneId);
  if (!phone) throw new AuthError("not_found", 404);
  const rows = (
    await db.query(
      `SELECT p.id AS "purchaseId",p.version AS "purchaseVersion",p.originating_attendant_id AS "originatingAttendantId",p.status state,to_char(p.server_received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "detailsReceivedAt",p.amount_kobo::text AS "amountKobo",p.currency,trim_scale(p.quantity)::text quantity,p.unit,false AS "everAccepted",false AS "hasTrustedByteObservation",false AS "hasCompletePhotoFact",'manager_attestation_required' AS "phoneAttribution" FROM purchase p WHERE p.station_id=$1 AND p.originating_attendant_id=ANY($2::uuid[]) AND p.status IN ('received','photo_pending') AND p.current_revision_id IS NULL AND NOT EXISTS(SELECT 1 FROM purchase_revision r WHERE r.purchase_id=p.id AND r.state IN ('accepted','superseded')) AND NOT EXISTS(SELECT 1 FROM photo_receipt_observation o WHERE o.purchase_id=p.id) AND NOT EXISTS(SELECT 1 FROM photo_receipt_fact f WHERE f.purchase_id=p.id) ORDER BY p.id`,
      [ctx.c.station_id, phone.attendantIds],
    )
  ).rows;
  return rows
    .filter((r) =>
      incompleteCandidate(
        {
          originating_attendant_id: r.originatingAttendantId,
          current_revision_id: null,
          ever_accepted: r.everAccepted,
          status: r.state,
          observed: r.hasTrustedByteObservation,
        },
        phone.attendantIds,
      ),
    )
    .map((r) => retained(incompleteChoiceSchema, r));
}
