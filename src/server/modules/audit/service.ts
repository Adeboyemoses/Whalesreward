import type pg from "pg";
import {
  auditDate,
  auditId,
  auditSearchSchema,
  type AuditEvent,
} from "../../../shared/contracts/audit";
import { requireAdminSession, requirePermission } from "../../lib/authz";
import { nextStationMidnight } from "../../lib/time";
import { transaction } from "../admin-access/repo";
import { AuthError } from "../auth/errors";
import { decodeCursor, encodeCursor } from "../sales/cursor";
import { eventStation, projectAudit, type AuditRow } from "./project";
const selected = `a.*,to_char(a.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at`;
export async function auditAuthority(
  db: pg.PoolClient,
  token: string | undefined,
) {
  await db.query("SELECT id FROM security_state WHERE id=true FOR SHARE");
  const actor = await requireAdminSession(db, token);
  requirePermission(actor, "audit");
  const stations = (
    await db.query<{ id: string }>("SELECT id FROM station ORDER BY id LIMIT 2")
  ).rows;
  if (stations.length !== 1)
    throw new AuthError("temporarily_unavailable", 503);
  return stations[0]!.id;
}
export function auditDateBounds(from?: string, to?: string) {
  for (const v of [from, to])
    if (v !== undefined && !auditDate.safeParse(v).success)
      throw new AuthError("date_invalid", 422);
  if (from && to && from > to) throw new AuthError("date_range_invalid", 422);
  const start = (day: string) =>
    new Date(`${day}T00:00:00+01:00`).toISOString();
  return {
    from: from ? start(from) : null,
    to: to ? nextStationMidnight(new Date(start(to))).toISOString() : null,
  };
}
export async function readAudit(
  pool: pg.Pool,
  config: { secret: string },
  token: string | undefined,
  action: "search" | "detail",
  input: unknown = {},
  eventId?: string,
) {
  const search = action === "search" ? auditSearchSchema.parse(input) : null;
  if (action === "detail") auditId.parse(eventId);
  const bounds = search ? auditDateBounds(search.from, search.to) : null;
  return transaction(pool, async (db) => {
    const stationId = await auditAuthority(db, token);
    // All rows are read by one statement below: a page has one MVCC snapshot.
    if (action === "detail") {
      const row = (
        await db.query<AuditRow>(
          `SELECT ${selected} FROM audit_event a WHERE a.id=$1 AND (a.station_id=$2 OR a.station_id IS NULL)`,
          [eventId, stationId],
        )
      ).rows[0];
      if (!row || (await eventStation(db, row)) !== stationId)
        throw new AuthError("not_found", 404);
      const event = projectAudit(row, stationId);
      if (!event) throw new AuthError("not_found", 404);
      return event;
    }
    const s = search!;
    const query = s.query?.trim().toLowerCase() ?? "";
    const scope = JSON.stringify([
      "audit-v1",
      stationId,
      query,
      s.area ?? null,
      s.actorKind ?? null,
      s.from ?? null,
      s.to ?? null,
      s.targetId ?? null,
      "occurredAt-desc,id-desc",
    ]);
    const cursor = decodeCursor(config.secret, scope, s.cursor);
    await db.query(
      `DECLARE audit_page NO SCROLL CURSOR FOR SELECT ${selected} FROM audit_event a WHERE (a.station_id=$1 OR a.station_id IS NULL) AND ($2::timestamptz IS NULL OR a.occurred_at >= $2::timestamptz) AND ($3::timestamptz IS NULL OR a.occurred_at < $3::timestamptz) AND ($4::uuid IS NULL OR a.target_id=$4) AND ($5::timestamptz IS NULL OR (a.occurred_at,a.id)<($5::timestamptz,$6::uuid)) ORDER BY a.occurred_at DESC,a.id DESC`,
      [
        stationId,
        bounds!.from,
        bounds!.to,
        s.targetId ?? null,
        cursor?.at ?? null,
        cursor?.id ?? null,
      ],
    );
    const items: AuditEvent[] = [];
    let finished = false;
    while (!finished) {
      const rows = (
        await db.query<AuditRow>("FETCH FORWARD 256 FROM audit_page")
      ).rows;
      if (rows.length < 256) finished = true;
      for (const row of rows) {
        if ((await eventStation(db, row)) !== stationId) continue;
        const e = projectAudit(row, stationId);
        if (
          !e ||
          (s.area && e.area !== s.area) ||
          (s.actorKind && e.actor?.kind !== s.actorKind)
        )
          continue;
        const actor = e.actor;
        const searchable = [
          e.eventCode,
          e.action,
          e.target.code,
          e.target.subjectAtEvent,
          ...(actor?.kind === "system"
            ? [actor.nameAtEvent, actor.service]
            : actor
              ? [
                  actor.code,
                  actor.nameAtEvent,
                  actor.usernameAtEvent,
                  actor.roleAtEvent,
                ]
              : []),
        ]
          .filter((v) => typeof v === "string")
          .join(" ")
          .toLowerCase();
        if (query && !searchable.includes(query)) continue;
        items.push(e);
        if (items.length > s.limit) {
          finished = true;
          break;
        }
      }
    }
    await db.query("CLOSE audit_page");
    const more = items.length > s.limit;
    const page = items.slice(0, s.limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        more && last
          ? encodeCursor(config.secret, scope, last.occurredAt, last.id)
          : null,
    };
  });
}
