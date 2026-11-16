import type { PoolClient } from "pg";
import { it, expect } from "vitest";
import { giveawayFixture } from "../helpers/giveaway-fixture";
import { historicalSale } from "../helpers/cards-adversarial-fixture";
import { readReadiness } from "../../src/server/modules/giveaway/service";
import { newId } from "../../src/server/lib/ids";

it("P-30 census cannot omit a historical attendant account", async () => {
  const f = await giveawayFixture();
  try {
    const ids = (
      await f.pool.query("SELECT DISTINCT attendant_id FROM assignment")
    ).rows.map((r) => r.attendant_id);
    expect(ids.length).toBeGreaterThan(1);
    await expect(
      f.phones.census(f.token, f.campaignId, {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional incomplete census",
        ...(await f.guard()),
        expectedCensusVersion: 1,
        phones: [{ label: "Fictional phone", attendantIds: [ids[0]] }],
      }),
    ).rejects.toMatchObject({ code: "census_incomplete" });
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 accepted contributions cannot enter exact unavailable-phone partial exclusions", async () => {
  const f = await giveawayFixture();
  try {
    const sale = await historicalSale(f.pool, {});
    await f.check();
    const census = (
      await f.pool.query(
        "SELECT version,content FROM giveaway_phone_census WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1",
        [f.campaignId],
      )
    ).rows[0];
    const version = (
      await f.pool.query("SELECT version FROM purchase WHERE id=$1", [sale.id])
    ).rows[0].version;
    await expect(
      f.phones.propose(f.token, f.campaignId, census.content.phones[0].id, {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional invalid accepted source",
        ...(await f.guard()),
        expectedCensusVersion: census.version,
        expectedPhoneVersion: 1,
        partialSources: [
          { purchaseId: sale.id, expectedPurchaseVersion: version },
        ],
      }),
    ).rejects.toMatchObject({ code: "exclusion_source_invalid" });
  } finally {
    await f.close();
  }
}, 30000);

async function unavailable(f: Awaited<ReturnType<typeof giveawayFixture>>) {
  await f.check();
  const census = (
    await f.pool.query(
      "SELECT version,content FROM giveaway_phone_census WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1",
      [f.campaignId],
    )
  ).rows[0];
  const request = {
    operationId: newId(),
    kind: "initial",
    reason: "Fictional unavailable handset",
    ...(await f.guard()),
    expectedCensusVersion: census.version,
    expectedPhoneVersion: 1,
    partialSources: [],
  };
  const result = await f.phones.propose(
    f.token,
    f.campaignId,
    census.content.phones[0].id,
    request,
  );
  return { census, request, result, phoneId: census.content.phones[0].id };
}
async function reviewer(
  f: Awaited<ReturnType<typeof giveawayFixture>>,
  same = false,
) {
  const a = await f.actor(["sales", "leaderboards", "giveawayFinalize"]);
  const existing = (
    await f.pool.query(
      "SELECT station_id,person_id FROM held_release_person_binding LIMIT 1",
    )
  ).rows[0];
  const person = same ? existing.person_id : newId();
  if (!same)
    await f.pool.query(
      "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
      [person, existing.station_id],
    );
  await f.pool.query(
    "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,1,true)",
    [newId(), existing.station_id, a.userId, person],
  );
  return a;
}
it("P-30 alias account for the same canonical person cannot approve an unavailable phone", async () => {
  const f = await giveawayFixture();
  try {
    const p = await unavailable(f),
      a = await reviewer(f, true);
    await expect(
      f.phones.decide(a.token, f.campaignId, String(p.result.exclusion.id), {
        operationId: newId(),
        expectedVersion: 1,
        decision: "approve",
        reason: "Fictional review",
      }),
    ).rejects.toMatchObject({ code: "independent_admin_required" });
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 independent opposing reviewers apply one immutable decision and replay requires current grants", async () => {
  const f = await giveawayFixture();
  try {
    const p = await unavailable(f),
      a = await reviewer(f),
      b = await reviewer(f);
    const first = {
      operationId: newId(),
      expectedVersion: 1,
      decision: "approve",
      reason: "Fictional approval",
    };
    const results = await Promise.allSettled([
      f.phones.decide(
        a.token,
        f.campaignId,
        String(p.result.exclusion.id),
        first,
      ),
      f.phones.decide(b.token, f.campaignId, String(p.result.exclusion.id), {
        ...first,
        operationId: newId(),
        decision: "reject",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const win = results[0]!.status === "fulfilled" ? a : b;
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1",
          [p.result.exclusion.id],
        )
      ).rows[0].n,
    ).toBe(2);
    if (win === a) {
      expect(
        await f.phones.decide(
          a.token,
          f.campaignId,
          String(p.result.exclusion.id),
          first,
        ),
      ).toEqual((results[0] as PromiseFulfilledResult<unknown>).value);
      await f.pool.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='giveawayFinalize'",
        [a.roleId],
      );
      await expect(
        f.phones.decide(
          a.token,
          f.campaignId,
          String(p.result.exclusion.id),
          first,
        ),
      ).rejects.toMatchObject({ code: "permission_denied" });
    }
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 proposal replay preserves history and changed body conflicts before stale guards", async () => {
  const f = await giveawayFixture();
  try {
    const p = await unavailable(f);
    expect(
      await f.phones.propose(f.token, f.campaignId, p.phoneId, p.request),
    ).toEqual(p.result);
    await expect(
      f.phones.propose(f.token, f.campaignId, p.phoneId, {
        ...p.request,
        reason: "Different fictional reason",
      }),
    ).rejects.toMatchObject({ code: "operation_conflict" });
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 replacing a census atomically supersedes the old pending phone exclusion", async () => {
  const f = await giveawayFixture();
  try {
    const p = await unavailable(f),
      a = await reviewer(f);
    await f.phones.census(f.token, f.campaignId, {
      operationId: newId(),
      kind: "initial",
      reason: "Fictional replacement census",
      ...(await f.guard()),
      expectedCensusVersion: p.census.version,
      phones: p.census.content.phones.map(
        (v: { id: string; label: string; attendantIds: string[] }) => ({
          id: v.id,
          label: v.label,
          attendantIds: v.attendantIds,
        }),
      ),
    });
    expect(
      (
        await f.pool.query(
          "SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1 ORDER BY version DESC LIMIT 1",
          [p.result.exclusion.id],
        )
      ).rows[0].state,
    ).toBe("superseded");
    await expect(
      f.phones.decide(a.token, f.campaignId, String(p.result.exclusion.id), {
        operationId: newId(),
        expectedVersion: 2,
        decision: "approve",
        reason: "Fictional stale decision",
      }),
    ).rejects.toMatchObject({ code: "exclusion_stale" });
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 exact incomplete source approval suppresses only its upload obligation and retains review blockers", async () => {
  const f = await giveawayFixture();
  try {
    const sale = await historicalSale(f.pool, { state: "photo_pending" });
    await f.check();
    const a = await reviewer(f);
    const c = (
      await f.pool.query(
        "SELECT version,content FROM giveaway_phone_census WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1",
        [f.campaignId],
      )
    ).rows[0];
    const pv = (
      await f.pool.query("SELECT version FROM purchase WHERE id=$1", [sale.id])
    ).rows[0].version;
    const p = await f.phones.propose(
      f.token,
      f.campaignId,
      c.content.phones[0].id,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional exact stranded partial",
        ...(await f.guard()),
        expectedCensusVersion: c.version,
        expectedPhoneVersion: 1,
        partialSources: [{ purchaseId: sale.id, expectedPurchaseVersion: pv }],
      },
    );
    const approved = await f.phones.decide(
      a.token,
      f.campaignId,
      String(p.exclusion.id),
      {
        operationId: newId(),
        expectedVersion: 1,
        decision: "approve",
        reason: "Fictional independent exact review",
      },
    );
    expect(approved.exclusion.state).toBe("approved");
    await f.phones.check(f.token, f.campaignId, {
      operationId: newId(),
      kind: "initial",
      reason: "Fictional unavailable check",
      ...(await f.guard()),
      expectedCensusVersion: c.version,
      entries: [
        {
          phoneId: c.content.phones[0].id,
          expectedPhoneVersion: 1,
          result: "unavailable",
          exclusionId: p.exclusion.id,
        },
      ],
    });
    const ready = await readReadiness(f.pool, f.token, f.campaignId);
    expect(ready.counts.uploads).toBe("0");
    await f.pool.query(
      "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_unresolved','fictional-policy',clock_timestamp(),1)",
      [newId(), sale.id],
    );
    const blocked = await readReadiness(f.pool, f.token, f.campaignId);
    expect(blocked.blockers).toContain("eligibility_unresolved");
    expect(
      (
        await f.pool.query(
          "SELECT current_revision_id FROM purchase WHERE id=$1",
          [sale.id],
        )
      ).rows[0].current_revision_id,
    ).toBeNull();
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 changing the designated manager supersedes pending unavailable-phone proposals", async () => {
  const f = await giveawayFixture();
  try {
    const p = await unavailable(f),
      a = await reviewer(f);
    await f.phones.designate(f.token, f.campaignId, {
      operationId: newId(),
      expectedVersion: (await f.guard()).expectedVersion,
      managerAdminId: a.adminId,
      reason: "Fictional manager replacement",
    });
    expect(
      (
        await f.pool.query(
          "SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1 ORDER BY version DESC LIMIT 1",
          [p.result.exclusion.id],
        )
      ).rows[0].state,
    ).toBe("superseded");
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 trusted complete-byte observation forbids a partial exclusion even before validation", async () => {
  const f = await giveawayFixture();
  try {
    const sale = await historicalSale(f.pool, { state: "photo_pending" });
    await f.check();
    const c = (
      await f.pool.query(
        "SELECT version,content FROM giveaway_phone_census WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1",
        [f.campaignId],
      )
    ).rows[0];
    const row = (
      await f.pool.query("SELECT * FROM purchase WHERE id=$1", [sale.id])
    ).rows[0];
    const asset = newId();
    await f.pool.query(
      "INSERT INTO photo_asset(id,purchase_id,upload_operation_id,state,staging_key,staging_expires_at,expected_digest,expected_bytes) VALUES($1,$2,$3,'staged',$4,clock_timestamp()+interval '1 hour',$5,$6)",
      [
        asset,
        sale.id,
        newId(),
        `fictional/${asset}`,
        row.expected_photo_digest,
        row.expected_photo_bytes,
      ],
    );
    await f.pool.query(
      "INSERT INTO photo_receipt_observation(id,station_id,purchase_id,asset_id,declared_digest,observed_digest,observed_bytes,sealed_key,receipt_at) VALUES($1,$2,$3,$4,$5,$5,$6,$7,clock_timestamp())",
      [
        newId(),
        row.station_id,
        sale.id,
        asset,
        row.expected_photo_digest,
        row.expected_photo_bytes,
        `fictional/sealed/${asset}`,
      ],
    );
    await expect(
      f.phones.propose(f.token, f.campaignId, c.content.phones[0].id, {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional receipt cannot be excluded",
        ...(await f.guard()),
        expectedCensusVersion: c.version,
        expectedPhoneVersion: 1,
        partialSources: [
          { purchaseId: sale.id, expectedPurchaseVersion: row.version },
        ],
      }),
    ).rejects.toMatchObject({ code: "exclusion_source_invalid" });
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 changed incomplete purchase atomically supersedes a pending exact-source exclusion", async () => {
  const f = await giveawayFixture();
  try {
    const sale = await historicalSale(f.pool, { state: "photo_pending" });
    await f.check();
    const c = (
        await f.pool.query(
          "SELECT version,content FROM giveaway_phone_census WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1",
          [f.campaignId],
        )
      ).rows[0],
      row = (
        await f.pool.query("SELECT version FROM purchase WHERE id=$1", [
          sale.id,
        ])
      ).rows[0];
    const p = await f.phones.propose(
      f.token,
      f.campaignId,
      c.content.phones[0].id,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional stranded source",
        ...(await f.guard()),
        expectedCensusVersion: c.version,
        expectedPhoneVersion: 1,
        partialSources: [
          { purchaseId: sale.id, expectedPurchaseVersion: row.version },
        ],
      },
    );
    await f.pool.query(
      "UPDATE purchase SET status='cancelled',cancellation_reason='Fictional invalid sale',version=version+1 WHERE id=$1",
      [sale.id],
    );
    expect(
      (
        await f.pool.query(
          "SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1 ORDER BY version DESC LIMIT 1",
          [p.exclusion.id],
        )
      ).rows[0].state,
    ).toBe("superseded");
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 multiple phones retain every personal partition including disabled leavers", async () => {
  const f = await giveawayFixture();
  try {
    const ids = (
      await f.pool.query(
        "SELECT DISTINCT attendant_id FROM assignment ORDER BY attendant_id",
      )
    ).rows.map((r) => r.attendant_id);
    await f.pool.query(
      "UPDATE auth_user SET enabled=false,auth_version=auth_version+1 WHERE id=(SELECT user_id FROM attendant WHERE id=$1)",
      [ids[0]],
    );
    await expect(
      f.phones.census(f.token, f.campaignId, {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional omitted leaver",
        ...(await f.guard()),
        expectedCensusVersion: 1,
        phones: [
          { label: "Fictional replacement", attendantIds: ids.slice(1) },
        ],
      }),
    ).rejects.toMatchObject({ code: "census_incomplete" });
    const result = await f.phones.census(f.token, f.campaignId, {
      operationId: newId(),
      kind: "initial",
      reason: "Fictional complete physical census",
      ...(await f.guard()),
      expectedCensusVersion: 1,
      phones: [
        { label: "Fictional original", attendantIds: ids },
        { label: "Fictional replacement", attendantIds: [ids[0]] },
      ],
    });
    expect(result.census.version).toBe(2);
    const row = (
      await f.pool.query(
        "SELECT content FROM giveaway_phone_census WHERE id=$1",
        [result.census.id],
      )
    ).rows[0];
    await expect(
      f.phones.check(f.token, f.campaignId, {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional missed replacement phone",
        ...(await f.guard()),
        expectedCensusVersion: 2,
        entries: [
          {
            phoneId: row.content.phones[0].id,
            expectedPhoneVersion: 1,
            result: "empty",
            exclusionId: null,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "census_incomplete" });
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 recovered phone needs a fresh census and keeps approved exclusion history", async () => {
  const f = await giveawayFixture();
  try {
    const p = await unavailable(f),
      a = await reviewer(f);
    await f.phones.decide(
      a.token,
      f.campaignId,
      String(p.result.exclusion.id),
      {
        operationId: newId(),
        expectedVersion: 1,
        decision: "approve",
        reason: "Fictional unavailable approval",
      },
    );
    await f.check();
    expect(
      (
        await f.pool.query(
          "SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1 ORDER BY version DESC LIMIT 1",
          [p.result.exclusion.id],
        )
      ).rows[0].state,
    ).toBe("approved");
    expect(
      (await readReadiness(f.pool, f.token, f.campaignId)).phoneCheck.state,
    ).toBe("complete");
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 supersession audit links both proposal and actual manager-change event", async () => {
  const f = await giveawayFixture();
  try {
    const p = await unavailable(f),
      a = await reviewer(f);
    const change = await f.phones.designate(f.token, f.campaignId, {
      operationId: newId(),
      expectedVersion: (await f.guard()).expectedVersion,
      managerAdminId: a.adminId,
      reason: "Fictional replacement designation",
    });
    const event = (
      await f.pool.query(
        "SELECT related_event_ids FROM audit_event WHERE action='giveaway_phone_unavailable_superseded' AND target_id=$1",
        [f.campaignId],
      )
    ).rows[0];
    expect(event.related_event_ids).toContain(change.auditEventId);
    expect(event.related_event_ids).toContain(p.result.exclusion.auditEventId);
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 proposer identity rebinding cannot silently rebase an existing exclusion", async () => {
  const f = await giveawayFixture();
  try {
    const p = await unavailable(f),
      a = await reviewer(f);
    const binding = (
      await f.pool.query(
        "SELECT * FROM held_release_person_binding WHERE user_id=(SELECT user_id FROM admin WHERE id=(SELECT manager_admin_id FROM giveaway_manager_designation WHERE id=(SELECT manager_designation_id FROM campaign WHERE id=$1))) ORDER BY version DESC LIMIT 1",
        [f.campaignId],
      )
    ).rows[0];
    const person = newId();
    await f.pool.query(
      "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
      [person, binding.station_id],
    );
    await f.pool.query(
      "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,2,true)",
      [newId(), binding.station_id, binding.user_id, person],
    );
    await expect(
      f.phones.decide(a.token, f.campaignId, String(p.result.exclusion.id), {
        operationId: newId(),
        expectedVersion: 1,
        decision: "approve",
        reason: "Fictional stale identity review",
      }),
    ).rejects.toMatchObject({ code: "exclusion_stale" });
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 revoked manager grant denies independent approval and manager proposal replay", async () => {
  const f = await giveawayFixture();
  try {
    const p = await unavailable(f),
      a = await reviewer(f);
    await f.pool.query(
      "DELETE FROM role_permission WHERE role_id=(SELECT role_id FROM admin WHERE id=(SELECT manager_admin_id FROM giveaway_manager_designation WHERE id=(SELECT manager_designation_id FROM campaign WHERE id=$1))) AND permission_code='giveawayFinalize'",
      [f.campaignId],
    );
    await expect(
      f.phones.decide(a.token, f.campaignId, String(p.result.exclusion.id), {
        operationId: newId(),
        expectedVersion: 1,
        decision: "approve",
        reason: "Fictional authority recheck",
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      f.phones.propose(f.token, f.campaignId, p.phoneId, p.request),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(p.result.exclusion).not.toHaveProperty("unsentCount");
    expect(p.result.exclusion).not.toHaveProperty("queueCount");
    expect(p.result.exclusion.partialSources).toEqual([]);
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 extra and duplicate phone-check rows never certify a partial census", async () => {
  const f = await giveawayFixture();
  try {
    await f.check();
    const c = (
      await f.pool.query(
        "SELECT content,version FROM giveaway_phone_census WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1",
        [f.campaignId],
      )
    ).rows[0];
    const entry = {
      phoneId: c.content.phones[0].id,
      expectedPhoneVersion: 1,
      result: "empty",
      exclusionId: null,
    };
    for (const entries of [
      [entry, entry],
      [entry, { ...entry, phoneId: newId() }],
    ])
      await expect(
        f.phones.check(f.token, f.campaignId, {
          operationId: newId(),
          kind: "initial",
          reason: "Fictional extra inventory rows",
          ...(await f.guard()),
          expectedCensusVersion: c.version,
          entries,
        }),
      ).rejects.toMatchObject({ code: "census_incomplete" });
  } finally {
    await f.close();
  }
}, 30000);
it("M4 one transaction with receipt validation and revision writes advances generations exactly once", async () => {
  const f = await giveawayFixture();
  try {
    const before = await f.guard();
    await historicalSale(f.pool, {});
    const after = await f.guard();
    expect(
      BigInt(after.expectedDataVersion) - BigInt(before.expectedDataVersion),
    ).toBe(1n);
    expect(after.expectedVersion - before.expectedVersion).toBe(1);
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 non-superuser cannot attach another campaign census or omit its check entries", async () => {
  const f = await giveawayFixture();
  const role = `phone_${newId().replaceAll("-", "")}`;
  let client: PoolClient | undefined;
  try {
    await f.check();
    const check = (
      await f.pool.query(
        "SELECT * FROM giveaway_phone_check WHERE campaign_id=$1",
        [f.campaignId],
      )
    ).rows[0];
    const station = newId(),
      campaign = newId();
    await f.pool.query(
      "INSERT INTO station(id,code,name,timezone,version) VALUES($1,$2,'Fictional other station','Africa/Lagos',1)",
      [station, `OTHER-${station}`],
    );
    await f.pool.query(
      "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional other campaign',1,true)",
      [campaign, station],
    );
    await f.pool.query(
      `CREATE ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    await f.pool.query(`GRANT USAGE ON SCHEMA ${f.schema} TO ${role}`);
    await f.pool.query(
      `GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA ${f.schema} TO ${role}`,
    );
    client = await f.pool.connect();
    await client.query(`SET ROLE ${role}`);
    const id = newId();
    await expect(
      client.query(
        "INSERT INTO giveaway_phone_check(id,campaign_id,census_id,content,entries) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          campaign,
          check.census_id,
          { ...check.content, id, campaignId: campaign, operationId: newId() },
          JSON.stringify(check.entries),
        ],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const ownId = newId();
    await expect(
      client.query(
        "INSERT INTO giveaway_phone_check(id,campaign_id,census_id,content,entries) VALUES($1,$2,$3,$4,$5)",
        [
          ownId,
          f.campaignId,
          check.census_id,
          { ...check.content, id: ownId, operationId: newId() },
          "[]",
        ],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  } finally {
    if (client) {
      await client.query("RESET ROLE");
      client.release();
    }
    await f.pool.query(`DROP OWNED BY ${role}`);
    await f.pool.query(`DROP ROLE ${role}`);
    await f.close();
  }
}, 30000);
