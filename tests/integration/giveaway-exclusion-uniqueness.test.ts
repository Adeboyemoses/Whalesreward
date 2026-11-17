import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { giveawayFixture } from "../helpers/giveaway-fixture";
import {
  historicalSale,
  config,
  fixtureId,
} from "../helpers/cards-adversarial-fixture";
import { newId } from "../../src/server/lib/ids";

async function setup() {
  const f = await giveawayFixture();
  const role = (
    await f.pool.query(
      "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  const sale = await historicalSale(f.pool, { state: "photo_pending" });
  const ids = (
    await f.pool.query("SELECT DISTINCT attendant_id FROM assignment")
  ).rows.map((r) => r.attendant_id);
  await f.phones.census(f.token, f.campaignId, {
    operationId: newId(),
    kind: "initial",
    reason: "Fictional two-phone census",
    ...(await f.guard()),
    expectedCensusVersion: 1,
    phones: [
      { label: "Fictional phone A", attendantIds: ids },
      { label: "Fictional phone B", attendantIds: ids },
    ],
  });
  const census = (
    await f.pool.query(
      "SELECT * FROM giveaway_phone_census WHERE campaign_id=$1",
      [f.campaignId],
    )
  ).rows[0];
  const version = (
    await f.pool.query("SELECT version FROM purchase WHERE id=$1", [sale.id])
  ).rows[0].version;
  const a = await f.actor(["sales", "leaderboards", "giveawayFinalize"]);
  const person = newId();
  await f.pool.query(
    "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
    [person, fixtureId(8)],
  );
  await f.pool.query(
    "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,1,true)",
    [newId(), fixtureId(8), a.userId, person],
  );
  const propose = async (index: number) =>
    f.phones.propose(f.token, f.campaignId, census.content.phones[index].id, {
      operationId: newId(),
      kind: "initial",
      reason: "Fictional stranded original",
      ...(await f.guard()),
      expectedCensusVersion: census.version,
      expectedPhoneVersion: 1,
      partialSources: [
        { purchaseId: sale.id, expectedPurchaseVersion: version },
      ],
    });
  const decision = () => ({
    operationId: newId(),
    expectedVersion: 1,
    decision: "approve",
    reason: "Fictional independent review",
  });
  return { f, census, a, propose, decision };
}
it("WHR-179 exact two-phone sequence refuses a second applicable approval and preserves history", async () => {
  const { f, a, propose, decision } = await setup();
  try {
    const first = await propose(0);
    await f.phones.decide(
      a.token,
      f.campaignId,
      String(first.exclusion.id),
      decision(),
    );
    const second = await propose(1); // refresh guard inside propose, exactly as discovery notes
    await expect(
      f.phones.decide(
        a.token,
        f.campaignId,
        String(second.exclusion.id),
        decision(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_phone_exclusion WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (
        await f.pool.query(
          "SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1 ORDER BY version DESC LIMIT 1",
          [first.exclusion.id],
        )
      ).rows[0].state,
    ).toBe("approved");
  } finally {
    await f.close();
  }
}, 30000);
it("WHR-179 concurrent approvals for two phones sharing one original have exactly one winner", async () => {
  const { f, a, propose, decision } = await setup();
  try {
    const first = await propose(0),
      second = await propose(1);
    const results = await Promise.allSettled(
      [first, second].map((p) =>
        f.phones.decide(
          a.token,
          f.campaignId,
          String(p.exclusion.id),
          decision(),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  } finally {
    await f.close();
  }
}, 30000);

it("WHR-179 real HTTP rejects approval, certification and preparation of historical duplicate exclusions with generic errors", async () => {
  const { f, census, a, propose, decision } = await setup();
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  const { handlePhones } =
    await import("../../src/server/modules/giveaway/phone-http");
  const { handleGiveaway } =
    await import("../../src/server/modules/giveaway/http");
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const request = new Request(`${config.origin}${req.url}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
      });
      const [action, id] = req.url!.slice(1).split("/");
      const response =
        action === "prepare" || action === "readiness"
          ? await handleGiveaway(request, action, f.campaignId)
          : await handlePhones(
              request,
              action as "decide" | "certify",
              f.campaignId,
              id,
            );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const post = async (action: string, body: unknown, token = f.token) =>
    fetch(`http://127.0.0.1:${port}/${action}`, {
      method: "POST",
      headers: {
        origin: config.origin,
        "content-type": "application/json",
        cookie: `__Host-whr-admin-session=${token}`,
        "x-test-ip": "198.51.100.30",
      },
      body: JSON.stringify(body),
    });
  try {
    const first = await propose(0);
    await f.phones.decide(
      a.token,
      f.campaignId,
      String(first.exclusion.id),
      decision(),
    );
    const second = await propose(1);
    const denied = await post(
      `decide/${second.exclusion.id}`,
      decision(),
      a.token,
    );
    expect(denied.status).toBe(409);
    expect((await denied.json()).error.message).toBe(
      "This request could not be completed.",
    );
    // Seed the legacy append-only approval using ordinary SQL and enabled native triggers.
    const approved = (
      await f.pool.query(
        "SELECT content FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1 ORDER BY version DESC LIMIT 1",
        [first.exclusion.id],
      )
    ).rows[0].content;
    const pending = (
      await f.pool.query(
        "SELECT content FROM giveaway_phone_exclusion WHERE id=$1",
        [second.exclusion.id],
      )
    ).rows[0].content;
    await f.pool.query(
      "INSERT INTO giveaway_phone_exclusion_transition(id,exclusion_id,version,state,content) VALUES($1,$2,2,'approved',$3)",
      [
        newId(),
        second.exclusion.id,
        {
          ...approved,
          ...pending,
          state: "approved",
          version: 2,
          decidedBy: approved.decidedBy,
          approverPerson: approved.approverPerson,
          decidedAt: approved.decidedAt,
        },
      ],
    );
    const entries = [first, second].map((p, i) => ({
      phoneId: census.content.phones[i].id,
      expectedPhoneVersion: 1,
      result: "unavailable",
      exclusionId: p.exclusion.id,
    }));
    const auditBefore = (
      await f.pool.query("SELECT count(*)::int n FROM audit_event")
    ).rows[0].n;
    const certify = await post("certify", {
      operationId: newId(),
      kind: "initial",
      reason: "Fictional historical duplicate check",
      ...(await f.guard()),
      expectedCensusVersion: census.version,
      entries,
    });
    expect(certify.status).toBe(409);
    expect(
      (await f.pool.query("SELECT count(*)::int n FROM audit_event")).rows[0].n,
    ).toBe(auditBefore);
    expect((await certify.json()).error.message).toBe(
      "This request could not be completed.",
    );
    // A historical check must also fail readiness independently of today's certification guard.
    const checkId = newId(),
      guard = await f.guard();
    const campaign = (
      await f.pool.query("SELECT * FROM campaign WHERE id=$1", [f.campaignId])
    ).rows[0];
    const content = {
      id: checkId,
      manager: { id: fixtureId(5) },
      operationId: newId(),
      auditEventId: census.content.auditEventId,
      campaignId: f.campaignId,
      kind: "initial",
      sourceDataVersion: guard.expectedDataVersion,
      settingsVersionId: guard.expectedSettingsVersionId,
      censusId: census.id,
      designationId: campaign.manager_designation_id,
      previousSnapshotId: null,
      policyVersion: "reconciliation-v1",
    };
    await f.pool.query(
      "INSERT INTO giveaway_phone_check(id,campaign_id,census_id,content,entries) VALUES($1,$2,$3,$4,$5)",
      [
        checkId,
        f.campaignId,
        census.id,
        content,
        JSON.stringify(
          entries.map((e, i) => ({
            ...e,
            phoneVersion: 1,
            attendantIds: census.content.phones[i].attendantIds,
          })),
        ),
      ],
    );
    await f.pool.query(
      "UPDATE campaign SET phone_check_id=$2,version=version+1 WHERE id=$1",
      [f.campaignId, checkId],
    );
    const readyResponse = await fetch(`http://127.0.0.1:${port}/readiness`, {
      headers: {
        cookie: `__Host-whr-admin-session=${f.token}`,
        "x-test-ip": "198.51.100.30",
      },
    });
    expect(readyResponse.status).toBe(200);
    const ready = (await readyResponse.json()).data;
    expect(ready.phoneCheck.state).toBe("stale");
    expect(ready.blockers).toContain("phone_check_required");
    const prepare = await post("prepare", {
      operationId: newId(),
      kind: "initial",
      reason: "Fictional historical duplicate prepare",
      ...(await f.guard()),
    });
    expect(prepare.status).toBe(409);
    expect(
      (await f.pool.query("SELECT count(*)::int n FROM audit_event")).rows[0].n,
    ).toBe(auditBefore);
    expect((await prepare.json()).error.message).toBe(
      "This request could not be completed.",
    );
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_phone_exclusion_transition WHERE state='approved'",
        )
      ).rows[0].n,
    ).toBe(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await (await import("../../src/server/lib/db")).database().end();
    await f.close();
    vi.unstubAllEnvs();
  }
}, 30000);

it("WHR-179 replacing a census retains approved history without blocking a new applicable exclusion", async () => {
  const { f, a, census, propose, decision } = await setup();
  try {
    const first = await propose(0);
    await f.phones.decide(
      a.token,
      f.campaignId,
      String(first.exclusion.id),
      decision(),
    );
    await f.phones.census(f.token, f.campaignId, {
      operationId: newId(),
      kind: "initial",
      reason: "Fictional replacement census",
      ...(await f.guard()),
      expectedCensusVersion: census.version,
      phones: census.content.phones.map(
        (p: { id: string; label: string; attendantIds: string[] }) => ({
          id: p.id,
          label: p.label,
          attendantIds: p.attendantIds,
        }),
      ),
    });
    const old = (
      await f.pool.query(
        "SELECT content FROM giveaway_phone_exclusion WHERE id=$1",
        [first.exclusion.id],
      )
    ).rows[0].content;
    const source = old.partialSources[0];
    const second = await f.phones.propose(
      f.token,
      f.campaignId,
      census.content.phones[1].id,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional new census source",
        ...(await f.guard()),
        expectedCensusVersion: census.version + 1,
        expectedPhoneVersion: 2,
        partialSources: [
          {
            purchaseId: source.purchaseId,
            expectedPurchaseVersion: source.purchaseVersion,
          },
        ],
      },
    );
    await expect(
      f.phones.decide(
        a.token,
        f.campaignId,
        String(second.exclusion.id),
        decision(),
      ),
    ).resolves.toMatchObject({ exclusion: { state: "approved" } });
    expect(
      (
        await f.pool.query(
          "SELECT content FROM giveaway_phone_exclusion WHERE id=$1",
          [first.exclusion.id],
        )
      ).rows[0].content,
    ).toEqual(old);
  } finally {
    await f.close();
  }
}, 30000);
