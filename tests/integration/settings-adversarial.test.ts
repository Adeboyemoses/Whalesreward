import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cardsFixture,
  config,
  fixtureId as id,
  historicalSale,
} from "../helpers/cards-adversarial-fixture";
import { newId } from "../../src/server/lib/ids";
import { issueSession } from "../../src/server/modules/admin-access/sessions";
import {
  readSettings,
  reviewSettings,
  confirmSettings,
} from "../../src/server/modules/settings/service";
import { settingsSchema } from "../../src/shared/contracts/settings";
import { COOKIE } from "../../src/server/modules/admin-access/http";
import { readAudit } from "../../src/server/modules/audit/service";
import {
  auditEventSchema,
  auditPageSchema,
} from "../../src/shared/contracts/audit";
import { GET as getSettings } from "../../src/app/api/admin/settings/route";
import { GET as getHistory } from "../../src/app/api/admin/settings/history/route";
import { POST as reviewRetention } from "../../src/app/api/admin/settings/retention/review/route";
import { POST as confirmRetention } from "../../src/app/api/admin/settings/retention/confirm/route";
import { POST as reviewGiveaway } from "../../src/app/api/admin/settings/giveaway/review/route";
import { POST as confirmGiveaway } from "../../src/app/api/admin/settings/giveaway/confirm/route";

vi.setConfig({ testTimeout: 30000 });
let f: Awaited<ReturnType<typeof cardsFixture>>, token: string;
let requestNumber = 0;
type Route = (request: Request) => Promise<Response>;
async function call(
  route: Route,
  body?: unknown,
  options: {
    token?: string;
    query?: string;
    origin?: string;
    method?: string;
  } = {},
) {
  const response = await route(
    new Request(`${config.origin}/api/admin/settings${options.query ?? ""}`, {
      method: options.method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        cookie: `${COOKIE}=${options.token ?? token}`,
        origin: options.origin ?? config.origin,
        "content-type": "application/json",
        "x-test-ip": `settings-${++requestNumber}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { response, body: await response.json() };
}
async function settings() {
  const result = await call(getSettings);
  expect(result.response.status, JSON.stringify(result.body)).toBe(200);
  return result.body.data;
}
async function proposal(days?: number | null, actorToken = token) {
  const current = await settings();
  const input = {
    days: days === undefined ? (current.retention.days ?? 10) + 1 : days,
    expectedVersion: current.version,
    reason: "Record fictional retention intent",
  };
  const reviewed = await call(reviewRetention, input, { token: actorToken });
  expect(reviewed.response.status, JSON.stringify(reviewed.body)).toBe(200);
  return {
    input,
    review: reviewed.body.data,
    confirm: {
      ...input,
      operationId: newId(),
      reviewDigest: reviewed.body.data.reviewDigest,
    },
  };
}
async function domainRows() {
  const names = [
    "settings_version",
    "settings_change",
    "audit_event",
    "mutation_receipt",
  ];
  const rows: Record<string, unknown> = {};
  for (const name of names)
    rows[name] = (
      await f.pool.query(`SELECT * FROM ${name} t ORDER BY to_jsonb(t)::text`)
    ).rows;
  rows.reporting = (
    await f.pool.query(
      "SELECT * FROM station_reporting_state ORDER BY station_id",
    )
  ).rows;
  return rows;
}
beforeAll(async () => {
  f = await cardsFixture();
  token = await f.owner();
}, 30000);
beforeEach(async () => {
  await f.pool.query("DELETE FROM auth_rate_bucket");
});
afterAll(async () => {
  await f?.close();
});

describe("WHR-26 independent settings transaction verification", () => {
  it("I-45 untouched settings expose null policy values and logical version one without seeding board values", async () => {
    const before = await domainRows();
    const current = await settings();
    expect(current).toMatchObject({
      version: 1,
      settingsVersionId: null,
      campaign: null,
      retention: {
        days: null,
        deletionEnabled: false,
        policyVersion: null,
        storedCopyPolicy: "unconfigured",
      },
    });
    expect((await call(getHistory)).body.data.items).toEqual([]);
    expect(await domainRows()).toEqual(before);
  });

  it("I-45 review is deterministic and side-effect free while reason and proposed value bind its digest", async () => {
    const before = await domainRows();
    const p = await proposal();
    const again = await call(reviewRetention, p.input);
    expect(again.body.data.reviewDigest).toBe(p.review.reviewDigest);
    expect(p.review.after.version).toBe(p.review.before.version);
    expect(p.review.after.settingsVersionId).toBe(
      p.review.before.settingsVersionId,
    );
    expect(p.review.after.retention.deletionEnabled).toBe(false);
    expect(p.review.after.campaign).toEqual(p.review.before.campaign);
    const reason = await call(reviewRetention, {
      ...p.input,
      reason: "A distinct reviewed reason",
    });
    const days = await call(reviewRetention, {
      ...p.input,
      days: p.input.days! + 1,
    });
    expect(reason.body.data.reviewDigest).not.toBe(p.review.reviewDigest);
    expect(days.body.data.reviewDigest).not.toBe(p.review.reviewDigest);
    expect(await domainRows()).toEqual(before);
  });

  it("I-07 a review digest is bound to its actor and exact comparison rather than granting confirmation authority", async () => {
    const p = await proposal();
    const other = await f.actor(["settings"]);
    const before = await domainRows();
    for (const [body, actorToken] of [
      [p.confirm, other.token],
      [{ ...p.confirm, reason: "Changed after review" }, token],
      [{ ...p.confirm, days: p.input.days! + 1 }, token],
      [{ ...p.confirm, reviewDigest: "0".repeat(64) }, token],
    ] as const) {
      const result = await call(confirmRetention, body, { token: actorToken });
      expect(result.response.status, JSON.stringify(result.body)).toBe(409);
      expect(result.body.error.code).toBe("review_stale");
    }
    expect(await domainRows()).toEqual(before);
  });

  it("I-45 concurrent identical confirmations return one created result and one immutable replay", async () => {
    const p = await proposal();
    const before = await domainRows();
    const results = await Promise.all([
      call(confirmRetention, p.confirm),
      call(confirmRetention, p.confirm),
    ]);
    expect(results.map((r) => r.response.status).sort()).toEqual([200, 201]);
    expect(results[0]!.body.data).toEqual(results[1]!.body.data);
    const saved = await settings();
    expect(saved.version).toBe(p.input.expectedVersion + 1);
    for (const name of [
      "settings_version",
      "settings_change",
      "audit_event",
      "mutation_receipt",
    ])
      expect(
        (await f.pool.query(`SELECT count(*) FROM ${name}`)).rows[0].count,
      ).toBe(String((before[name] as unknown[]).length + 1));
  });

  it("I-45 distinct operations competing for the same settings version have one winner and no lost update", async () => {
    const p = await proposal();
    const otherInput = { ...p.input, days: p.input.days! + 1 };
    const otherReview = await call(reviewRetention, otherInput);
    const results = await Promise.all([
      call(confirmRetention, p.confirm),
      call(confirmRetention, {
        ...otherInput,
        operationId: newId(),
        reviewDigest: otherReview.body.data.reviewDigest,
      }),
    ]);
    expect(results.map((r) => r.response.status).sort()).toEqual([201, 409]);
    expect(
      results.find((r) => r.response.status === 409)!.body.error.code,
    ).toBe("version_conflict");
    const winner = results.find((r) => r.response.status === 201)!.body.data;
    expect((await settings()).retention).toEqual(winner.after);
    expect((await settings()).version).toBe(p.input.expectedVersion + 1);
  });

  it("I-41 lost-response replay survives newer settings and actor renaming without rewriting its historical receipt", async () => {
    const actor = await f.actor(["settings"]);
    const p = await proposal(undefined, actor.token);
    const first = await call(confirmRetention, p.confirm, {
      token: actor.token,
    });
    expect(first.response.status).toBe(201);
    const next = await proposal();
    expect((await call(confirmRetention, next.confirm)).response.status).toBe(
      201,
    );
    await f.pool.query(
      "UPDATE auth_user SET display_name='Favour James' WHERE id=$1",
      [actor.userId],
    );
    const before = await domainRows();
    const replay = await call(confirmRetention, p.confirm, {
      token: actor.token,
    });
    expect(replay.response.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);
    const conflict = await call(
      confirmRetention,
      { ...p.confirm, reason: "A changed operation payload" },
      { token: actor.token },
    );
    expect(conflict.response.status).toBe(409);
    expect(conflict.body.error.code).toBe("operation_conflict");
    expect(await domainRows()).toEqual(before);
  });

  it("I-45 history is immutable, version-descending and cursor-bound to its section", async () => {
    const first = await call(getHistory, undefined, {
      query: "?section=retention&limit=1",
    });
    expect(first.response.status).toBe(200);
    expect(first.body.data.items).toHaveLength(1);
    expect(first.body.data.nextCursor).toBeTruthy();
    const second = await call(getHistory, undefined, {
      query: `?section=retention&limit=1&cursor=${encodeURIComponent(first.body.data.nextCursor)}`,
    });
    expect(second.response.status).toBe(200);
    expect(second.body.data.items[0].version).toBeLessThan(
      first.body.data.items[0].version,
    );
    const wrongSection = await call(getHistory, undefined, {
      query: `?section=giveaway&cursor=${encodeURIComponent(first.body.data.nextCursor)}`,
    });
    expect(wrongSection.response.status).toBe(400);
    const badCursor = await call(getHistory, undefined, {
      query: `?cursor=${randomBytes(32).toString("hex")}`,
    });
    expect(badCursor.response.status).toBe(400);
    const saved = await settings();
    const row = (
      await f.pool.query("SELECT * FROM settings_version WHERE id=$1", [
        saved.settingsVersionId,
      ])
    ).rows[0];
    await expect(
      f.pool.query("UPDATE settings_version SET retention_days=1 WHERE id=$1", [
        row.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      f.pool.query("DELETE FROM settings_version WHERE id=$1", [row.id]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      f.pool.query(
        "UPDATE settings_change SET before_values='{}'::jsonb WHERE settings_version_id=$1",
        [row.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (
        await f.pool.query("SELECT * FROM settings_version WHERE id=$1", [
          row.id,
        ])
      ).rows[0],
    ).toEqual(row);
  });

  it("I-41 a failure saving the receipt rolls back the settings version, history, audit and pointer together", async () => {
    const p = await proposal();
    const before = await domainRows();
    await f.pool.query(
      "CREATE FUNCTION settings_test_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected receipt failure'; END $$",
    );
    await f.pool.query(
      "CREATE TRIGGER settings_test_receipt_failure BEFORE INSERT ON mutation_receipt FOR EACH ROW EXECUTE FUNCTION settings_test_receipt_failure()",
    );
    try {
      const failed = await call(confirmRetention, p.confirm);
      expect(failed.response.status).toBe(503);
      expect(await domainRows()).toEqual(before);
    } finally {
      await f.pool.query(
        "DROP TRIGGER settings_test_receipt_failure ON mutation_receipt",
      );
      await f.pool.query("DROP FUNCTION settings_test_receipt_failure()");
    }
    expect((await call(confirmRetention, p.confirm)).response.status).toBe(201);
  });

  it("I-09 revocation committed while confirmation waits for the security lock wins before any settings write", async () => {
    const actor = await f.actor(["settings"]);
    const p = await proposal(undefined, actor.token);
    const before = await domainRows();
    const blocker = await f.pool.connect();
    let pending: ReturnType<typeof call> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM security_state WHERE id=true FOR UPDATE",
      );
      pending = call(confirmRetention, p.confirm, { token: actor.token });
      await f.waitForLock("security_state");
      await blocker.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='settings'",
        [actor.roleId],
      );
      await blocker.query("COMMIT");
      const denied = await pending;
      expect(denied.response.status).toBe(403);
      expect(denied.body.error.code).toBe("permission_denied");
      expect(await domainRows()).toEqual(before);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await pending;
    }
  });

  it("I-07 current settings permission is required on all six routes including immutable replay", async () => {
    const actor = await f.actor(["settings"]);
    const p = await proposal(undefined, actor.token);
    expect(
      (await call(confirmRetention, p.confirm, { token: actor.token })).response
        .status,
    ).toBe(201);
    await f.pool.query(
      "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='settings'",
      [actor.roleId],
    );
    const timing = {
      campaignId: newId(),
      purchaseCutoff: "2031-06-01T00:00:00Z",
      graceHours: 0,
      reason: "Fictional review",
      expectedVersion: 1,
      expectedCampaignVersion: 1,
    };
    for (const [route, body] of [
      [getSettings, undefined],
      [getHistory, undefined],
      [reviewRetention, p.input],
      [confirmRetention, p.confirm],
      [reviewGiveaway, timing],
      [
        confirmGiveaway,
        { ...timing, operationId: newId(), reviewDigest: "0".repeat(64) },
      ],
    ] as const) {
      const denied = await call(route, body, { token: actor.token });
      expect(denied.response.status, JSON.stringify(denied.body)).toBe(403);
      expect(denied.body.error.code).toBe("permission_denied");
    }
    const restricted = await f.actor(["settings"], true);
    expect(
      (await call(getSettings, undefined, { token: restricted.token })).response
        .status,
    ).toBe(403);
    expect(
      (await call(getSettings, undefined, { token: "invalid" })).response
        .status,
    ).toBe(401);
  });

  it("I-45 unapproved timing fails closed with a non-retryable domain conflict and no writes", async () => {
    const current = await settings();
    const campaign = newId();
    await f.pool.query(
      "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional campaign',1,true)",
      [campaign, id(8)],
    );
    const before = await domainRows();
    const input = {
      campaignId: campaign,
      purchaseCutoff: "2031-06-01T00:00:00Z",
      graceHours: 0,
      reason: "Fictional timing proposal",
      expectedVersion: current.version,
      expectedCampaignVersion: 1,
    };
    for (const [route, body] of [
      [reviewGiveaway, input],
      [
        confirmGiveaway,
        { ...input, operationId: newId(), reviewDigest: "0".repeat(64) },
      ],
    ] as const) {
      const result = await call(route, body);
      expect(result.response.status, JSON.stringify(result.body)).toBe(409);
      expect(result.body.error).toMatchObject({
        code: "timing_policy_unconfigured",
        retryable: false,
      });
    }
    expect(await domainRows()).toEqual(before);
  });

  it("I-51 saving and clearing retention preserves sales, pending evidence, holds and campaign timing", async () => {
    await historicalSale(f.pool, { state: "held" });
    await historicalSale(f.pool, { state: "photo_pending" });
    const preservedTables = [
      "campaign",
      "purchase",
      "photo_asset",
      "purchase_hold",
      "purchase_revision",
      "sync_validation",
      "giveaway_snapshot",
    ];
    const snapshot = async () => {
      const rows: Record<string, unknown> = {};
      for (const name of preservedTables)
        rows[name] = (
          await f.pool.query(
            `SELECT to_jsonb(t) AS value FROM ${name} t ORDER BY to_jsonb(t)::text`,
          )
        ).rows;
      return rows;
    };
    const before = await snapshot();
    for (const days of [36500, null]) {
      const p = await proposal(days);
      const result = await call(confirmRetention, p.confirm);
      expect(result.response.status, JSON.stringify(result.body)).toBe(201);
      expect(result.body.data.after).toMatchObject({
        days,
        deletionEnabled: false,
        policyVersion: null,
        storedCopyPolicy: "unconfigured",
      });
      expect((await settings()).retention.deletionEnabled).toBe(false);
      expect(p.review.after.campaign).toEqual(p.review.before.campaign);
      expect(await snapshot()).toEqual(before);
    }
  });

  it("I-41 retention history grants no audit access and audit list/detail preserve typed version-two event facts", async () => {
    const actor = await f.actor(["settings"]);
    const p = await proposal(undefined, actor.token);
    const saved = await call(confirmRetention, p.confirm, {
      token: actor.token,
    });
    expect(saved.response.status).toBe(201);
    const eventId = saved.body.data.auditEventId;
    expect(
      (await call(getHistory, undefined, { token: actor.token })).response
        .status,
    ).toBe(200);
    await expect(
      readAudit(f.pool, config, actor.token, "detail", {}, eventId),
    ).rejects.toMatchObject({ code: "permission_denied" });
    const event = auditEventSchema.parse(
      await readAudit(f.pool, config, token, "detail", {}, eventId),
    );
    expect(event).toMatchObject({
      schemaVersion: 2,
      area: "settings",
      action: "retention_intent_changed",
      operationId: p.confirm.operationId,
      originatingSeller: null,
      target: { kind: "settings", subjectAtEvent: null },
    });
    expect(event.changes).toEqual(
      expect.arrayContaining([
        {
          field: "retentionDays",
          before:
            p.review.before.retention.days === null
              ? null
              : String(p.review.before.retention.days),
          after: String(p.input.days),
        },
        { field: "deletionEnabled", before: false, after: false },
        {
          field: "settingsVersion",
          before: String(p.input.expectedVersion),
          after: String(p.input.expectedVersion + 1),
        },
      ]),
    );
    expect(event.changes.map((c) => c.field).sort()).toEqual([
      "deletionEnabled",
      "retentionDays",
      "settingsVersion",
      "settingsVersionId",
    ]);
    const page = auditPageSchema.parse(
      await readAudit(f.pool, config, token, "search", { area: "settings" }),
    );
    expect(page.items.find((entry) => entry.id === eventId)).toEqual(event);
    await f.pool.query(
      "UPDATE auth_user SET display_name='Tunde Adebayo' WHERE id=$1",
      [actor.userId],
    );
    expect(
      await readAudit(f.pool, config, token, "detail", {}, eventId),
    ).toEqual(event);
    expect(JSON.stringify(event)).not.toContain(p.review.reviewDigest);
  });

  it("I-51 retention accepts only positive whole days within the ceiling, while no-change writes nothing", async () => {
    const current = await settings();
    const before = await domainRows();
    for (const days of [0, -1, 0.5, 36501, 1e20]) {
      const response = await call(reviewRetention, {
        days,
        expectedVersion: current.version,
        reason: "Validate fictional intent",
      });
      expect(response.response.status).toBe(422);
      expect(response.body.error).toMatchObject({
        code: "retention_invalid",
        retryable: false,
      });
    }
    const unchanged = await call(reviewRetention, {
      days: current.retention.days,
      expectedVersion: current.version,
      reason: "Unchanged intent",
    });
    expect(unchanged.response.status).toBe(409);
    expect(unchanged.body.error.code).toBe("no_change");
    expect(await domainRows()).toEqual(before);
  });

  it("I-07 review POST checks origin and strict schemas; reads and refusals are not cacheable", async () => {
    const p = await proposal();
    const rejected = await call(reviewRetention, p.input, {
      origin: "https://foreign.example.test",
    });
    expect(rejected.response.status).toBe(403);
    expect(rejected.body.error.code).toBe("origin_rejected");
    for (const addition of [
      { deletionEnabled: true },
      { actorId: id(5) },
      { stationId: id(8) },
      { policyVersion: "approved" },
    ])
      expect(
        (await call(reviewRetention, { ...p.input, ...addition })).response
          .status,
      ).toBe(400);
    expect(
      (await call(getSettings, undefined, { query: "?stationId=foreign" }))
        .response.status,
    ).toBe(400);
    expect(
      (await call(getHistory, undefined, { query: "?limit=1&limit=2" }))
        .response.status,
    ).toBe(400);
    expect(
      (await call(getSettings)).response.headers.get("cache-control"),
    ).toBe("no-store");
    expect(rejected.response.headers.get("cache-control")).toBe("no-store");
  });
});

it("I-45 migration preserves existing microsecond campaign timing and a retention edit never repins it or copies old deletion approval", async () => {
  const schema = `settings_legacy_${randomBytes(8).toString("hex")}`;
  const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await root.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  const pool = new pg.Pool({ connectionString: url.toString() });
  const campaignId = newId(),
    settingsId = newId();
  const times = [
    "2030-03-01T00:00:00.123456Z",
    "2030-06-01T00:00:00.654321Z",
    "2030-06-01T02:00:00.654321Z",
  ];
  const timingColumns =
    "campaign_id,purchase_start::text,purchase_cutoff::text,upload_deadline::text,timezone";
  try {
    const directory = new URL("../../prisma/migrations/", import.meta.url);
    const migrations = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const settingsMigration = migrations.findIndex((name) =>
      name.endsWith("_settings_intent"),
    );
    expect(settingsMigration).toBeGreaterThan(0);
    for (const name of migrations.slice(0, settingsMigration))
      await pool.query(
        await readFile(new URL(`${name}/migration.sql`, directory), "utf8"),
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
    await pool.query(
      "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Legacy fictional campaign',4,true)",
      [campaignId, id(8)],
    );
    await pool.query(
      `INSERT INTO settings_version(id,station_id,campaign_id,version,purchase_start,purchase_cutoff,upload_deadline,timezone,retention_days,retention_approved_by,retention_approved_at,effective_from,actor_id,reason) VALUES($1,$2,$3,7,$4,$5,$6,'Africa/Lagos',15,$7,clock_timestamp(),clock_timestamp(),$7,'Historical fictional settings')`,
      [settingsId, id(8), campaignId, ...times, id(5)],
    );
    const originalTiming = (
      await pool.query(
        `SELECT ${timingColumns} FROM settings_version WHERE id=$1`,
        [settingsId],
      )
    ).rows[0];
    for (const name of migrations.slice(settingsMigration))
      await pool.query(
        await readFile(new URL(`${name}/migration.sql`, directory), "utf8"),
      );
    const db = await pool.connect();
    let legacyToken: string;
    try {
      legacyToken = (await issueSession(db, config, id(2))).token;
    } finally {
      db.release();
    }
    const before = settingsSchema.parse(
      await readSettings(pool, config, legacyToken, "get"),
    );
    expect(before.version).toBe(7);
    expect(before.settingsVersionId).toBe(settingsId);
    expect(before.campaign?.settingsVersionId).toBe(settingsId);
    expect(before.retention).toMatchObject({
      days: 15,
      deletionEnabled: false,
    });
    const input = {
      days: 29,
      expectedVersion: before.version,
      reason: "Replace historical retention intent",
    };
    const review = await reviewSettings(
      pool,
      config,
      legacyToken,
      "retention",
      input,
    );
    const changed = await confirmSettings(
      pool,
      config,
      legacyToken,
      "retention",
      { ...input, reviewDigest: review.reviewDigest, operationId: newId() },
    );
    expect(changed.replayed).toBe(false);
    const after = settingsSchema.parse(
      await readSettings(pool, config, legacyToken, "get"),
    );
    expect(after.version).toBe(8);
    expect(after.campaign).toEqual(before.campaign);
    expect(
      (
        await pool.query(
          `SELECT ${timingColumns} FROM settings_version WHERE id=$1`,
          [settingsId],
        )
      ).rows[0],
    ).toEqual(originalTiming);
    expect(
      (
        await pool.query(
          `SELECT ${timingColumns} FROM settings_version WHERE id=$1`,
          [after.settingsVersionId],
        )
      ).rows[0],
    ).toEqual(originalTiming);
    expect(
      (
        await pool.query(
          "SELECT retention_approved_by,retention_approved_at FROM settings_version WHERE id=$1",
          [after.settingsVersionId],
        )
      ).rows[0],
    ).toEqual({ retention_approved_by: null, retention_approved_at: null });
  } finally {
    await pool.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  }
});
