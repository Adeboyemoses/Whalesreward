import type pg from "pg";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireAdminSession, requirePermission } from "../../lib/authz";
import { transaction } from "../admin-access/repo";
import { AuthError } from "../auth/errors";
const page = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(4096).optional(),
});
const cursor = z.strictObject({
  scope: z.string(),
  generation: z.string(),
  position: z.number().int().nonnegative(),
});
function pack(secret: string, value: z.infer<typeof cursor>) {
  const p = Buffer.from(JSON.stringify(value)).toString("base64url");
  return p + "." + createHmac("sha256", secret).update(p).digest("base64url");
}
function unpack(secret: string, value: string) {
  try {
    const [p, s, ...rest] = value.split(".");
    if (!p || !s || rest.length) throw Error();
    const expected = createHmac("sha256", secret).update(p).digest(),
      actual = Buffer.from(s, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw Error();
    return cursor.parse(JSON.parse(Buffer.from(p, "base64url").toString()));
  } catch {
    throw new AuthError("invalid_request", 400);
  }
}
/** All inventory reads require sales in addition to leaderboard authority. */
export async function readPhones(
  pool: pg.Pool,
  secret: string,
  token: string | undefined,
  campaignId: string,
  action:
    | "phones"
    | "required-attendants"
    | "exclusions"
    | "exclusion"
    | "check"
    | "entries",
  resourceId?: string,
  input: unknown = {},
) {
  const p = page.parse(input);
  if (
    ["exclusion", "check"].includes(action) &&
    Object.keys(input as Record<string, unknown>).length
  )
    throw new AuthError("invalid_request", 400);
  return transaction(pool, async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await db.query("SELECT id FROM security_state WHERE id=true FOR SHARE");
    const actor = await requireAdminSession(db, token);
    requirePermission(actor, "leaderboards");
    requirePermission(actor, "sales");
    const c = (
      await db.query(
        `SELECT c.*,r.data_version::text,d.manager_admin_id,pc.version AS census_version,pc.content AS census_content
 FROM campaign c JOIN station_reporting_state r ON r.station_id=c.station_id
 LEFT JOIN giveaway_manager_designation d ON d.id=c.manager_designation_id
 LEFT JOIN giveaway_phone_census pc ON pc.id=c.phone_census_id
 WHERE c.id=$1 AND c.station_id=(SELECT id FROM station ORDER BY id LIMIT 1)`,
        [campaignId],
      )
    ).rows[0];
    if (!c) throw new AuthError("not_found", 404);
    const census = {
      id: c.phone_census_id,
      campaignId: c.id,
      version: c.census_version ?? 1,
      managerAdminId: c.manager_admin_id ?? null,
      dataVersion: c.data_version,
    };
    let rows: unknown[] = [];
    let generation = `${c.data_version}:${c.census_version ?? 1}`;
    if (action === "phones") {
      rows = c.census_content?.phones ?? [];
      const exclusions = (
        await db.query(
          `SELECT e.content,t.state FROM giveaway_phone_exclusion e JOIN LATERAL(SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=e.id ORDER BY version DESC LIMIT 1)t ON true WHERE e.campaign_id=$1 AND e.census_id=$2 ORDER BY e.id`,
          [c.id, c.phone_census_id],
        )
      ).rows;
      const check = c.phone_check_id
        ? (
            await db.query(
              "SELECT entries,content FROM giveaway_phone_check WHERE id=$1",
              [c.phone_check_id],
            )
          ).rows[0]
        : null;
      rows = rows.map((value) => {
        const phone = value as { id: string; state: string };
        const e = exclusions.find(
          (e) =>
            e.content.phoneId === phone.id &&
            ["pending", "approved"].includes(e.state),
        );
        const empty =
          check?.content.sourceDataVersion === c.data_version &&
          check.entries.some(
            (v: { phoneId: string; result: string }) =>
              v.phoneId === phone.id && v.result === "empty",
          );
        return {
          ...phone,
          state: e
            ? e.state === "approved"
              ? "unavailable_approved"
              : "unavailable_pending"
            : empty
              ? "empty"
              : "unchecked",
        };
      });
    } else if (action === "required-attendants")
      rows = (
        await db.query(
          `SELECT DISTINCT a.attendant_id AS "attendantId" FROM assignment a JOIN pump p ON p.id=a.pump_id WHERE p.station_id=$1 UNION SELECT originating_attendant_id AS "attendantId" FROM purchase WHERE station_id=$1 ORDER BY "attendantId"`,
          [c.station_id],
        )
      ).rows;
    else if (action === "exclusions" || action === "exclusion") {
      rows = (
        await db.query(
          `SELECT e.content || t.content || jsonb_build_object('state',t.state,'version',t.version) AS content
  FROM giveaway_phone_exclusion e JOIN LATERAL(SELECT * FROM giveaway_phone_exclusion_transition WHERE exclusion_id=e.id ORDER BY version DESC LIMIT 1)t ON true
  WHERE e.campaign_id=$1 AND ($2::uuid IS NULL OR e.id=$2) ORDER BY e.id`,
          [c.id, action === "exclusion" ? resourceId : null],
        )
      ).rows.map((r) => {
        const value = { ...r.content };
        delete value.operationId;
        delete value.proposerUserId;
        delete value.proposerPerson;
        delete value.approverPerson;
        return value;
      });
      if (action === "exclusion") {
        if (!rows[0]) throw new AuthError("not_found", 404);
        return rows[0];
      }
    } else {
      const check = (
        await db.query(
          "SELECT content,entries FROM giveaway_phone_check WHERE campaign_id=$1 AND id=$2",
          [c.id, resourceId],
        )
      ).rows[0];
      if (!check) throw new AuthError("not_found", 404);
      if (action === "check") {
        const value = { ...check.content };
        delete value.designationId;
        delete value.operationId;
        delete value.reason;
        return value;
      }
      rows = check.entries;
      generation = resourceId!;
    }
    const scope = `giveaway:${campaignId}:${action}:${resourceId ?? ""}`;
    let position = 0;
    if (p.cursor) {
      const decoded = unpack(secret, p.cursor);
      if (decoded.scope !== scope) throw new AuthError("invalid_request", 400);
      if (decoded.generation !== generation)
        throw new AuthError("read_view_stale", 409);
      position = decoded.position;
    }
    const items = rows.slice(position, position + p.limit),
      next = position + items.length;
    const result = {
      items,
      nextCursor:
        next < rows.length
          ? pack(secret, { scope, generation, position: next })
          : null,
    };
    return action === "phones"
      ? { census, phones: result }
      : action === "required-attendants"
        ? { census, attendants: result }
        : result;
  });
}
