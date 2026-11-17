import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { giveawayFixture } from "../helpers/giveaway-fixture";
import {
  config,
  fixtureId,
  historicalSale,
  cardsFixture,
} from "../helpers/cards-adversarial-fixture";
import { readProjection } from "../../src/server/modules/giveaway/projections";
import { handleProjection } from "../../src/server/modules/giveaway/projection-http";
import {
  checkNames,
  checklistProjectionSchema,
  managerSelectionSchema,
  attendantSelectionSchema,
  phoneSelectionSchema,
  incompleteSelectionSchema,
  storedChecklistSchema,
} from "../../src/shared/contracts/giveaway-projections";
import { readReadiness } from "../../src/server/modules/giveaway/service";
import { prepareGiveaway } from "../../src/server/modules/giveaway/mutations";
import { newId } from "../../src/server/lib/ids";
import { COOKIE } from "../../src/server/modules/admin-access/http";
import type { ProjectionAction } from "../../src/server/modules/giveaway/projection-context";
let f: Awaited<ReturnType<typeof giveawayFixture>>,
  server: Server,
  origin: string,
  ip = 1;
const read = (
  action: ProjectionAction,
  input: unknown = {},
  id?: string,
  token = f.token,
) =>
  readProjection(f.pool, config.secret, token, f.campaignId, action, id, input);
beforeAll(async () => {
  f = await giveawayFixture();
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost"),
      parts = url.pathname.split("/").filter(Boolean),
      campaign = parts[3]!,
      suffix = parts.slice(5);
    const action = (
      suffix[0] === "selection"
        ? suffix[3] === "incomplete-sources"
          ? "incomplete-sources"
          : suffix[1]
        : suffix[0]
    ) as ProjectionAction;
    const id =
      action === "results"
        ? suffix[1]
        : action === "incomplete-sources"
          ? suffix[2]
          : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (v) headers.set(k, Array.isArray(v) ? v.join(",") : v);
    const response = await handleProjection(
      new Request(`http://localhost${req.url}`, {
        headers,
        method: req.method,
      }),
      action,
      campaign,
      id,
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await f?.close();
});
async function http(suffix: string, token = f.token) {
  const r = await fetch(
    `${origin}/api/admin/giveaway/${f.campaignId}/reconciliation/${suffix}`,
    {
      headers: { cookie: `${COOKIE}=${token}`, "x-test-ip": `192.0.2.${ip++}` },
    },
  );
  return { status: r.status, headers: r.headers, body: await r.json() };
}
async function makeOwner(adminId: string) {
  const role = newId();
  await f.pool.query(
    "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,true,true,1)",
    [role, `Fictional owner ${role}`],
  );
  await f.pool.query(
    "INSERT INTO role_permission(role_id,permission_code) SELECT $1,permission_code FROM role_permission WHERE role_id=(SELECT role_id FROM admin WHERE id=$2)",
    [role, adminId],
  );
  await f.pool.query(
    "UPDATE admin SET role_id=$2,version=version+1 WHERE id=$1",
    [adminId, role],
  );
}
it("T-21 live checklist preserves grouped readiness and returns all nine ordered outcomes", async () => {
  const result = checklistProjectionSchema.parse(await read("checklist"));
  expect(result.checks.map((r) => r.name)).toEqual(checkNames);
  const grouped = await readReadiness(f.pool, f.token, f.campaignId);
  expect(result.readiness.blockers).toEqual(grouped.blockers);
  expect(result.readiness.counts).toEqual(grouped.counts);
  expect(result.checks.find((r) => r.name === "uploads")?.outcome).toBe(
    "not_applicable",
  );
  expect(result.checks.find((r) => r.name === "phone_census")?.outcome).toBe(
    "unresolved",
  );
});
it("T-21 policy missing differs from zero and not_applicable without synthesizing a pass", async () => {
  const originalUrl = process.env.DATABASE_URL;
  const unconfigured = await cardsFixture();
  try {
    const campaign = newId(),
      token = await unconfigured.owner();
    await unconfigured.pool.query(
      "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional unconfigured',1,true)",
      [campaign, fixtureId(8)],
    );
    const result = checklistProjectionSchema.parse(
      await readProjection(
        unconfigured.pool,
        config.secret,
        token,
        campaign,
        "checklist",
      ),
    );
    for (const name of ["uploads", "complete_photo_deadline", "phone_census"]) {
      const r = result.checks.find((r) => r.name === name)!;
      expect(r.outcome).toBe("unresolved");
      expect(r.reasonCodes).toContain("policy_missing");
      expect(r.blocking).toBeNull();
    }
    expect(result.checks.find((r) => r.name === "holds")?.blocking).toBe("0");
  } finally {
    await unconfigured.close();
    process.env.DATABASE_URL = originalUrl;
  }
});
it("T-21 Owner with settings and sales but no leaderboards sees current designation and eligible choices without directory grants", async () => {
  const a = await f.actor(["settings", "sales"]);
  await makeOwner(a.adminId);
  const result = managerSelectionSchema.parse(
    await read("managers", {}, undefined, a.token),
  );
  expect(result.currentDesignation?.manager.adminId).toBe(fixtureId(5));
  expect(result.items.some((r) => r.adminId === fixtureId(5))).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(
    /personId|bindingId|email|phone_number|permissions/,
  );
});
it("T-21 Owner without settings or sales and readers without action grants are denied", async () => {
  for (const permissions of [["settings"], ["sales"], ["leaderboards"]]) {
    const a = await f.actor(permissions);
    await makeOwner(a.adminId);
    await expect(
      read("managers", {}, undefined, a.token),
    ).rejects.toMatchObject({ code: "permission_denied" });
  }
  const a = await f.actor(["sales", "settings"]);
  await expect(read("managers", {}, undefined, a.token)).rejects.toMatchObject({
    code: "owner_required",
  });
  const b = await f.actor(["sales", "leaderboards"]);
  await expect(
    read("attendants", {}, undefined, b.token),
  ).rejects.toMatchObject({ code: "permission_denied" });
});
it("T-21 checklist without sales exposes aggregate outcomes and omits protected links and fields", async () => {
  const a = await f.actor(["leaderboards"]),
    result = checklistProjectionSchema.parse(
      await read("checklist", {}, undefined, a.token),
    );
  expect(
    result.checks.every(
      (r) => r.access === "restricted" && r.links.length === 0,
    ),
  ).toBe(true);
  expect(JSON.stringify(result.checks)).not.toMatch(
    /purchaseId|attendantId|phoneId|display_name|reason:/,
  );
  await expect(read("results", {}, newId(), a.token)).rejects.toMatchObject({
    code: "permission_denied",
  });
});
it("T-21 stable tokens ignore asOf but invalidate on renamed identities outside campaign generation", async () => {
  const before = managerSelectionSchema.parse(await read("managers")),
    again = managerSelectionSchema.parse(await read("managers"));
  expect(again.view.viewToken).toBe(before.view.viewToken);
  await f.pool.query(
    "UPDATE auth_user SET display_name='Ada Updated' WHERE id=$1",
    [fixtureId(2)],
  );
  await expect(
    read("managers", { expectedView: before.view.viewToken }),
  ).rejects.toMatchObject({ code: "read_view_stale" });
});
it("T-21 current designation remains visible when manager role becomes ineligible", async () => {
  const a = await f.actor(["settings", "sales"]);
  await makeOwner(a.adminId);
  const role = (
    await f.pool.query("SELECT role_id FROM admin WHERE id=$1", [fixtureId(5)])
  ).rows[0].role_id;
  await f.pool.query(
    "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='giveawayFinalize'",
    [role],
  );
  const result = managerSelectionSchema.parse(
    await read("managers", {}, undefined, a.token),
  );
  expect(result.currentDesignation?.manager.adminId).toBe(fixtureId(5));
  expect(result.items.some((r) => r.adminId === fixtureId(5))).toBe(false);
  await f.pool.query(
    "INSERT INTO role_permission(role_id,permission_code) VALUES($1,'giveawayFinalize')",
    [role],
  );
});
it("T-21 conservative required accounts retain disabled staff and ended assignments", async () => {
  await f.pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
    fixtureId(3),
  ]);
  await f.pool.query(
    "UPDATE assignment SET effective_until=clock_timestamp() WHERE id=$1",
    [fixtureId(18)],
  );
  const result = attendantSelectionSchema.parse(await read("attendants"));
  expect(
    result.items.find((r) => r.attendantId === fixtureId(6)),
  ).toMatchObject({
    enabled: false,
    hasCurrentAssignment: false,
    required: true,
  });
});
it("T-21 inventory selection requires named manager and verified canonical person", async () => {
  const a = await f.actor(["sales", "leaderboards", "giveawayFinalize"]);
  await expect(read("phones", {}, undefined, a.token)).rejects.toMatchObject({
    code: "permission_denied",
  });
  const old = (
    await f.pool.query(
      "SELECT * FROM held_release_person_binding WHERE user_id=$1 ORDER BY version DESC LIMIT 1",
      [fixtureId(2)],
    )
  ).rows[0];
  await f.pool.query(
    "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,$5,false)",
    [newId(), fixtureId(8), fixtureId(2), old.person_id, old.version + 1],
  );
  await expect(read("phones")).rejects.toMatchObject({
    code: "independent_admin_required",
  });
  await f.pool.query(
    "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,$5,true)",
    [newId(), fixtureId(8), fixtureId(2), old.person_id, old.version + 2],
  );
});
it("T-21 all six routes traverse real HTTP with strict envelopes no-store and typed history", async () => {
  await f.check();
  const prepared = await prepareGiveaway(f.pool, f.token, f.campaignId, {
    operationId: newId(),
    kind: "initial",
    reason: "Fictional projection history",
    ...(await f.guard()),
  });
  const resultId = prepared.data.reconciliationId;
  const phonePage = phoneSelectionSchema.parse(await read("phones"));
  const phoneId = phonePage.items[0]!.id;
  for (const [suffix, schema] of [
    ["checklist", checklistProjectionSchema],
    [`results/${resultId}`, storedChecklistSchema],
    ["selection/managers", managerSelectionSchema],
    ["selection/attendants", attendantSelectionSchema],
    ["selection/phones", phoneSelectionSchema],
    [
      `selection/phones/${phoneId}/incomplete-sources`,
      incompleteSelectionSchema,
    ],
  ] as const) {
    const r = await http(suffix);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(schema.safeParse(r.body.data).success).toBe(true);
  }
});
it("T-21 malformed queries foreign parents and forged cursors fail without details", async () => {
  for (const suffix of [
    "checklist?kind=initial",
    "selection/managers?limit=0",
    "selection/phones?limit=1&limit=2",
    "selection/attendants?cursor=forged",
  ]) {
    const r = await http(suffix);
    expect(r.status).toBe(400);
    expect(r.body.error.retryable).toBe(false);
  }
  expect((await http(`results/${newId()}`)).status).toBe(404);
  expect(
    (await http(`selection/phones/${newId()}/incomplete-sources`)).status,
  ).toBe(404);
});
it("T-21 reads do not create business audits receipts or clear dirty state", async () => {
  const before = (
    await f.pool.query(
      "SELECT (SELECT count(*) FROM audit_event)::text audits,(SELECT count(*) FROM mutation_receipt)::text receipts,reconciliation_required FROM campaign WHERE id=$1",
      [f.campaignId],
    )
  ).rows[0];
  await read("checklist");
  await read("managers");
  await read("attendants");
  await read("phones");
  const after = (
    await f.pool.query(
      "SELECT (SELECT count(*) FROM audit_event)::text audits,(SELECT count(*) FROM mutation_receipt)::text receipts,reconciliation_required FROM campaign WHERE id=$1",
      [f.campaignId],
    )
  ).rows[0];
  expect(after).toEqual(before);
});
it("T-21 incomplete sources include received and photo_pending originals but exclude finalizing held accepted and cancelled", async () => {
  const yes = [];
  for (const state of [
    "received",
    "photo_pending",
    "finalizing",
    "held",
    "credited",
    "cancelled",
  ] as const) {
    const sale = await historicalSale(f.pool, { state });
    if (["received", "photo_pending"].includes(state)) yes.push(sale.id);
  }
  const phone = phoneSelectionSchema.parse(await read("phones")).items[0]!;
  const result = incompleteSelectionSchema.parse(
    await read("incomplete-sources", {}, phone.id),
  );
  expect(result.items.map((r) => r.purchaseId)).toEqual(yes.sort());
  expect(
    result.items.every(
      (r) =>
        !r.everAccepted &&
        !r.hasTrustedByteObservation &&
        !r.hasCompletePhotoFact,
    ),
  ).toBe(true);
  expect(JSON.stringify(result.items)).not.toMatch(
    /customerId|cardCode|photoAssetId|digest|staging|final_key/,
  );
});
it("T-21 stored historical pass retains counts after later mutations and differs from live outcomes", async () => {
  const id = (
    await f.pool.query("SELECT reconciliation_id FROM campaign WHERE id=$1", [
      f.campaignId,
    ])
  ).rows[0].reconciliation_id;
  const stored = storedChecklistSchema.parse(await read("results", {}, id));
  const original = structuredClone(stored);
  await historicalSale(f.pool, { state: "photo_pending" });
  expect(await read("results", {}, id)).toEqual(original);
  expect(stored.historical).toBe(true);
  expect(stored.checks.every((c) => c.result === "clear")).toBe(true);
  const live = checklistProjectionSchema.parse(await read("checklist"));
  expect(live.checks.find((c) => c.name === "phone_census")?.outcome).toBe(
    "unresolved",
  );
  expect(live.latestStoredResultId).toBe(id);
  expect(JSON.stringify(stored)).not.toMatch(
    /sourceDigest|operationId|actorId|personId|bindingId/,
  );
});
