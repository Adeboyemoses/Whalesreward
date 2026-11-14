import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  cardsFixture,
  config,
  fixtureId as id,
  historicalSale,
} from "../helpers/cards-adversarial-fixture";
import { newId } from "../../src/server/lib/ids";
import {
  readSettings,
  reviewSettings,
  confirmSettings,
} from "../../src/server/modules/settings/service";
import { settingsSchema } from "../../src/shared/contracts/settings";
import { readAudit } from "../../src/server/modules/audit/service";
import {
  auditEventSchema,
  auditPageSchema,
} from "../../src/shared/contracts/audit";
import { healthResponse } from "../../src/server/modules/health/service";
import { COOKIE } from "../../src/server/modules/admin-access/http";
import { POST as reviewRoute } from "../../src/app/api/admin/settings/giveaway/review/route";
import { POST as confirmRoute } from "../../src/app/api/admin/settings/giveaway/confirm/route";
import { timingHistoryCte } from "../../src/server/modules/settings/timing-history";
import { evaluateCapturePolicy } from "../../src/server/modules/sync/capture-policy";
import * as databaseModule from "../../src/server/lib/db";
import * as timingEvaluator from "../../src/server/modules/settings/evaluator";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
let f: Awaited<ReturnType<typeof cardsFixture>>, token: string;
let clockPool: pg.Pool | undefined;
beforeEach(async () => {
  f = await cardsFixture();
  token = await f.owner();
  vi.spyOn(databaseModule, "database").mockReturnValue(f.pool);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await clockPool?.end();
  clockPool = undefined;
  await f?.close();
});
const db = () => clockPool ?? f.pool;
const settings = async () =>
  settingsSchema.parse(await readSettings(db(), config, token, "get"));
async function input(overrides: Record<string, unknown> = {}) {
  const current = await settings();
  return {
    kind: current.campaign ? "update" : "create",
    campaignId: current.campaign?.id ?? null,
    expectedVersion: current.version,
    expectedCampaignVersion: current.campaign?.version ?? null,
    launchAt: "2035-03-01T00:00:00.123456Z",
    purchaseStart: "2035-03-02T00:00:00.123456Z",
    purchaseCutoff: "2035-03-09T01:59:59.654321Z",
    timezone: "Africa/Lagos",
    graceHours: 0,
    reason: "Set the fictional station campaign timing",
    ...overrides,
  };
}
async function reviewed(
  overrides: Record<string, unknown> = {},
  actor = token,
) {
  const proposal = await input(overrides);
  const review = await reviewSettings(
    db(),
    config,
    actor,
    "giveaway",
    proposal,
  );
  return {
    proposal,
    review,
    confirmation: {
      ...proposal,
      operationId: newId(),
      reviewDigest: review.reviewDigest,
    },
  };
}
async function create(overrides: Record<string, unknown> = {}) {
  const p = await reviewed(overrides);
  const result = await confirmSettings(
    db(),
    config,
    token,
    "giveaway",
    p.confirmation,
  );
  if (result.data.section !== "giveaway")
    throw new Error("Expected giveaway receipt");
  return { ...p, result: { ...result, data: result.data } };
}
async function retain(days: number) {
  const before = await settings();
  const proposal = {
    days,
    expectedVersion: before.version,
    reason: "Record fictional retention intent",
  };
  const review = await reviewSettings(
    db(),
    config,
    token,
    "retention",
    proposal,
  );
  return confirmSettings(db(), config, token, "retention", {
    ...proposal,
    operationId: newId(),
    reviewDigest: review.reviewDigest,
  });
}
async function rows() {
  const result: Record<string, unknown> = {};
  for (const table of [
    "campaign",
    "settings_version",
    "settings_change",
    "audit_event",
    "mutation_receipt",
    "station_reporting_state",
  ])
    result[table] = (
      await f.pool.query(
        `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
  return result;
}
async function freeze(at: string) {
  if (!clockPool) {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set(
      "options",
      `-c search_path=${f.schema},pg_catalog,public`,
    );
    clockPool = new pg.Pool({ connectionString: url.toString(), max: 8 });
  }
  await f.pool.query("ALTER TABLE auth_session DISABLE TRIGGER USER");
  try {
    await f.pool.query(
      "UPDATE auth_session SET expires_at=$1::timestamptz+interval '1 day',last_activity_at=$1",
      [at],
    );
  } finally {
    await f.pool.query("ALTER TABLE auth_session ENABLE TRIGGER USER");
  }
  await f.pool.query(
    `CREATE OR REPLACE FUNCTION clock_timestamp() RETURNS timestamptz LANGUAGE sql AS $clock$ SELECT '${at}'::timestamptz $clock$`,
  );
}
async function snapshot() {
  const current = await settings();
  await f.pool.query(
    "INSERT INTO giveaway_snapshot(id,campaign_id,settings_version_id,snapshot_number,operation_id,actor_id,reason,tie_rule,finalized_at) VALUES($1,$2,$3,1,$4,$5,'Fictional immutable snapshot','competition_v1',clock_timestamp())",
    [
      newId(),
      current.campaign!.id,
      current.campaign!.settingsVersionId,
      newId(),
      id(5),
    ],
  );
}
async function http(route: typeof reviewRoute, body: unknown, actor = token) {
  const response = await route(
    new Request(`${config.origin}/api/admin/settings/giveaway/review`, {
      method: "POST",
      headers: {
        cookie: `${COOKIE}=${actor}`,
        origin: config.origin,
        "content-type": "application/json",
        "x-test-ip": randomBytes(8).toString("hex"),
      },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
}

describe("P-28 Owner campaign setup acceptance", () => {
  it("I-45 empty creation is side-effect-free at review and commits one campaign with logical version two and before=null", async () => {
    const before = await rows();
    const p = await reviewed();
    expect(await rows()).toEqual(before);
    expect(p.review.after.campaign).toMatchObject({
      id: null,
      version: 1,
      latestSnapshotId: null,
      reconciliationRequired: true,
      reconciledDataVersion: null,
    });
    expect(p.review.after.campaign?.timing).toMatchObject({
      policyVersion: "campaign-timing-v1",
      graceHours: 0,
      uploadDeadline: p.proposal.purchaseCutoff,
    });
    const saved = await confirmSettings(
      db(),
      config,
      token,
      "giveaway",
      p.confirmation,
    );
    expect(saved.replayed).toBe(false);
    expect(saved.data).toMatchObject({
      section: "giveaway",
      kind: "create",
      version: 2,
      previousVersionId: null,
      before: null,
    });
    const current = await settings();
    if (saved.data.section !== "giveaway")
      throw new Error("Expected giveaway receipt");
    expect(current.campaign?.id).toBe(saved.data.campaignId);
    expect(current.campaign?.version).toBe(1);
    expect(current.campaign?.settingsVersionId).toBe(current.settingsVersionId);
    expect(current.station.timezone).toBe("Africa/Lagos");
    const history = await readSettings(db(), config, token, "history", {
      section: "giveaway",
    });
    expect(history).toMatchObject({ items: [saved.data], nextCursor: null });
  });

  it("I-45 retention-first creation preserves intent and old campaign=null snapshots and retention never moves the timing pin", async () => {
    await retain(41);
    await retain(42);
    const retained = await settings();
    const old = (
      await f.pool.query(
        "SELECT id,full_snapshot FROM settings_version ORDER BY version",
      )
    ).rows;
    const saved = await create();
    const created = await settings();
    expect(created.version).toBe(retained.version + 1);
    expect(created.retention).toEqual(retained.retention);
    expect(saved.result.data.previousVersionId).toBe(
      retained.settingsVersionId,
    );
    await retain(43);
    expect((await settings()).campaign).toEqual(created.campaign);
    for (const row of old)
      expect(
        (
          await f.pool.query(
            "SELECT full_snapshot FROM settings_version WHERE id=$1",
            [row.id],
          )
        ).rows[0].full_snapshot,
      ).toEqual(row.full_snapshot);
    expect((await settings()).campaign?.timing).toEqual(
      created.campaign?.timing,
    );
  });

  it("I-07 settings-only non-Owner is denied on review, confirmation and historical replay despite all action grants", async () => {
    const actor = await f.actor([
      "settings",
      "sales",
      "leaderboards",
      "giveawayFinalize",
      "giveawayRevise",
    ]);
    const p = await reviewed();
    for (const [route, body] of [
      [reviewRoute, p.proposal],
      [confirmRoute, p.confirmation],
    ] as const) {
      const denied = await http(route, body, actor.token);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe("owner_required");
    }
    await f.pool.query(
      "UPDATE admin SET role_id=$2,version=version+1 WHERE id=$1",
      [actor.adminId, id(1)],
    );
    const own = await reviewed({}, actor.token);
    await confirmSettings(
      db(),
      config,
      actor.token,
      "giveaway",
      own.confirmation,
    );
    await f.pool.query(
      "UPDATE admin SET role_id=$2,version=version+1 WHERE id=$1",
      [actor.adminId, actor.roleId],
    );
    await expect(
      confirmSettings(db(), config, actor.token, "giveaway", own.confirmation),
    ).rejects.toMatchObject({ code: "owner_required", status: 403 });
  });

  it("I-09 Owner demotion, settings removal, disable and session revocation between review and confirm cannot authorize a write", async () => {
    for (const revoke of ["demotion", "permission", "disable", "session"]) {
      const actor = await f.actor(["settings"]);
      const ownerRole = newId();
      await f.pool.query(
        "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,true,true,1)",
        [ownerRole, `Fictional Owner ${ownerRole}`],
      );
      await f.pool.query(
        "INSERT INTO role_permission(role_id,permission_code) VALUES($1,'settings')",
        [ownerRole],
      );
      await f.pool.query(
        "UPDATE admin SET role_id=$2,version=version+1 WHERE id=$1",
        [actor.adminId, ownerRole],
      );
      const p = await reviewed({}, actor.token),
        before = await rows();
      if (revoke === "demotion")
        await f.pool.query(
          "UPDATE admin SET role_id=$2,version=version+1 WHERE id=$1",
          [actor.adminId, actor.roleId],
        );
      if (revoke === "permission")
        await f.pool.query(
          "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='settings'",
          [ownerRole],
        );
      if (revoke === "disable")
        await f.pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
          actor.userId,
        ]);
      if (revoke === "session")
        await f.pool.query(
          "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE user_id=$1",
          [actor.userId],
        );
      await expect(
        confirmSettings(db(), config, actor.token, "giveaway", p.confirmation),
      ).rejects.toThrow();
      expect(await rows()).toEqual(before);
    }
  });

  it("I-22 different create keys racing produce exactly one campaign, settings version, audit and receipt", async () => {
    const p = await reviewed();
    const attempts = await Promise.allSettled([
      confirmSettings(db(), config, token, "giveaway", p.confirmation),
      confirmSettings(db(), config, token, "giveaway", {
        ...p.confirmation,
        operationId: newId(),
      }),
    ]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "campaign_exists", status: 409 },
    });
    for (const table of [
      "campaign",
      "settings_version",
      "settings_change",
      "audit_event",
      "mutation_receipt",
    ])
      expect(
        (await f.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]
          .n,
      ).toBe(1);
  });

  it("I-22 identical lost-response create replay after start and snapshot returns exact receipt; changed content or kind conflicts", async () => {
    const p = await create();
    await snapshot();
    await freeze("2035-03-03T00:00:00Z");
    const before = await rows();
    expect(
      await confirmSettings(db(), config, token, "giveaway", p.confirmation),
    ).toEqual({ ...p.result, replayed: true });
    for (const changed of [
      { reason: "A different fictional reason" },
      {
        kind: "update",
        campaignId: p.result.data.campaignId,
        expectedCampaignVersion: 1,
      },
    ])
      await expect(
        confirmSettings(db(), config, token, "giveaway", {
          ...p.confirmation,
          ...changed,
        }),
      ).rejects.toMatchObject({ code: "operation_conflict" });
    expect(await rows()).toEqual(before);
  });

  it("I-45 updating all five inputs preserves old values and advances campaign and generation once", async () => {
    await create();
    const before = await settings();
    const state = (
      await f.pool.query("SELECT data_version FROM station_reporting_state")
    ).rows[0];
    const old = (
      await f.pool.query(
        "SELECT full_snapshot FROM settings_version WHERE id=$1",
        [before.settingsVersionId],
      )
    ).rows[0];
    const p = await create({
      launchAt: "2036-01-01T00:00:00Z",
      purchaseStart: "2036-02-01T00:00:00Z",
      purchaseCutoff: "2036-03-08T06:59:59Z",
      timezone: "America/New_York",
      graceHours: 24,
    });
    const after = await settings();
    expect(p.result.data).toMatchObject({
      kind: "update",
      campaignId: before.campaign!.id,
      before: before.campaign!.timing,
    });
    expect(after.campaign!.version).toBe(before.campaign!.version + 1);
    expect(BigInt(after.campaign!.dataVersion)).toBe(
      BigInt(state.data_version) + 1n,
    );
    expect(after.campaign!.timing.uploadDeadline).toBe(
      "2036-03-09T06:59:59.000000Z",
    );
    expect(after.station.timezone).toBe(before.station.timezone);
    expect(
      (
        await f.pool.query(
          "SELECT full_snapshot FROM settings_version WHERE id=$1",
          [before.settingsVersionId],
        )
      ).rows[0],
    ).toEqual(old);
    expect(
      (
        await f.pool.query(
          "SELECT launch_at::text FROM station_reporting_state",
        )
      ).rows[0].launch_at,
    ).toContain("2036-01-01");
  });

  it("I-45 a new reason with identical five timing inputs is no_change without effects", async () => {
    await create();
    const before = await rows();
    await expect(
      reviewed({ reason: "Only the reason changed" }),
    ).rejects.toMatchObject({ code: "no_change", status: 409 });
    expect(await rows()).toEqual(before);
  });

  it("I-45 exact proposed-start equality locks review and confirmation with a fresh database clock", async () => {
    const p = await reviewed();
    await freeze(p.proposal.purchaseStart);
    for (const action of [
      () => reviewSettings(db(), config, token, "giveaway", p.proposal),
      () => confirmSettings(db(), config, token, "giveaway", p.confirmation),
    ])
      await expect(action()).rejects.toMatchObject({
        code: "timing_locked",
        status: 409,
      });
    expect((await settings()).campaign).toBeNull();
  });

  it("I-45 exact persisted-start equality cannot be unlocked by proposing a future replacement start", async () => {
    await create();
    await freeze("2035-03-02T00:00:00.123456Z");
    expect((await settings()).timingLocked).toBe(true);
    await expect(
      reviewed({ purchaseStart: "2035-03-03T00:00:00Z" }),
    ).rejects.toMatchObject({ code: "timing_locked" });
  });

  it("I-45 a confirmation waiting across purchaseStart fails at its post-lock clock check", async () => {
    await freeze("2035-03-01T12:00:00Z");
    const p = await reviewed();
    const blocker = await f.pool.connect();
    let pending: ReturnType<typeof confirmSettings> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM security_state WHERE id=true FOR UPDATE",
      );
      pending = confirmSettings(
        db(),
        config,
        token,
        "giveaway",
        p.confirmation,
      );
      const settled = pending.then(
        () => null,
        (e) => e,
      );
      await f.waitForLock("security_state");
      await freeze(p.proposal.purchaseStart);
      await blocker.query("COMMIT");
      expect(await settled).toMatchObject({
        code: "timing_locked",
        status: 409,
      });
      expect((await settings()).campaign).toBeNull();
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await pending?.catch(() => {});
    }
  });

  it("I-45 launch before now does not lock timing while purchaseStart remains future", async () => {
    await freeze("2035-03-01T12:00:00Z");
    await create();
    expect((await settings()).timingLocked).toBe(false);
    await create({ graceHours: 1 });
    expect((await settings()).campaign!.timing.graceHours).toBe(1);
  });

  it("I-46 any saved snapshot locks timing even when latestSnapshotId is null and start is future", async () => {
    await create();
    await snapshot();
    expect(
      (await f.pool.query("SELECT latest_snapshot_id FROM campaign")).rows[0]
        .latest_snapshot_id,
    ).toBeNull();
    expect((await settings()).timingLocked).toBe(true);
    await expect(reviewed({ graceHours: 1 })).rejects.toMatchObject({
      code: "timing_locked",
    });
  });

  it.each([0.5, -1, Number.MAX_SAFE_INTEGER, 2147483648])(
    "I-45 fractional, negative or overflowing grace %s is timing_invalid with no effects",
    async (graceHours) => {
      const p = await input({ graceHours }),
        before = await rows();
      const response = await http(reviewRoute, p);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("timing_invalid");
      expect(await rows()).toEqual(before);
    },
  );

  it("I-45 unsupported timezone and invalid ordering fail timing_invalid while malformed or extra fields fail invalid_request", async () => {
    for (const changed of [
      { timezone: "Mars/Olympus" },
      { launchAt: "2035-03-03T00:00:00Z" },
      { purchaseStart: "2035-03-09T01:59:59.654321Z" },
    ]) {
      const response = await http(reviewRoute, await input(changed));
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("timing_invalid");
    }
    for (const changed of [
      { purchaseStart: null },
      { purchaseStart: "not-a-date" },
      { campaignId: newId() },
      { expectedCampaignVersion: 1 },
      { stationId: id(8) },
      { policyVersion: "campaign-timing-v1" },
      { campaignName: "Client supplied" },
      { uploadDeadline: "2036-01-01T00:00:00Z" },
    ]) {
      const response = await http(reviewRoute, await input(changed));
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("invalid_request");
    }
  });

  it("I-45 retention racing a reviewed campaign proposal requires a new explicit review and never silently substitutes guards", async () => {
    const p = await reviewed();
    await retain(27);
    const before = await rows();
    await expect(
      confirmSettings(db(), config, token, "giveaway", p.confirmation),
    ).rejects.toMatchObject({ code: "version_conflict" });
    expect(await rows()).toEqual(before);
    const fresh = await create();
    expect(fresh.result.data.version).toBe(3);
    expect((await settings()).retention.days).toBe(27);
  });

  it("I-45 generation changes make an otherwise guard-matching comparison review_stale", async () => {
    const p = await reviewed();
    await f.pool.query(
      "INSERT INTO station_reporting_state(station_id) VALUES($1) ON CONFLICT DO NOTHING",
      [id(8)],
    );
    await f.pool.query(
      "UPDATE station_reporting_state SET data_version=data_version+1 WHERE station_id=$1",
      [id(8)],
    );
    await expect(
      confirmSettings(db(), config, token, "giveaway", p.confirmation),
    ).rejects.toMatchObject({ code: "review_stale" });
    expect((await settings()).campaign).toBeNull();
  });

  it("I-41 a receipt failure rolls back campaign, timing, history, audit, pointers and generation", async () => {
    const p = await reviewed(),
      before = await rows();
    await f.pool.query(
      "CREATE FUNCTION p28_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fictional receipt failure'; END $$",
    );
    await f.pool.query(
      "CREATE TRIGGER p28_fail_receipt BEFORE INSERT ON mutation_receipt FOR EACH ROW EXECUTE FUNCTION p28_fail_receipt()",
    );
    try {
      await expect(
        confirmSettings(db(), config, token, "giveaway", p.confirmation),
      ).rejects.toThrow();
      expect(await rows()).toEqual(before);
    } finally {
      await f.pool.query("DROP TRIGGER p28_fail_receipt ON mutation_receipt");
      await f.pool.query("DROP FUNCTION p28_fail_receipt()");
    }
    expect(
      (await confirmSettings(db(), config, token, "giveaway", p.confirmation))
        .replayed,
    ).toBe(false);
  });

  it("I-41 create and update audit search/detail expose exactly the required immutable fields and history references one event", async () => {
    const created = await create(),
      before = await settings(),
      updated = await create({ graceHours: 1 });
    for (const [saved, action, target] of [
      [created, "campaign_created", "campaign"],
      [updated, "giveaway_timing_changed", "settings"],
    ] as const) {
      const event = auditEventSchema.parse(
        await readAudit(
          db(),
          config,
          token,
          "detail",
          {},
          saved.result.data.auditEventId,
        ),
      );
      expect(event).toMatchObject({
        schemaVersion: 2,
        area: "settings",
        action,
        target: { kind: target, subjectAtEvent: null },
        operationId: saved.confirmation.operationId,
        reason: saved.proposal.reason,
      });
      expect(event.changes.map((c) => c.field).sort()).toEqual(
        [
          "campaignId",
          "settingsVersionId",
          "settingsVersion",
          "campaignVersion",
          "launchAt",
          "purchaseStart",
          "purchaseCutoff",
          "graceHours",
          "uploadDeadline",
          "timezone",
          "timingPolicyVersion",
        ].sort(),
      );
      expect(event.changes.find((c) => c.field === "campaignId")).toMatchObject(
        {
          before: action === "campaign_created" ? null : before.campaign!.id,
          after: before.campaign!.id,
        },
      );
      const page = auditPageSchema.parse(
        await readAudit(db(), config, token, "search", { area: "settings" }),
      );
      expect(page.items.find((e) => e.id === event.id)).toEqual(event);
    }
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM audit_event WHERE action='campaign_created'",
        )
      ).rows[0].n,
    ).toBe(1);
    const nonAudit = await f.actor(["settings"]);
    await expect(
      readAudit(
        db(),
        config,
        nonAudit.token,
        "detail",
        {},
        created.result.data.auditEventId,
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("I-51 timing changes leave accepted amounts, original capture facts, held sales and evidence unchanged", async () => {
    await historicalSale(f.pool, { state: "held" });
    const tables = [
      "purchase",
      "purchase_revision",
      "purchase_hold",
      "photo_asset",
      "sync_validation",
    ];
    const facts = async () =>
      Promise.all(
        tables.map(
          async (table) =>
            (
              await f.pool.query(
                `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
              )
            ).rows,
        ),
      );
    const before = await facts();
    await create();
    await create({ graceHours: 1 });
    expect(await facts()).toEqual(before);
  });

  it("I-45 explicitly unconfigured legacy start can be completed without approving the incomplete historical version", async () => {
    const campaignId = newId(),
      versionId = newId();
    await f.pool.query(
      "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional legacy campaign',1,true)",
      [campaignId, id(8)],
    );
    await f.pool.query(
      "INSERT INTO settings_version(id,station_id,campaign_id,version,timezone,effective_from,actor_id,reason) VALUES($1,$2,$3,1,'Africa/Lagos',clock_timestamp(),$4,'Explicit unconfigured historical timing')",
      [versionId, id(8), campaignId, id(5)],
    );
    await f.pool.query(
      "INSERT INTO station_reporting_state(station_id,settings_version,current_settings_version_id) VALUES($1,1,$2) ON CONFLICT(station_id) DO UPDATE SET settings_version=1,current_settings_version_id=$2",
      [id(8), versionId],
    );
    await f.pool.query(
      "UPDATE campaign SET current_timing_version_id=$2,version=version+1 WHERE id=$1",
      [campaignId, versionId],
    );
    expect((await settings()).timingLocked).toBe(false);
    await create();
    expect((await settings()).campaign?.timing.policyVersion).toBe(
      "campaign-timing-v1",
    );
    expect(
      (
        await f.pool.query(
          "SELECT purchase_start,timing_policy_version FROM settings_version WHERE id=$1",
          [versionId],
        )
      ).rows[0],
    ).toEqual({ purchase_start: null, timing_policy_version: null });
  });

  it("I-45 a corrupt missing timing pointer is not evidence of an explicitly unconfigured legacy start", async () => {
    await create();
    await f.pool.query(
      "UPDATE campaign SET current_timing_version_id=NULL,version=version+1",
    );
    await expect(reviewed({ graceHours: 1 })).rejects.toThrow();
  });

  it("I-45 timing lineage accepts first giveaway version two and retention gaps but rejects a genuine missing station version", async () => {
    await create();
    await retain(30);
    await create({ graceHours: 1 });
    const lineage = (
      await f.pool.query(
        `${timingHistoryCte} SELECT version,timing_history_version,timing_history_complete FROM timing_history ORDER BY version`,
        [id(8)],
      )
    ).rows;
    expect(lineage).toEqual([
      { version: 2, timing_history_version: 1, timing_history_complete: true },
      { version: 4, timing_history_version: 2, timing_history_complete: true },
    ]);
    await f.pool.query("ALTER TABLE settings_version DISABLE TRIGGER USER");
    try {
      await f.pool.query(
        "UPDATE settings_version SET version=5 WHERE version=4",
      );
    } finally {
      await f.pool.query("ALTER TABLE settings_version ENABLE TRIGGER USER");
    }
    expect(
      (
        await f.pool.query(
          `${timingHistoryCte} SELECT timing_history_complete FROM timing_history`,
          [id(8)],
        )
      ).rows.every((r) => r.timing_history_complete === false),
    ).toBe(true);
  });

  it("I-45a exact inclusive launch, start, cutoff and durable receipt deadline use microseconds with zero grace", async () => {
    const saved = await create();
    const timing = (
      await f.pool.query(
        "SELECT (extract(epoch FROM launch_at)*1000000)::bigint::text AS launch,(extract(epoch FROM purchase_start)*1000000)::bigint::text AS start,(extract(epoch FROM purchase_cutoff)*1000000)::bigint::text AS cutoff,(extract(epoch FROM upload_deadline)*1000000)::bigint::text AS deadline FROM settings_version WHERE id=$1",
        [(await settings()).settingsVersionId],
      )
    ).rows[0];
    const evaluate = (capture: string, receipt: string) =>
      evaluateCapturePolicy({
        signedInAt: capture,
        receivedAt: receipt,
        offlineExpiresAt: capture,
        contextRevokedAt: null,
        assignment: { effectiveFrom: "0", effectiveUntil: null },
        rateKobo: "100000",
        currency: "NGN",
        prices: [{ effectiveFrom: "0", rateKobo: "100000", currency: "NGN" }],
        settings: [
          {
            effectiveFrom: "0",
            campaignId: saved.result.data.campaignId,
            launchAt: timing.launch,
            purchaseStart: timing.start,
            purchaseCutoff: timing.cutoff,
            uploadDeadline: timing.deadline,
          },
        ],
      });
    expect(evaluate(timing.start, timing.start).campaignEligible).toBe(true);
    expect(evaluate(timing.cutoff, timing.deadline).campaignEligible).toBe(
      true,
    );
    expect(
      evaluate((BigInt(timing.start) - 1n).toString(), timing.start)
        .campaignEligible,
    ).toBe(false);
    expect(
      evaluate(
        (BigInt(timing.cutoff) + 1n).toString(),
        (BigInt(timing.deadline) + 1n).toString(),
      ).campaignEligible,
    ).toBe(false);
    expect(
      evaluate(timing.cutoff, (BigInt(timing.deadline) + 1n).toString())
        .campaignEligible,
    ).toBe(false);
    expect(timing.deadline).toBe(timing.cutoff);
  });
});

describe("P-28 recorded policy and health acceptance", () => {
  async function health(actor = token) {
    const response = await healthResponse(
      new Request(`${config.origin}/api/health`, {
        headers: { cookie: `${COOKIE}=${actor}` },
      }),
      {
        pool: f.pool,
        probe: async () => {
          await f.pool.query("SELECT 1");
        },
      },
    );
    return { response, body: await response.json() };
  }
  async function alterPolicy(sql: string) {
    await f.pool.query(
      "ALTER TABLE timing_policy_definition DISABLE TRIGGER USER",
    );
    await f.pool.query(
      "ALTER TABLE station_timing_policy DISABLE TRIGGER USER",
    );
    try {
      await f.pool.query(sql);
    } finally {
      await f.pool.query(
        "ALTER TABLE timing_policy_definition ENABLE TRIGGER USER",
      );
      await f.pool.query(
        "ALTER TABLE station_timing_policy ENABLE TRIGGER USER",
      );
    }
  }

  it("I-45 recorded policy with no campaign configures protected timing health without seeding inputs or exposing policy metadata", async () => {
    const before = await rows(),
      result = await health();
    expect(result.response.status).toBe(200);
    expect(result.body.policies.timing).toBe("configured");
    expect(result.body.policies.reconciliation).toBe("unconfigured");
    expect(Object.keys(result.body.policies)).toHaveLength(12);
    expect((await settings()).campaign).toBeNull();
    expect((await settings()).timingPolicyVersion).toBe("campaign-timing-v1");
    const publicResult = await health((await f.actor(["audit"])).token);
    expect(publicResult.body).not.toHaveProperty("policies");
    for (const text of [
      "campaign-timing-v1",
      "WHR-138",
      "semantics_digest",
      "approval_reference",
    ])
      expect(JSON.stringify(result.body)).not.toContain(text);
    expect(result.response.headers.get("cache-control")).toBe("no-store");
    expect(result.response.headers.get("vary")).toBe("Cookie");
    expect(await rows()).toEqual(before);
  });

  it("I-45 absent policy binding fails closed in health and timing review without creating configuration", async () => {
    await alterPolicy("DELETE FROM station_timing_policy");
    const before = await rows();
    expect((await health()).body.policies.timing).toBe("unconfigured");
    await expect(reviewed()).rejects.toMatchObject({
      code: "timing_policy_unconfigured",
      status: 409,
    });
    expect((await settings()).timingPolicyVersion).toBeNull();
    expect(await rows()).toEqual(before);
  });

  it("I-45 a recorded definition and binding without the matching installed evaluator remain unconfigured", async () => {
    vi.spyOn(timingEvaluator, "timingEvaluatorInstalled").mockReturnValue(
      false,
    );
    expect((await health()).body.policies.timing).toBe("unconfigured");
    await expect(reviewed()).rejects.toMatchObject({
      code: "timing_policy_unconfigured",
    });
    expect((await settings()).campaign).toBeNull();
  });

  it("I-45 changed recorded semantics never inherits approval from a matching policy version or stale review", async () => {
    const p = await reviewed();
    await alterPolicy(
      "UPDATE timing_policy_definition SET semantics_digest=repeat('0',64)",
    );
    expect((await health()).body.policies.timing).toBe("unconfigured");
    await expect(
      confirmSettings(db(), config, token, "giveaway", p.confirmation),
    ).rejects.toMatchObject({
      code: "timing_policy_unconfigured",
      status: 409,
    });
    expect((await settings()).campaign).toBeNull();
  });

  it("I-45 changed material digest with matching explicit guards returns review_stale", async () => {
    const p = await reviewed();
    await expect(
      confirmSettings(db(), config, token, "giveaway", {
        ...p.confirmation,
        reviewDigest: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "review_stale" });
    expect((await settings()).campaign).toBeNull();
  });

  it("I-07 policy storage failure preserves 503 semantics and public health redaction", async () => {
    await f.pool.query(
      "ALTER TABLE timing_policy_definition RENAME TO p28_unavailable_definition",
    );
    try {
      const result = await health();
      expect(result.response.status).toBe(503);
      expect(result.body.db).toBe("unavailable");
      const publicResult = await health("invalid");
      expect(publicResult.response.status).toBe(503);
      expect(publicResult.body).not.toHaveProperty("policies");
      expect(JSON.stringify(result.body)).not.toContain(
        "p28_unavailable_definition",
      );
    } finally {
      await f.pool.query(
        "ALTER TABLE p28_unavailable_definition RENAME TO timing_policy_definition",
      );
    }
  });

  it("I-41 non-superuser cannot mutate or truncate timing definitions and station bindings even with table privileges", async () => {
    const role = `p28_role_${randomBytes(6).toString("hex")}`,
      client = await f.pool.connect();
    await f.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER`);
    try {
      await f.pool.query(`GRANT USAGE ON SCHEMA ${f.schema} TO ${role}`);
      await f.pool.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON timing_policy_definition,station_timing_policy TO ${role}`,
      );
      await client.query(`SET ROLE ${role}`);
      expect(
        (
          await client.query(
            "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
          )
        ).rows[0].rolsuper,
      ).toBe(false);
      for (const statement of [
        "UPDATE timing_policy_definition SET approval_reference='Fictional overwrite'",
        "DELETE FROM timing_policy_definition",
        "TRUNCATE timing_policy_definition CASCADE",
        "UPDATE station_timing_policy SET recorded_at=clock_timestamp()",
        "DELETE FROM station_timing_policy",
        "TRUNCATE station_timing_policy",
      ])
        await expect(client.query(statement)).rejects.toThrow();
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM timing_policy_definition",
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM station_timing_policy",
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await client.query("RESET ROLE");
      client.release();
      await f.pool.query(`DROP OWNED BY ${role}`);
      await f.pool.query(`DROP ROLE ${role}`);
    }
  });

  it("I-45 fresh migration before station bootstrap and repeated bootstrap preserve one original binding with no campaign", async () => {
    const original = (
      await f.pool.query(
        "SELECT * FROM station_timing_policy WHERE station_id=$1",
        [id(8)],
      )
    ).rows;
    await f.pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    await f.pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(
      (
        await f.pool.query(
          "SELECT * FROM station_timing_policy WHERE station_id=$1",
          [id(8)],
        )
      ).rows,
    ).toEqual(original);
    expect(original).toHaveLength(1);
    expect(
      (await f.pool.query("SELECT count(*)::int AS n FROM campaign")).rows[0].n,
    ).toBe(0);
    expect(
      (await f.pool.query("SELECT count(*)::int AS n FROM settings_version"))
        .rows[0].n,
    ).toBe(0);
  });
});

it("I-45 existing-station upgrade binds the registered policy without inventing any campaign values", async () => {
  const root = new pg.Pool({ connectionString: process.env.DATABASE_URL }),
    schema = `p28_upgrade_${randomBytes(6).toString("hex")}`;
  await root.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  const pool = new pg.Pool({ connectionString: url.toString() });
  try {
    const directory = new URL("../../prisma/migrations/", import.meta.url),
      migrations = (await readdir(directory))
        .filter((name) => /^\d/.test(name))
        .sort();
    const index = migrations.findIndex((name) =>
      name.endsWith("_campaign_timing"),
    );
    expect(index).toBeGreaterThan(0);
    for (const name of migrations.slice(0, index))
      await pool.query(
        await readFile(new URL(`${name}/migration.sql`, directory), "utf8"),
      );
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const name of migrations.slice(index))
      await pool.query(
        await readFile(new URL(`${name}/migration.sql`, directory), "utf8"),
      );
    expect(
      (
        await pool.query(
          "SELECT policy_version FROM station_timing_policy WHERE station_id=$1",
          [id(8)],
        )
      ).rows,
    ).toEqual([{ policy_version: "campaign-timing-v1" }]);
    for (const table of ["campaign", "settings_version", "settings_change"])
      expect(
        (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,
      ).toBe(0);
  } finally {
    await pool.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  }
});
