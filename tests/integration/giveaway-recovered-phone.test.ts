import { expect, it } from "vitest";
import pg from "pg";
import { z } from "zod";
import { giveawayFixture } from "../helpers/giveaway-fixture";
import { config, fixtureId } from "../helpers/cards-adversarial-fixture";
import { newId } from "../../src/server/lib/ids";
import {
  readReadiness,
  prepareGiveaway,
  confirmGiveaway,
} from "../../src/server/modules/giveaway/service";

async function setup() {
  const f = await giveawayFixture();
  if (
    (
      await f.pool.query(
        "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0].rolsuper
  ) {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const role = `recovered_${newId().replaceAll("-", "")}`;
    await admin.query(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS`);
    await admin.query(`GRANT USAGE ON SCHEMA ${f.schema} TO ${role}`);
    await admin.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${f.schema} TO ${role}`,
    );
    f.pool.on("connect", (client) => {
      void client.query(`SET ROLE ${role}`);
    });
    await f.pool.query(`SET ROLE ${role}`);
    const close = f.close;
    f.close = async () => {
      await close();
      await admin.query(`DROP OWNED BY ${role}`);
      await admin.query(`DROP ROLE ${role}`);
      await admin.end();
    };
  }
  expect(
    (
      await f.pool.query(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0],
  ).toEqual({ rolsuper: false, rolbypassrls: false });
  const attendants = (
    await f.pool.query(
      "SELECT DISTINCT attendant_id FROM assignment ORDER BY attendant_id",
    )
  ).rows.map((r) => r.attendant_id);
  const recorded = await f.phones.census(f.token, f.campaignId, {
    operationId: newId(),
    kind: "initial",
    reason: "Fictional original census",
    ...(await f.guard()),
    expectedCensusVersion: 1,
    phones: [{ label: "Fictional recovered phone", attendantIds: attendants }],
  });
  const census = (
    await f.pool.query("SELECT * FROM giveaway_phone_census WHERE id=$1", [
      recorded.census.id,
    ])
  ).rows[0];
  const phone = census.content.phones[0];
  const proposed = await f.phones.propose(f.token, f.campaignId, phone.id, {
    operationId: newId(),
    kind: "initial",
    reason: "Fictional unavailable phone",
    ...(await f.guard()),
    expectedCensusVersion: census.version,
    expectedPhoneVersion: phone.version,
    partialSources: [],
  });
  const reviewer = await f.actor(["sales", "leaderboards", "giveawayFinalize"]);
  const person = newId();
  await f.pool.query(
    "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
    [person, fixtureId(8)],
  );
  await f.pool.query(
    "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,1,true)",
    [newId(), fixtureId(8), reviewer.userId, person],
  );
  const approve = () =>
    f.phones.decide(
      reviewer.token,
      f.campaignId,
      String(proposed.exclusion.id),
      {
        operationId: newId(),
        expectedVersion: 1,
        decision: "approve",
        reason: "Fictional independent approval",
      },
    );
  const emptyRequest = async () => ({
    operationId: newId(),
    kind: "initial",
    reason: "Fictional recovered inspected phone",
    ...(await f.guard()),
    expectedCensusVersion: census.version,
    entries: [
      {
        phoneId: phone.id,
        expectedPhoneVersion: phone.version,
        result: "empty",
        exclusionId: null,
      },
    ],
  });
  const replacementRequest = async () => ({
    operationId: newId(),
    kind: "initial",
    reason: "Fictional recovered replacement census",
    ...(await f.guard()),
    expectedCensusVersion: census.version,
    phones: [
      { id: phone.id, label: phone.label, attendantIds: phone.attendantIds },
    ],
  });
  return {
    f,
    census,
    phone,
    proposed,
    reviewer,
    approve,
    emptyRequest,
    replacementRequest,
  };
}

async function state(f: Awaited<ReturnType<typeof giveawayFixture>>) {
  const result: Record<string, unknown> = {};
  for (const table of [
    "campaign",
    "station_reporting_state",
    "giveaway_phone_census",
    "giveaway_phone_check",
    "giveaway_phone_exclusion",
    "giveaway_phone_exclusion_transition",
    "mutation_receipt",
    "audit_event",
    "giveaway_reconciliation",
    "giveaway_preview",
    "giveaway_snapshot",
  ])
    result[table] = (
      await f.pool.query(
        `SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
  return result;
}

async function legacyEmptyCheck(s: Awaited<ReturnType<typeof setup>>) {
  const { f, census, phone } = s;
  const guard = await f.guard();
  const c = (
    await f.pool.query("SELECT * FROM campaign WHERE id=$1", [f.campaignId])
  ).rows[0];
  const id = newId();
  // Model a persisted pre-fix check without disabling constraints or rewriting history.
  await f.pool.query(
    "INSERT INTO giveaway_phone_check(id,campaign_id,census_id,content,entries) VALUES($1,$2,$3,$4,$5)",
    [
      id,
      f.campaignId,
      census.id,
      {
        id,
        campaignId: f.campaignId,
        censusId: census.id,
        censusVersion: census.version,
        operationId: newId(),
        auditEventId: census.content.auditEventId,
        manager: { id: fixtureId(5) },
        kind: "initial",
        sourceDataVersion: guard.expectedDataVersion,
        settingsVersionId: guard.expectedSettingsVersionId,
        designationId: c.manager_designation_id,
        previousSnapshotId: null,
        policyVersion: "reconciliation-v1",
      },
      JSON.stringify([
        {
          phoneId: phone.id,
          phoneVersion: phone.version,
          attendantIds: phone.attendantIds,
          result: "empty",
          exclusionId: null,
        },
      ]),
    ],
  );
  await f.pool.query(
    "UPDATE campaign SET phone_check_id=$2,version=version+1 WHERE id=$1",
    [f.campaignId, id],
  );
  return id;
}

it("WHR-208 approved unavailable phone refuses old-census empty checks without any effects", async () => {
  const s = await setup();
  try {
    await s.approve();
    const before = await state(s.f);
    await expect(
      s.f.phones.check(s.f.token, s.f.campaignId, await s.emptyRequest()),
    ).rejects.toMatchObject({ code: "phone_check_stale", status: 409 });
    expect(await state(s.f)).toEqual(before);
  } finally {
    await s.f.close();
  }
}, 30000);

it("WHR-208 replacement census permits recovered phone and preserves old approved history", async () => {
  const s = await setup();
  try {
    await s.approve();
    const history = (
      await s.f.pool.query(
        "SELECT * FROM (SELECT to_jsonb(e) row FROM giveaway_phone_exclusion e UNION ALL SELECT to_jsonb(t) FROM giveaway_phone_exclusion_transition t) history ORDER BY row::text",
      )
    ).rows;
    const replacement = await s.f.phones.census(
      s.f.token,
      s.f.campaignId,
      await s.replacementRequest(),
    );
    const request = await s.emptyRequest();
    request.expectedCensusVersion = replacement.census.version;
    request.entries[0]!.expectedPhoneVersion = s.phone.version + 1;
    const checked = await s.f.phones.check(s.f.token, s.f.campaignId, request);
    expect(checked.phoneCheck).toMatchObject({
      censusId: replacement.census.id,
    });
    expect(
      (await readReadiness(s.f.pool, s.f.token, s.f.campaignId)).canPrepare,
    ).toBe(true);
    expect(
      (
        await s.f.pool.query(
          "SELECT * FROM (SELECT to_jsonb(e) row FROM giveaway_phone_exclusion e UNION ALL SELECT to_jsonb(t) FROM giveaway_phone_exclusion_transition t) history ORDER BY row::text",
        )
      ).rows,
    ).toEqual(history);
  } finally {
    await s.f.close();
  }
}, 30000);

it("WHR-208 legacy old-census empty check fails readiness and preparation without effects", async () => {
  const s = await setup();
  try {
    await s.approve();
    await legacyEmptyCheck(s);
    const before = await state(s.f);
    const ready = await readReadiness(s.f.pool, s.f.token, s.f.campaignId);
    expect(ready.phoneCheck.state).toBe("stale");
    expect(ready.blockers).toContain("phone_check_required");
    await expect(
      prepareGiveaway(
        s.f.pool,
        s.f.token,
        s.f.campaignId,
        {
          operationId: newId(),
          kind: "initial",
          reason: "Fictional legacy recovery preparation",
          ...(await s.f.guard()),
        },
        config,
      ),
    ).rejects.toMatchObject({ code: "finalization_blocked" });
    expect(await state(s.f)).toEqual(before);
  } finally {
    await s.f.close();
  }
}, 30000);

it("WHR-208 concurrent old-census recovered checks both refuse as a non-superuser", async () => {
  const s = await setup();
  try {
    await s.approve();
    const requests = [await s.emptyRequest(), await s.emptyRequest()];
    const before = await state(s.f);
    const results = await Promise.allSettled(
      requests.map((b) => s.f.phones.check(s.f.token, s.f.campaignId, b)),
    );
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "rejected",
          reason: expect.objectContaining({ code: "phone_check_stale" }),
        }),
      ]),
    );
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
    expect(await state(s.f)).toEqual(before);
  } finally {
    await s.f.close();
  }
}, 30000);

it("WHR-208 concurrent approval and recovered check never certify the excluded census", async () => {
  const s = await setup();
  try {
    const request = await s.emptyRequest();
    const results = await Promise.allSettled([
      s.approve(),
      s.f.phones.check(s.f.token, s.f.campaignId, request),
    ]);
    expect(results[0]!.status).toBe("fulfilled");
    expect(results[1]!.status).toBe("rejected");
    expect(
      (
        await s.f.pool.query(
          "SELECT count(*)::int n FROM giveaway_phone_check WHERE campaign_id=$1",
          [s.f.campaignId],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await s.f.close();
  }
}, 30000);

it("WHR-208 concurrent replacement census wins while old-census recovery refuses", async () => {
  const s = await setup();
  try {
    await s.approve();
    const empty = await s.emptyRequest(),
      replacement = await s.replacementRequest();
    const results = await Promise.allSettled([
      s.f.phones.check(s.f.token, s.f.campaignId, empty),
      s.f.phones.census(s.f.token, s.f.campaignId, replacement),
    ]);
    expect(results[0]!.status).toBe("rejected");
    expect(results[1]!.status).toBe("fulfilled");
    expect(
      (
        await s.f.pool.query(
          "SELECT count(*)::int n FROM giveaway_phone_check WHERE campaign_id=$1",
          [s.f.campaignId],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await s.f.close();
  }
}, 30000);

it("WHR-208 changed exclusion applicability never permits recovery under its excluded census", async () => {
  const s = await setup();
  try {
    await s.approve();
    for (const managerAdminId of [s.reviewer.adminId, fixtureId(5)]) {
      await s.f.phones.designate(s.f.token, s.f.campaignId, {
        operationId: newId(),
        expectedVersion: (await s.f.guard()).expectedVersion,
        managerAdminId,
        reason: "Fictional manager designation change",
      });
    }
    const before = await state(s.f);
    await expect(
      s.f.phones.check(s.f.token, s.f.campaignId, await s.emptyRequest()),
    ).rejects.toMatchObject({ code: "phone_check_stale" });
    expect(await state(s.f)).toEqual(before);
  } finally {
    await s.f.close();
  }
}, 30000);

it("WHR-208 recovered revision with replacement census preserves the previous unavailable snapshot", async () => {
  const s = await setup();
  try {
    await s.approve();
    const request = await s.emptyRequest();
    await s.f.phones.check(s.f.token, s.f.campaignId, {
      ...request,
      entries: [
        {
          ...request.entries[0],
          result: "unavailable",
          exclusionId: s.proposed.exclusion.id,
        },
      ],
    });
    const prepared = await prepareGiveaway(
      s.f.pool,
      s.f.token,
      s.f.campaignId,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional unavailable result",
        ...(await s.f.guard()),
      },
      config,
    );
    const preview = z
      .object({ id: z.string(), contentDigest: z.string() })
      .parse(prepared.data);
    await confirmGiveaway(
      s.f.pool,
      s.f.token,
      s.f.campaignId,
      {
        operationId: newId(),
        previewId: preview.id,
        contentDigest: preview.contentDigest,
        ...(await s.f.guard()),
      },
      undefined,
      config,
    );
    const before = (
      await s.f.pool.query(
        "SELECT to_jsonb(s) row FROM giveaway_snapshot s WHERE campaign_id=$1",
        [s.f.campaignId],
      )
    ).rows;
    const history = (
      await s.f.pool.query(
        "SELECT to_jsonb(e) row FROM giveaway_phone_exclusion e UNION ALL SELECT to_jsonb(t) FROM giveaway_phone_exclusion_transition t",
      )
    ).rows;
    const census = await s.f.phones.census(s.f.token, s.f.campaignId, {
      ...(await s.replacementRequest()),
      kind: "revision",
    });
    const next = await s.emptyRequest();
    next.kind = "revision";
    next.expectedCensusVersion = census.census.version;
    next.entries[0]!.expectedPhoneVersion = s.phone.version + 1;
    await s.f.phones.check(s.f.token, s.f.campaignId, next);
    const revision = await prepareGiveaway(
      s.f.pool,
      s.f.token,
      s.f.campaignId,
      {
        operationId: newId(),
        kind: "revision",
        reason: "Fictional recovered result",
        ...(await s.f.guard()),
      },
      config,
    );
    expect(revision.data).toMatchObject({ state: "unchanged" });
    expect(
      (
        await s.f.pool.query(
          "SELECT to_jsonb(s) row FROM giveaway_snapshot s WHERE campaign_id=$1",
          [s.f.campaignId],
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await s.f.pool.query(
          "SELECT to_jsonb(e) row FROM giveaway_phone_exclusion e UNION ALL SELECT to_jsonb(t) FROM giveaway_phone_exclusion_transition t",
        )
      ).rows,
    ).toEqual(history);
  } finally {
    await s.f.close();
  }
}, 30000);
