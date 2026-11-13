import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { newId } from "../../src/server/lib/ids";
import { digest } from "../../src/server/modules/auth/crypto";
import { transaction } from "../../src/server/modules/admin-access/repo";
import { fixtureId as id } from "../helpers/sync-fixture";
import {
  writeAudit,
  auditActor,
  auditTarget,
  auditSystem,
  type AuditWriteInput,
} from "../../src/server/modules/audit/write";
import { readAudit } from "../../src/server/modules/audit/service";
import { handleAudit } from "../../src/server/modules/audit/http";
import {
  auditPageSchema,
  auditEventSchema,
} from "../../src/shared/contracts/audit";
import { COOKIE } from "../../src/server/modules/admin-access/http";
vi.setConfig({ testTimeout: 30000 });
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const schema = `audit_history_${randomBytes(6).toString("hex")}`;
let pool: pg.Pool, token: string;
const config = {
  secret: randomBytes(32).toString("hex"),
  origin: "https://audit.example.test",
};
const canaries = {
  phone: "08012345678",
  dottedPhone: "0803.555.0199",
  maskedPhone: "••••0199",
  partialPhone: "0803****0199",
  ellipsisPhone: "0803…0199",
  labelledPassword: "Password fictional-passphrase",
  international: "+234.800.000.0099",
  otp: "794826",
  password: "password=CanaryPass-DoNotPersist!",
  token: "token=AuditCanaryBearerValueNeverPersist",
  url: "https://private.example.test/evidence?sig=canary",
  digest: "a7".repeat(32),
  card: "A7K3M9Q",
};
async function base(
  overrides: Partial<AuditWriteInput> = {},
): Promise<AuditWriteInput> {
  return transaction(pool, async (db) => ({
    stationId: id(8),
    action: "pump_created",
    actor: await auditActor(db, id(2)),
    target: await auditTarget(db, "pump", id(13), id(8)),
    reason: "Pump created",
    before: null,
    after: { productId: id(9), pumpVersion: "1" },
    ...overrides,
  }));
}
async function insert(overrides: Partial<AuditWriteInput> = {}) {
  const input = await base(overrides);
  return transaction(pool, (db) => writeAudit(db, input));
}
async function search(input: unknown = {}) {
  return auditPageSchema.parse(
    await readAudit(pool, config, token, "search", input),
  );
}
async function detail(eventId: string) {
  return auditEventSchema.parse(
    await readAudit(pool, config, token, "detail", {}, eventId),
  );
}
async function rawLegacy(
  action: string,
  targetType = "pump",
  targetId = id(13),
  after: unknown = {},
  extra: {
    actor?: unknown;
    station?: string;
    before?: unknown;
    reason?: string;
  } = {},
) {
  const eventId = newId();
  await pool.query(
    `INSERT INTO audit_event(id,actor_kind,action,target_type,target_id,"before","after",reason,occurred_at,actor_snapshot,station_id) VALUES($1,'system',$2,$3,$4,$5,$6,$7,clock_timestamp(),$8,$9)`,
    [
      eventId,
      action,
      targetType,
      targetId,
      extra.before ?? {},
      after,
      extra.reason ?? "Historical record",
      extra.actor ?? null,
      extra.station ?? null,
    ],
  );
  return eventId;
}
describe("I-41 audit history on real PostgreSQL", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
    process.env.DATABASE_URL = url.toString();
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const dir of (await readdir(migrations, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await pool.query(
        await readFile(
          new URL(`${dir.name}/migration.sql`, migrations),
          "utf8",
        ),
      );
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    await pool.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [id(2)],
    );
    token = randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,created_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 day',1,clock_timestamp(),clock_timestamp())",
      [newId(), id(2), digest(token)],
    );
    process.env.BETTER_AUTH_SECRET = config.secret;
    process.env.BETTER_AUTH_URL = config.origin;
    process.env.WHR_ENV = "test";
  }, 30000);
  afterAll(async () => {
    await pool?.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  });
  it("writes immutable actor and target snapshots and keeps history after staff edits", async () => {
    const eventId = await insert();
    await pool.query(
      "UPDATE auth_user SET display_name='Ada Updated' WHERE id=$1",
      [id(2)],
    );
    const event = await detail(eventId);
    expect(event.schemaVersion).toBe(1);
    expect(event.actor).toMatchObject({
      kind: "admin",
      nameAtEvent: "Ada Williams",
    });
    expect(event.target.code).toBe("PUMP01");
    expect(event.changes).toEqual([
      { field: "productId", before: null, after: id(9) },
      { field: "pumpVersion", before: null, after: "1" },
    ]);
    await pool.query(
      "UPDATE auth_user SET display_name='Ada Williams' WHERE id=$1",
      [id(2)],
    );
  });
  it("rejects unknown actions fields enums targets and incomplete shapes before persistence", async () => {
    const start = (await pool.query("SELECT count(*)::int n FROM audit_event"))
      .rows[0].n;
    const input = await base();
    const bad = [
      { action: "arbitrary_action" },
      {
        after: { productId: id(9), pumpVersion: "1", digest: canaries.digest },
      },
      { after: { productId: "invalid", pumpVersion: "1" } },
      { after: { productId: id(9), pumpVersion: null } },
      { after: { productId: id(9) } },
      { target: { ...input.target, kind: "customer" } },
      { actor: auditSystem("validation") },
      { relatedEventIds: Array.from({ length: 21 }, () => newId()) },
    ];
    for (const patch of bad)
      await expect(
        transaction(pool, (db) =>
          writeAudit(db, { ...input, ...patch } as AuditWriteInput),
        ),
      ).rejects.toThrow();
    expect(
      (await pool.query("SELECT count(*)::int n FROM audit_event")).rows[0].n,
    ).toBe(start);
  });
  it("rejects seeded phone OTP password token URL digest and printed codes without storing or echoing them", async () => {
    const log = vi.spyOn(process.stdout, "write");
    const error = vi.spyOn(process.stderr, "write");
    try {
      for (const value of Object.values(canaries)) {
        await expect(insert({ reason: `Audit ${value}` })).rejects.toThrow();
      }
      const dump = JSON.stringify(
        (
          await pool.query(
            "SELECT row_to_json(a) row FROM audit_event a WHERE schema_version=1",
          )
        ).rows,
      );
      const output = JSON.stringify(await search());
      for (const value of Object.values(canaries)) {
        expect(dump).not.toContain(value);
        expect(output).not.toContain(value);
        expect(JSON.stringify(log.mock.calls)).not.toContain(value);
        expect(JSON.stringify(error.mock.calls)).not.toContain(value);
      }
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
  it("enforces append-only UPDATE DELETE and TRUNCATE and rolls domain and event back together", async () => {
    const eventId = await insert();
    await expect(
      pool.query("UPDATE audit_event SET reason='Changed' WHERE id=$1", [
        eventId,
      ]),
    ).rejects.toThrow();
    await expect(
      pool.query("DELETE FROM audit_event WHERE id=$1", [eventId]),
    ).rejects.toThrow();
    await expect(pool.query("TRUNCATE audit_event CASCADE")).rejects.toThrow();
    const input = await base({ id: newId() });
    await expect(
      transaction(pool, async (db) => {
        await db.query(
          "UPDATE auth_user SET display_name='Rollback' WHERE id=$1",
          [id(2)],
        );
        await writeAudit(db, input);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(
      (await pool.query("SELECT id FROM audit_event WHERE id=$1", [input.id]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query("SELECT display_name FROM auth_user WHERE id=$1", [
          id(2),
        ])
      ).rows[0].display_name,
    ).toBe("Ada Williams");
  });
  it("uses inclusive Lagos days and stable microsecond time plus ID pagination", async () => {
    const target = await base();
    const events = [];
    for (const at of [
      "2026-10-20T22:59:59.999999Z",
      "2026-10-20T23:00:00.000000Z",
      "2026-10-21T22:59:59.999998Z",
      "2026-10-21T22:59:59.999999Z",
      "2026-10-21T23:00:00.000000Z",
    ])
      events.push(await insert({ ...target, occurredAt: at }));
    const first = await search({
      from: "2026-10-21",
      to: "2026-10-21",
      limit: 1,
    });
    expect(first.items.map((e) => e.id)).toEqual([events[3]]);
    expect(first.nextCursor).not.toBeNull();
    const second = await search({
      from: "2026-10-21",
      to: "2026-10-21",
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((e) => e.id)).toEqual([events[2], events[1]]);
    expect(second.nextCursor).toBeNull();
    const sameAt = "2026-10-22T12:00:00.123456Z";
    const same = [
      await insert({ occurredAt: sameAt }),
      await insert({ occurredAt: sameAt }),
    ]
      .sort()
      .reverse();
    expect(
      (await search({ from: "2026-10-22", to: "2026-10-22" })).items.map(
        (e) => e.id,
      ),
    ).toEqual([...same, events[4]]);
  });
  it("rejects nonexistent dates reversed ranges tampered cursors and changed filters", async () => {
    for (const from of ["2026-02-29", "2026-04-31", "not-date"])
      await expect(search({ from })).rejects.toMatchObject({
        code: "date_invalid",
        status: 422,
      });
    await expect(
      search({ from: "2026-11-02", to: "2026-11-01" }),
    ).rejects.toMatchObject({ code: "date_range_invalid" });
    const page = await search({ limit: 1 });
    expect(page.nextCursor).toBeTruthy();
    for (const patch of [
      { query: "Ada" },
      { actorKind: "system" },
      { area: "cards" },
      { from: "2026-01-01" },
      { targetId: id(14) },
    ])
      await expect(
        search({ ...patch, cursor: page.nextCursor }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      search({ cursor: page.nextCursor + "x" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("projects safe legacy fields and never rewrites or searches private historical payloads", async () => {
    const eventId = await rawLegacy(
      "pump_created",
      "pump",
      id(13),
      {
        productId: id(9),
        version: 3,
        notes: Object.values(canaries).join(" "),
      },
      { reason: Object.values(canaries).join(" ") },
    );
    const before = (
      await pool.query(
        "SELECT row_to_json(a) row FROM audit_event a WHERE id=$1",
        [eventId],
      )
    ).rows[0].row;
    const event = await detail(eventId);
    expect(event.schemaVersion).toBe(0);
    expect(event.actor).toBeNull();
    expect(event.target).toMatchObject({ code: null, subjectAtEvent: null });
    expect(event.changes).toEqual([
      { field: "productId", before: null, after: id(9) },
      { field: "pumpVersion", before: null, after: "3" },
    ]);
    for (const value of Object.values(canaries)) {
      expect(JSON.stringify(event)).not.toContain(value);
      expect((await search({ query: value })).items).toEqual([]);
    }
    const after = (
      await pool.query(
        "SELECT row_to_json(a) row FROM audit_event a WHERE id=$1",
        [eventId],
      )
    ).rows[0].row;
    expect(after).toEqual(before);
  });
  it("returns bounded legacy_event for unsupported shapes and excludes unknown actors from filters", async () => {
    const eventId = await rawLegacy(
      "settings_updated",
      "pump",
      id(13),
      { phone: canaries.phone },
      { actor: { kind: "admin", nameAtEvent: canaries.phone } },
    );
    const event = await detail(eventId);
    expect(event).toMatchObject({
      action: "legacy_event",
      actor: null,
      reason: "Historical event",
      changes: [],
      relatedEventIds: [],
    });
    expect(
      (await search({ actorKind: "admin" })).items.map((e) => e.id),
    ).not.toContain(eventId);
    const foreign = await rawLegacy(
      "pump_created",
      "customer",
      id(13),
      { productId: id(9) },
      { station: id(8) },
    );
    expect(await detail(foreign)).toMatchObject({
      action: "legacy_event",
      changes: [],
    });
  });
  it("excludes historical access and role rows without station proof even in a one-station database", async () => {
    const user = await rawLegacy("user_access_changed", "admin", id(5), {
      enabled: true,
    });
    const role = await rawLegacy("role_changed", "role", id(1), {
      roleName: "Owner",
    });
    for (const eventId of [user, role]) {
      await expect(detail(eventId)).rejects.toMatchObject({
        code: "not_found",
      });
      expect((await search()).items.map((e) => e.id)).not.toContain(eventId);
    }
  });
  it("rejects live permission revocation for list and detail independently of sales access", async () => {
    const eventId = await insert();
    await pool.query(
      "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='audit'",
      [id(1)],
    );
    try {
      await expect(search()).rejects.toMatchObject({
        code: "permission_denied",
      });
      await expect(detail(eventId)).rejects.toMatchObject({
        code: "permission_denied",
      });
    } finally {
      await pool.query(
        "INSERT INTO role_permission(role_id,permission_code) VALUES($1,'audit')",
        [id(1)],
      );
    }
    await expect(
      readAudit(pool, config, undefined, "search", {}),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });
  it("returns strict no-store HTTP envelopes with Origin size and date checks and no secret echo", async () => {
    const request = (data: unknown, origin = config.origin) =>
      new Request(`${config.origin}/api/admin/audit/search`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: `${COOKIE}=${token}`,
        },
        body: JSON.stringify(data),
      });
    const ok = await handleAudit(request({ limit: 1 }), "search");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect((await ok.json()).data.items).toHaveLength(1);
    expect(
      (await handleAudit(request({}, "https://foreign.example.test"), "search"))
        .status,
    ).toBe(403);
    const invalid = await handleAudit(
      request({ from: "2026-02-29" }),
      "search",
    );
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error.code).toBe("date_invalid");
    const oversized = await handleAudit(
      request({ query: canaries.token.repeat(2000) }),
      "search",
    );
    expect(oversized.status).toBe(413);
    expect(await oversized.text()).not.toContain(canaries.token);
  });
});
