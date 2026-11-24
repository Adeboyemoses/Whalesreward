import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { z } from "zod";
import { parseArguments, operate } from "../../scripts/ops/person.mjs";
import {
  operate as operateRelease,
  parseArguments as releaseArguments,
  releaseV2Digest,
} from "../../scripts/ops/review-evidence.mjs";
import { newId } from "../../src/server/lib/ids";
import { issueSession } from "../../src/server/modules/admin-access/sessions";
import { createPhoneService } from "../../src/server/modules/giveaway/phones";
import { phoneAudit } from "../../src/server/modules/giveaway/phone-audit";
import {
  campaignData,
  campaignView,
} from "../../src/server/modules/giveaway/data";
import { assertReleaseV2Installation } from "../../src/server/modules/reviews/release-v2";
import {
  readCampaign,
  readReadiness,
  prepareGiveaway,
  confirmGiveaway,
} from "../../src/server/modules/giveaway/service";
import { readProjection } from "../../src/server/modules/giveaway/projections";
import {
  fixtureId,
  historicalSale,
} from "../helpers/cards-adversarial-fixture";

async function waitForBlocked(pool: pg.Pool, fragment: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const found = await pool.query(
      "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND wait_event_type='Lock' AND position($1 in query)>0",
      [fragment],
    );
    if (found.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Competing transaction did not reach expected ${fragment} lock`,
  );
}

/** Only account/domain fixtures use SQL. Every canonical person and binding is
 * written by the same operator boundary used outside tests, as a non-superuser. */
async function provisionedFixture() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const suffix = randomBytes(8).toString("hex");
  const databaseName = `provisioned_runtime_${suffix}`;
  const ownerName = `provisioned_owner_${suffix}`;
  const databaseId = pg.escapeIdentifier(databaseName);
  const ownerId = pg.escapeIdentifier(ownerName);
  await root.query(
    `CREATE ROLE ${ownerId} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'fictional-provisioning-test'`,
  );
  await root.query(`CREATE DATABASE ${databaseId} OWNER ${ownerId}`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${databaseName}`;
  url.username = ownerName;
  url.password = "fictional-provisioning-test";
  url.search = "";
  const pool = new pg.Pool({ connectionString: url.toString(), max: 12 });
  await pool.query(
    `COMMENT ON DATABASE ${databaseId} IS 'whr.environment=test'`,
  );
  const migrations = new URL("../../prisma/migrations/", import.meta.url);
  for (const entry of (await readdir(migrations, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name)))
    await pool.query(
      await readFile(
        new URL(`${entry.name}/migration.sql`, migrations),
        "utf8",
      ),
    );
  await pool.query(
    await readFile(
      new URL("../../prisma/fixtures.sql", import.meta.url),
      "utf8",
    ),
  );
  await pool.query("UPDATE auth_user SET must_change_password=false");
  const config = {
    secret: randomBytes(32).toString("hex"),
    origin: "http://127.0.0.1",
  };
  const stationId = fixtureId(8);
  async function token(userId: string) {
    const db = await pool.connect();
    try {
      return (await issueSession(db, config, userId)).token;
    } finally {
      db.release();
    }
  }
  async function actor() {
    const userId = newId(),
      adminId = newId();
    // Fictional aliases share the seeded Owner role so permissions remain real.
    await pool.query(
      "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Fictional operator account',true,1,false,now())",
      [userId, `fictional.${userId}`],
    );
    await pool.query(
      "INSERT INTO admin(id,user_id,admin_code,role_id,version) SELECT $1,$2,$3,role_id,1 FROM admin WHERE id=$4",
      [adminId, userId, `TEST-${adminId}`, fixtureId(5)],
    );
    return { userId, adminId, token: await token(userId) };
  }
  const owner = {
    userId: fixtureId(2),
    adminId: fixtureId(5),
    token: await token(fixtureId(2)),
  };
  const independent = await actor(),
    alias = await actor();
  const people = {
    owner: newId(),
    independent: newId(),
    attendantA: newId(),
    attendantB: newId(),
  };
  const scope = ["--station", stationId, "--environment", "test"];
  async function op(
    action: string,
    flags: string[],
    reason = "initial_provisioning",
  ) {
    const args = [
      action,
      ...scope,
      ...flags,
      "--authorization",
      "FICTIONAL-RUNTIME-AUTH",
      "--reason-code",
      reason,
    ];
    const preview = await operate(pool, parseArguments(args));
    if (preview.result === "no_change") return preview;
    return operate(
      pool,
      parseArguments([
        ...args,
        "--apply",
        "--expected-revision",
        String(preview.revision),
      ]),
    );
  }
  async function link(
    userId: string,
    personId: string,
    create = true,
    verify = true,
  ) {
    if (create) await op("create", ["--person", personId]);
    await op("bind", [
      "--user",
      userId,
      "--person",
      personId,
      "--expected-binding-version",
      "0",
    ]);
    if (verify)
      await op(
        "verify",
        [
          "--user",
          userId,
          "--person",
          personId,
          "--expected-binding-version",
          "1",
          "--verification-reference",
          "FICTIONAL-RUNTIME-VERIFICATION",
        ],
        "verification_completed",
      );
  }
  async function provision(includeAttendants = true) {
    await link(owner.userId, people.owner);
    await link(independent.userId, people.independent);
    await link(alias.userId, people.owner, false);
    if (includeAttendants) {
      await link(fixtureId(3), people.attendantA);
      await link(fixtureId(4), people.attendantB);
    }
  }
  const campaignId = newId(),
    settingsId = newId();
  await pool.query(
    "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional provisioned campaign',1,true)",
    [campaignId, stationId],
  );
  await pool.query(
    "INSERT INTO settings_version(id,station_id,campaign_id,version,section,launch_at,purchase_start,purchase_cutoff,grace_hours,upload_deadline,timezone,effective_from,actor_id,reason,timing_policy_version) VALUES($1,$2,$3,1,'giveaway',statement_timestamp()-interval '3 days',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day',0,statement_timestamp()-interval '1 day','Africa/Lagos',statement_timestamp()-interval '4 days',$4,'Fictional completed campaign','campaign-timing-v1')",
    [settingsId, stationId, campaignId, owner.adminId],
  );
  await pool.query(
    "UPDATE campaign SET current_timing_version_id=$2,version=version+1 WHERE id=$1",
    [campaignId, settingsId],
  );
  const phones = createPhoneService(pool, config, phoneAudit, async (db, id) =>
    campaignView((await campaignData(db, stationId, id))!),
  );
  async function guard() {
    const c = (await readCampaign(pool, owner.token)).campaign!;
    return {
      expectedVersion: c.version,
      expectedSettingsVersionId: c.settingsVersionId,
      expectedDataVersion: c.dataVersion,
      expectedPreviousSnapshotId: c.latestSnapshotId,
    };
  }
  async function designate(adminId = owner.adminId) {
    return phones.designate(owner.token, campaignId, {
      operationId: newId(),
      expectedVersion: (await guard()).expectedVersion,
      managerAdminId: adminId,
      reason: "Fictional designated manager",
    });
  }
  async function censusAndCheck(
    kind: "initial" | "revision" = "initial",
    actorToken = owner.token,
  ) {
    const attendants = (
      await pool.query(
        "SELECT DISTINCT attendant_id FROM assignment ORDER BY attendant_id",
      )
    ).rows.map((r) => r.attendant_id as string);
    const version = (
      await pool.query(
        "SELECT coalesce(max(version),1) v FROM giveaway_phone_census WHERE campaign_id=$1",
        [campaignId],
      )
    ).rows[0].v as number;
    await phones.census(actorToken, campaignId, {
      operationId: newId(),
      kind,
      reason: "Fictional physical census",
      ...(await guard()),
      expectedCensusVersion: version,
      phones: [{ label: "Fictional handset", attendantIds: attendants }],
    });
    const census = (
      await pool.query(
        "SELECT version,content FROM giveaway_phone_census WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1",
        [campaignId],
      )
    ).rows[0] as {
      version: number;
      content: { phones: { id: string; version: number }[] };
    };
    await phones.check(actorToken, campaignId, {
      operationId: newId(),
      kind,
      reason: "Fictional physical check",
      ...(await guard()),
      expectedCensusVersion: census.version,
      entries: census.content.phones.map((p) => ({
        phoneId: p.id,
        expectedPhoneVersion: p.version,
        result: "empty",
        exclusionId: null,
      })),
    });
    return census;
  }
  let closeHttp: undefined | (() => Promise<void>);
  async function http() {
    vi.stubEnv("DATABASE_URL", url.toString());
    vi.stubEnv("BETTER_AUTH_SECRET", config.secret);
    vi.stubEnv("BETTER_AUTH_URL", config.origin);
    vi.stubEnv("WHR_ENV", "local");
    vi.stubEnv("EMAIL_PROVIDER", "noop");
    vi.stubEnv("WHR_TRUSTED_IP_HEADER", "x-test-ip");
    const managers =
      await import("../../src/app/api/admin/giveaway/[campaignId]/reconciliation/selection/managers/route");
    const decision =
      await import("../../src/app/api/admin/giveaway/[campaignId]/reconciliation/exclusions/[exclusionId]/decision/route");
    const server = createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (value)
            headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const request = new Request(`${config.origin}${req.url}`, {
          method: req.method,
          headers,
          ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
        });
        const match = req.url?.match(/\/exclusions\/([^/]+)\/decision$/);
        const response = match
          ? await decision.POST(request, {
              params: Promise.resolve({ campaignId, exclusionId: match[1]! }),
            })
          : await managers.GET(request, {
              params: Promise.resolve({ campaignId }),
            });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeHttp = async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await (await import("../../src/server/lib/db")).database().end();
    };
    return async (path: string, tokenValue: string, body?: unknown) =>
      fetch(`${origin}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin: config.origin,
          cookie: `__Host-whr-admin-session=${tokenValue}`,
          "content-type": "application/json",
          "x-test-ip": "198.51.100.71",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
  }
  return {
    pool,
    owner,
    independent,
    alias,
    people,
    stationId,
    campaignId,
    config,
    op,
    link,
    provision,
    guard,
    designate,
    censusAndCheck,
    phones,
    http,
    async close() {
      await closeHttp?.();
      await pool.end();
      for (let i = 0; i < 100; i++) {
        if (
          (
            await root.query(
              "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1",
              [databaseName],
            )
          ).rows[0].n === 0
        )
          break;
        await new Promise((r) => setTimeout(r, 10));
      }
      await root.query(`DROP DATABASE ${databaseId}`);
      await root.query(`DROP ROLE ${ownerId}`);
      await root.end();
    },
  };
}

describe("WHR-227 provisioned-data runtime boundaries", () => {
  let f: Awaited<ReturnType<typeof provisionedFixture>>;
  beforeEach(async () => {
    vi.resetModules();
    f = await provisionedFixture();
  }, 60000);
  afterEach(async () => {
    await f?.close();
    vi.unstubAllEnvs();
  }, 30000);

  it("I-07 all enabled attendants and two distinct admin people become installation-ready only through operator verification", async () => {
    expect(
      (
        await f.pool.query(
          "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0].rolsuper,
    ).toBe(false);
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM held_release_person_binding",
        )
      ).rows[0].n,
    ).toBe(0);
    await f.provision(false);
    await expect(
      assertReleaseV2Installation(f.pool, f.stationId),
    ).rejects.toThrow("release_policy_unconfigured");
    await f.link(fixtureId(3), f.people.attendantA);
    await f.link(fixtureId(4), f.people.attendantB, true, false);
    await expect(
      assertReleaseV2Installation(f.pool, f.stationId),
    ).rejects.toThrow("release_policy_unconfigured");
    await f.op(
      "verify",
      [
        "--user",
        fixtureId(4),
        "--person",
        f.people.attendantB,
        "--expected-binding-version",
        "1",
        "--verification-reference",
        "FICTIONAL-ATTENDANT-CHECK",
      ],
      "verification_completed",
    );
    await expect(
      assertReleaseV2Installation(f.pool, f.stationId),
    ).resolves.toBeUndefined();
    const request = await f.http();
    const denied = await request(
      `/api/admin/giveaway/${f.campaignId}/reconciliation/selection/managers`,
      "",
    );
    expect(denied.status).toBe(401);
    const response = await request(
      `/api/admin/giveaway/${f.campaignId}/reconciliation/selection/managers`,
      f.owner.token,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(
      body.data.items.map((a: { adminId: string }) => a.adminId).sort(),
    ).toEqual([f.owner.adminId, f.independent.adminId, f.alias.adminId].sort());
    expect(
      (
        await f.pool.query(
          "SELECT count(DISTINCT b.person_id)::int n FROM admin a JOIN LATERAL(SELECT person_id,verified FROM held_release_person_binding WHERE user_id=a.user_id ORDER BY version DESC LIMIT 1)b ON b.verified",
        )
      ).rows[0].n,
    ).toBe(2);
    await f.designate();
    await f.censusAndCheck();
    expect(
      (await readReadiness(f.pool, f.owner.token, f.campaignId)).canPrepare,
    ).toBe(true);
  }, 60000);

  it("I-07 real HTTP rejects rebound phone approval while an independent admin can reject the stale proposal and historical aliases cannot", async () => {
    await f.provision();
    await f.designate();
    const census = await f.censusAndCheck();
    const proposal = await f.phones.propose(
      f.owner.token,
      f.campaignId,
      census.content.phones[0]!.id,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional unavailable phone",
        ...(await f.guard()),
        expectedCensusVersion: census.version,
        expectedPhoneVersion: 1,
        partialSources: [],
      },
    );
    const exclusionId = String(proposal.exclusion.id);
    const retained = (
      await f.pool.query(
        "SELECT to_jsonb(e) content FROM giveaway_phone_exclusion e WHERE id=$1",
        [exclusionId],
      )
    ).rows;
    const nextPerson = newId();
    await f.op("create", ["--person", nextPerson]);
    await f.op(
      "rebind",
      [
        "--user",
        f.owner.userId,
        "--person",
        nextPerson,
        "--expected-binding-version",
        "2",
      ],
      "identity_correction",
    );
    const c = (
      await f.pool.query(
        "SELECT manager_designation_id,phone_check_id,version FROM campaign WHERE id=$1",
        [f.campaignId],
      )
    ).rows[0];
    expect(c.manager_designation_id).toBeNull();
    expect(c.phone_check_id).toBeNull();
    expect(
      (
        await f.pool.query(
          "SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1 ORDER BY version DESC LIMIT 1",
          [exclusionId],
        )
      ).rows[0].state,
    ).toBe("pending");
    expect(
      (await readReadiness(f.pool, f.independent.token, f.campaignId)).blockers,
    ).toContain("phone_exclusion_pending");
    const request = await f.http(),
      path = `/api/admin/giveaway/${f.campaignId}/reconciliation/exclusions/${exclusionId}/decision`;
    const decision = {
      operationId: newId(),
      expectedVersion: 1,
      expectedCampaignVersion: c.version,
      decision: "approve",
      reason: "Fictional independent review",
    };
    const stale = await request(path, f.independent.token, decision);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: { code: "exclusion_stale" },
    });
    const alias = await request(path, f.alias.token, {
      ...decision,
      operationId: newId(),
      decision: "reject",
    });
    expect(alias.status).toBe(403);
    expect(await alias.json()).toMatchObject({
      error: { code: "independent_admin_required" },
    });
    const missingGuard = await request(path, f.independent.token, {
      operationId: newId(),
      expectedVersion: 1,
      decision: "reject",
      reason: "Fictional rejected stale proposal",
    });
    expect(missingGuard.status).toBe(400);
    const staleGuard = await request(path, f.independent.token, {
      ...decision,
      operationId: newId(),
      expectedCampaignVersion: c.version - 1,
      decision: "reject",
    });
    expect(staleGuard.status).toBe(409);
    const reject = { ...decision, operationId: newId(), decision: "reject" };
    const accepted = await request(path, f.independent.token, reject);
    expect(accepted.status).toBe(200);
    const replay = await request(path, f.independent.token, reject);
    expect(replay.status).toBe(200);
    expect(
      (
        await f.pool.query(
          "SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1 ORDER BY version DESC LIMIT 1",
          [exclusionId],
        )
      ).rows[0].state,
    ).toBe("rejected");
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1",
          [exclusionId],
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (
        await f.pool.query(
          "SELECT to_jsonb(e) content FROM giveaway_phone_exclusion e WHERE id=$1",
          [exclusionId],
        )
      ).rows,
    ).toEqual(retained);
  }, 60000);

  it("I-09 concurrent person disable and manager designation never leave a revoked manager live or erase designation history", async () => {
    await f.provision();
    await f.designate(f.independent.adminId);
    const before = (
      await f.pool.query(
        "SELECT to_jsonb(d) content FROM giveaway_manager_designation d ORDER BY id",
      )
    ).rows;
    const args = [
      "disable",
      "--station",
      f.stationId,
      "--environment",
      "test",
      "--person",
      f.people.owner,
      "--authorization",
      "FICTIONAL-DISABLE-RACE",
      "--reason-code",
      "offboarding",
    ];
    const preview = await operate(f.pool, parseArguments(args));
    const guard = await f.guard();
    const held = await f.pool.connect();
    await held.query("BEGIN");
    await held.query("SELECT id FROM security_state WHERE id=true FOR UPDATE");
    const disable = operate(
      f.pool,
      parseArguments([
        ...args,
        "--apply",
        "--expected-revision",
        String(preview.revision),
      ]),
    );
    const designate = f.phones.designate(f.owner.token, f.campaignId, {
      operationId: newId(),
      expectedVersion: guard.expectedVersion,
      managerAdminId: f.owner.adminId,
      reason: "Fictional manager race",
    });
    let waiting = 0;
    for (let attempt = 0; attempt < 100 && waiting < 2; attempt++) {
      waiting = (
        await f.pool.query(
          "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND wait_event_type='Lock' AND query LIKE '%security_state%'",
        )
      ).rows[0].n;
      if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await held.query("COMMIT");
    held.release();
    const results = await Promise.allSettled([disable, designate]);
    expect(waiting).toBeGreaterThanOrEqual(2);
    expect(results[0]!.status).toBe("fulfilled");
    const live = (
      await f.pool.query(
        "SELECT d.manager_admin_id FROM campaign c LEFT JOIN giveaway_manager_designation d ON d.id=c.manager_designation_id WHERE c.id=$1",
        [f.campaignId],
      )
    ).rows[0].manager_admin_id;
    expect(live).not.toBe(f.owner.adminId);
    const bindings = (
      await f.pool.query(
        "SELECT DISTINCT ON(user_id) user_id,verified FROM held_release_person_binding WHERE user_id=ANY($1::uuid[]) ORDER BY user_id,version DESC",
        [[f.owner.userId, f.alias.userId]],
      )
    ).rows;
    expect(bindings).toHaveLength(2);
    expect(bindings.every((r) => r.verified === false)).toBe(true);
    const after = (
      await f.pool.query(
        "SELECT to_jsonb(d) content FROM giveaway_manager_designation d ORDER BY id",
      )
    ).rows;
    expect(after).toEqual(expect.arrayContaining(before));
    await expect(
      assertReleaseV2Installation(f.pool, f.stationId),
    ).rejects.toThrow("release_policy_unconfigured");
  }, 60000);

  it("I-46 provisioning invalidates prepared results and phone checks while saved snapshot bytes stay frozen", async () => {
    await f.provision();
    await f.designate();
    await f.censusAndCheck();
    const view = await readProjection(
      f.pool,
      f.config.secret,
      f.owner.token,
      f.campaignId,
      "managers",
    );
    const viewToken = z
      .object({ view: z.object({ viewToken: z.string() }) })
      .parse(view).view.viewToken;
    const prepared = await prepareGiveaway(
      f.pool,
      f.owner.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional initial results",
        ...(await f.guard()),
      },
      f.config,
    );
    const preview = prepared.data as { id: string; contentDigest: string };
    const oldGuard = await f.guard();
    await f.op(
      "unbind",
      ["--user", f.alias.userId, "--expected-binding-version", "2"],
      "identity_uncertain",
    );
    await expect(
      confirmGiveaway(
        f.pool,
        f.owner.token,
        f.campaignId,
        {
          operationId: newId(),
          previewId: preview.id,
          contentDigest: preview.contentDigest,
          ...oldGuard,
        },
        undefined,
        f.config,
      ),
    ).rejects.toMatchObject({ code: "version_conflict" });
    await expect(
      readProjection(
        f.pool,
        f.config.secret,
        f.owner.token,
        f.campaignId,
        "managers",
        undefined,
        { expectedView: viewToken },
      ),
    ).rejects.toMatchObject({ code: "read_view_stale" });
    expect(
      (await readReadiness(f.pool, f.owner.token, f.campaignId)).blockers,
    ).toContain("phone_check_required");
    await f.censusAndCheck();
    const fresh = await prepareGiveaway(
      f.pool,
      f.owner.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional fresh initial results",
        ...(await f.guard()),
      },
      f.config,
    );
    const ready = fresh.data as { id: string; contentDigest: string };
    await confirmGiveaway(
      f.pool,
      f.owner.token,
      f.campaignId,
      {
        operationId: newId(),
        previewId: ready.id,
        contentDigest: ready.contentDigest,
        ...(await f.guard()),
      },
      undefined,
      f.config,
    );
    const frozen = (
      await f.pool.query(
        "SELECT to_jsonb(s) content FROM giveaway_snapshot s WHERE campaign_id=$1",
        [f.campaignId],
      )
    ).rows;
    await f.censusAndCheck("revision");
    const unchanged = await prepareGiveaway(
      f.pool,
      f.owner.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "revision",
        reason: "Fictional unchanged results",
        ...(await f.guard()),
      },
      f.config,
    );
    expect(unchanged.data).toMatchObject({ state: "unchanged" });
    const unchangedGuard = await f.guard();
    await f.op(
      "verify",
      [
        "--user",
        f.alias.userId,
        "--person",
        f.people.owner,
        "--expected-binding-version",
        "3",
        "--verification-reference",
        "FICTIONAL-RECHECK",
      ],
      "verification_completed",
    );
    expect(
      (await readReadiness(f.pool, f.owner.token, f.campaignId)).blockers,
    ).toContain("phone_check_required");
    await expect(
      prepareGiveaway(
        f.pool,
        f.owner.token,
        f.campaignId,
        {
          operationId: newId(),
          kind: "revision",
          reason: "Fictional stale unchanged confirmation",
          ...unchangedGuard,
        },
        f.config,
      ),
    ).rejects.toMatchObject({ code: "version_conflict" });
    await expect(
      prepareGiveaway(
        f.pool,
        f.owner.token,
        f.campaignId,
        {
          operationId: newId(),
          kind: "revision",
          reason: "Fictional fresh guard without fresh check",
          ...(await f.guard()),
        },
        f.config,
      ),
    ).rejects.toMatchObject({ code: "finalization_blocked" });
    await historicalSale(f.pool, {});
    await f.censusAndCheck("revision");
    const revision = await prepareGiveaway(
      f.pool,
      f.owner.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "revision",
        reason: "Fictional changed results",
        ...(await f.guard()),
      },
      f.config,
    );
    const revisionPreview = revision.data as {
      id: string;
      contentDigest: string;
    };
    expect(revisionPreview.id).toBeTypeOf("string");
    const revisionGuard = await f.guard();
    await f.op(
      "unbind",
      ["--user", f.alias.userId, "--expected-binding-version", "4"],
      "identity_uncertain",
    );
    await expect(
      confirmGiveaway(
        f.pool,
        f.owner.token,
        f.campaignId,
        {
          operationId: newId(),
          previewId: revisionPreview.id,
          contentDigest: revisionPreview.contentDigest,
          ...revisionGuard,
        },
        revisionGuard.expectedPreviousSnapshotId!,
        f.config,
      ),
    ).rejects.toMatchObject({ code: "version_conflict" });
    expect(
      (
        await f.pool.query(
          "SELECT to_jsonb(s) content FROM giveaway_snapshot s WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows,
    ).toEqual(frozen);
  }, 60000);

  it("I-07 v2 activation waiting behind provisioning rechecks every enabled account before writing an approval", async () => {
    await f.provision();
    await expect(
      assertReleaseV2Installation(f.pool, f.stationId),
    ).resolves.toBeUndefined();
    const unbindArgs = [
      "unbind",
      "--station",
      f.stationId,
      "--environment",
      "test",
      "--user",
      f.alias.userId,
      "--expected-binding-version",
      "2",
      "--authorization",
      "FICTIONAL-ACTIVATION-RACE",
      "--reason-code",
      "identity_uncertain",
    ];
    const preview = await operate(f.pool, parseArguments(unbindArgs));
    const activation = releaseArguments([
      "activate",
      "--release",
      "review-evidence-v2",
      "--station",
      f.stationId,
      "--environment",
      "test",
      "--digest",
      releaseV2Digest,
      "--authorization",
      "FICTIONAL-RELEASE-AUTH",
      "--activated-at",
      "2026-11-01T00:00:00Z",
      "--apply",
      "--expected-revision",
      "1",
    ]);
    const releasePreview = await operateRelease(f.pool, {
      ...activation,
      apply: false,
      expectedRevision: null,
    });
    expect(releasePreview).toMatchObject({
      applied: false,
      policy: { revision: 1 },
    });
    const blocker = await f.pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('reporting:'||$1::text,0))",
      [f.stationId],
    );
    const changed = operate(
      f.pool,
      parseArguments([
        ...unbindArgs,
        "--apply",
        "--expected-revision",
        String(preview.revision),
      ]),
    );
    let attempted: ReturnType<typeof operateRelease> | undefined;
    try {
      // The operator owns security_state while waiting downstream. The real
      // activation command must wait and then observe the revoked binding.
      await waitForBlocked(f.pool, "reporting:");
      attempted = operateRelease(f.pool, activation);
      await waitForBlocked(f.pool, "security_state");
    } finally {
      await blocker.query("COMMIT");
      blocker.release();
    }
    expect(attempted).toBeDefined();
    const outcomes = await Promise.allSettled([changed, attempted!]);
    expect(outcomes[0]).toMatchObject({
      status: "fulfilled",
      value: { result: "applied" },
    });
    expect(outcomes[1]).toMatchObject({
      status: "rejected",
      reason: { message: "release_policy_unconfigured" },
    });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM review_evidence_approval",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM review_evidence_configuration",
        )
      ).rows[0].n,
    ).toBe(0);
    await expect(
      assertReleaseV2Installation(f.pool, f.stationId),
    ).rejects.toThrow("release_policy_unconfigured");
  }, 60000);

  it("I-46 giveaway confirmation queued behind provisioning cannot consume an obsolete preview or freeze stale phone evidence", async () => {
    await f.provision();
    await f.designate();
    await f.censusAndCheck();
    const prepared = await prepareGiveaway(
      f.pool,
      f.owner.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional concurrent confirmation",
        ...(await f.guard()),
      },
      f.config,
    );
    const preview = prepared.data as { id: string; contentDigest: string };
    const confirmInput = {
      operationId: newId(),
      previewId: preview.id,
      contentDigest: preview.contentDigest,
      ...(await f.guard()),
    };
    const unbindArgs = [
      "unbind",
      "--station",
      f.stationId,
      "--environment",
      "test",
      "--user",
      f.alias.userId,
      "--expected-binding-version",
      "2",
      "--authorization",
      "FICTIONAL-CONFIRM-RACE",
      "--reason-code",
      "identity_uncertain",
    ];
    const mutationPreview = await operate(f.pool, parseArguments(unbindArgs));
    const blocker = await f.pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('reporting:'||$1::text,0))",
      [f.stationId],
    );
    const changed = operate(
      f.pool,
      parseArguments([
        ...unbindArgs,
        "--apply",
        "--expected-revision",
        String(mutationPreview.revision),
      ]),
    );
    let confirmed: ReturnType<typeof confirmGiveaway> | undefined;
    try {
      await waitForBlocked(f.pool, "reporting:");
      confirmed = confirmGiveaway(
        f.pool,
        f.owner.token,
        f.campaignId,
        confirmInput,
        undefined,
        f.config,
      );
      await waitForBlocked(f.pool, "security_state");
    } finally {
      await blocker.query("COMMIT");
      blocker.release();
    }
    expect(confirmed).toBeDefined();
    const outcomes = await Promise.allSettled([changed, confirmed!]);
    expect(outcomes[0]).toMatchObject({
      status: "fulfilled",
      value: { result: "applied" },
    });
    expect(outcomes[1]).toMatchObject({
      status: "rejected",
      reason: { code: "version_conflict" },
    });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_snapshot WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_preview_consumption WHERE preview_id=$1",
          [preview.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.pool.query(
          "SELECT phone_check_id,reconciliation_required FROM campaign WHERE id=$1",
          [f.campaignId],
        )
      ).rows[0],
    ).toMatchObject({ phone_check_id: null, reconciliation_required: true });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM audit_event WHERE action='giveaway_finalized'",
        )
      ).rows[0].n,
    ).toBe(0);
  }, 60000);
});
