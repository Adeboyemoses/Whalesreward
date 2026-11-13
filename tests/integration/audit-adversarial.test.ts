import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  cardsFixture,
  config,
  fixtureId as id,
} from "../helpers/cards-adversarial-fixture";
import { phoneTestAdapter } from "../helpers/customer-recovery-fixture";
import { newId } from "../../src/server/lib/ids";
import { issueSession } from "../../src/server/modules/admin-access/sessions";
import { transaction } from "../../src/server/modules/admin-access/repo";
import { stationWrite } from "../../src/server/modules/station/service";
import { cardsWrite } from "../../src/server/modules/cards/service";
import { prepareCardExport } from "../../src/server/modules/cards/exports";
import {
  recoveryRead,
  recoveryWrite,
} from "../../src/server/modules/customers/recovery";
import {
  phoneChallengeSchema,
  recoveryContextSchema,
} from "../../src/shared/contracts/customer-recovery";
import {
  auditEventSchema,
  auditPageSchema,
} from "../../src/shared/contracts/audit";
import {
  auditActor,
  auditSystem,
  writeAudit,
  type AuditWriteInput,
} from "../../src/server/modules/audit/write";
import { readAudit } from "../../src/server/modules/audit/service";
import { handleAudit } from "../../src/server/modules/audit/http";
import { COOKIE } from "../../src/server/modules/admin-access/http";

vi.setConfig({ testTimeout: 30000 });
let f: Awaited<ReturnType<typeof cardsFixture>>, token: string;
const canaries = [
  "08087654321",
  "867493",
  "password=NeverStoreThisPass!",
  "token=NeverStoreThisTokenValue",
  "https://private.example.test/asset?sig=canary",
  "bd".repeat(32),
  "A7K3M9Q",
];
beforeAll(async () => {
  f = await cardsFixture();
  token = await f.owner();
}, 30000);
afterAll(async () => {
  await f?.close();
});
const detail = async (eventId: string) =>
  auditEventSchema.parse(
    await readAudit(f.pool, config, token, "detail", {}, eventId),
  );
const search = async (input: unknown = {}) =>
  auditPageSchema.parse(
    await readAudit(f.pool, config, token, "search", input),
  );
async function legacy(
  action: string,
  kind: string,
  before: unknown,
  after: unknown,
) {
  const eventId = newId();
  await f.pool.query(
    `INSERT INTO audit_event(id,actor_kind,action,target_type,target_id,"before","after",reason,occurred_at,station_id) VALUES($1,'system',$2,$3,$4,$5,$6,$7,clock_timestamp(),$8)`,
    [eventId, action, kind, id(13), before, after, canaries.join(" "), id(8)],
  );
  return eventId;
}
it("I-41 each verified legacy alias projects typed values without changing any stored historical bytes", async () => {
  const cases: [
    string,
    string,
    unknown,
    unknown,
    string,
    Record<string, unknown>,
  ][] = [
    [
      "purchase.cancelled",
      "purchase",
      {},
      { reason: "customer_not_found" },
      "sale_cancelled_unmatched",
      { state: "cancelled", credited: false, creditedSpendKobo: "0" },
    ],
    [
      "purchase.cancelled",
      "purchase",
      {},
      { reason: "different" },
      "legacy_event",
      {},
    ],
    [
      "purchase.credited",
      "purchase",
      {},
      { revisionId: id(20), assetId: id(21) },
      "sale_credited",
      { revisionId: id(20), photoAssetId: id(21) },
    ],
    [
      "purchase.held",
      "purchase",
      {},
      { revisionId: id(20), assetId: id(21) },
      "sale_held",
      {
        candidateRevisionId: id(20),
        revisionId: null,
        credited: false,
        photoAssetId: id(21),
      },
    ],
    [
      "batch_status_changed",
      "card_batch",
      { status: "generated", version: 1 },
      { status: "printed", version: 2 },
      "batch_printed",
      { batchStatus: "printed", batchVersion: "2" },
    ],
    [
      "batch_status_changed",
      "card_batch",
      { status: "printed", version: 2 },
      { status: "active", version: 3 },
      "batch_activated",
      { batchStatus: "active", batchVersion: "3" },
    ],
    [
      "batch_status_changed",
      "card_batch",
      { status: "active" },
      { status: "printed" },
      "legacy_event",
      {},
    ],
    [
      "batch_export_requested",
      "card_batch",
      {},
      { exportId: id(20), format: "xlsx", cardCount: 2 },
      "export_requested",
      { exportId: id(20), exportFormat: "xlsx", recordCount: "2" },
    ],
    [
      "batch_export_prepared",
      "card_batch",
      {},
      { exportId: id(20) },
      "export_prepared",
      { exportId: id(20) },
    ],
    [
      "pump_created",
      "pump",
      {},
      { productId: id(9), version: 2 },
      "pump_created",
      { productId: id(9), pumpVersion: "2" },
    ],
    [
      "attendant_created",
      "attendant",
      {},
      { version: 2 },
      "attendant_created",
      { attendantVersion: "2" },
    ],
    [
      "assignment_changed",
      "attendant",
      {},
      { assignmentId: id(18), pumpId: id(13), version: 2 },
      "assignment_changed",
      { assignmentId: id(18), pumpId: id(13), assignmentVersion: "2" },
    ],
    [
      "price_activated",
      "product",
      {},
      { priceVersionId: id(20), version: 2, rateKobo: "100000" },
      "price_activated",
      { priceVersionId: id(20), priceVersion: "2", rateKobo: "100000" },
    ],
    [
      "customer_registered",
      "customer",
      {},
      { category: "car_owner", cardId: id(29) },
      "customer_registered",
      { customerCategory: "car_owner", cardId: id(29) },
    ],
    [
      "card_replaced",
      "card",
      {},
      {
        customerId: id(26),
        replacementCardId: id(29),
        oldCardCode: canaries[6],
      },
      "card_replaced",
      { customerId: id(26), newCardId: id(29) },
    ],
    [
      "card_replaced",
      "customer",
      {},
      { customerId: id(26), replacementCardId: id(29) },
      "card_replaced",
      { customerId: id(26), newCardId: id(29) },
    ],
    [
      "price_accepted",
      "purchase",
      {},
      {
        reviewPolicy: {
          release: "review-evidence-v1",
          revision: 2,
          digest: canaries[5],
        },
        reviewEvaluationId: id(20),
        reviewConclusions: ["price_valid_throughout"],
      },
      "price_accepted",
      {
        reviewPolicyRelease: "review-evidence-v1",
        reviewPolicyRevision: "2",
        reviewEvaluationId: id(20),
        reviewConclusions: ["price_valid_throughout"],
      },
    ],
    ["card_linked", "card", {}, { cardId: id(29) }, "legacy_event", {}],
    [
      "pump_created",
      "customer",
      {},
      { productId: id(9), version: 2 },
      "legacy_event",
      {},
    ],
  ];
  for (const [action, kind, before, after, mapped, values] of cases) {
    const eventId = await legacy(action, kind, before, {
      ...(after as object),
      privateNote: canaries.join(" "),
    });
    const raw = JSON.stringify(
      (
        await f.pool.query(
          "SELECT row_to_json(a) AS row FROM audit_event a WHERE id=$1",
          [eventId],
        )
      ).rows,
    );
    const event = await detail(eventId);
    expect(event.schemaVersion, action).toBe(0);
    expect(event.action, action).toBe(mapped);
    expect(event.target.kind, action).toBe(kind);
    expect(
      Object.fromEntries(event.changes.map((c) => [c.field, c.after])),
      action,
    ).toEqual(values);
    if (mapped === "legacy_event")
      expect(event.reason).toBe("Historical event");
    for (const value of canaries)
      expect(JSON.stringify(event), action).not.toContain(value);
    expect(
      JSON.stringify(
        (
          await f.pool.query(
            "SELECT row_to_json(a) AS row FROM audit_event a WHERE id=$1",
            [eventId],
          )
        ).rows,
      ),
    ).toBe(raw);
  }
});
it("I-41 actual audit HTTP list detail and rejected requests never emit seeded private values to responses search or logs", async () => {
  const eventId = await legacy(
    "unknown_action",
    "pump",
    {},
    { privateNote: canaries.join(" ") },
  );
  const stdout = vi.spyOn(process.stdout, "write"),
    stderr = vi.spyOn(process.stderr, "write");
  const responses: string[] = [];
  const request = (body: unknown) =>
    new Request(`${config.origin}/api/admin/audit/search`, {
      method: "POST",
      headers: {
        origin: config.origin,
        "content-type": "application/json",
        cookie: `${COOKIE}=${token}`,
        "x-test-ip": "audit-canary",
      },
      body: JSON.stringify(body),
    });
  try {
    // Exercise actual domain snapshot redaction, not an empty storage assertion.
    for (const value of canaries)
      await cardsWrite(f.pool, config, token, "create", {
        operationId: newId(),
        name: `Audit ${value}`,
        count: 1,
      });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM audit_event WHERE schema_version=1",
        )
      ).rows[0].n,
    ).toBeGreaterThanOrEqual(canaries.length);
    const list = await handleAudit(request({}), "search");
    expect(list.status).toBe(200);
    responses.push(await list.text());
    const item = await handleAudit(
      new Request(`${config.origin}/api/admin/audit/${eventId}`, {
        headers: { cookie: `${COOKIE}=${token}`, "x-test-ip": "audit-canary" },
      }),
      "detail",
      eventId,
    );
    expect(item.status).toBe(200);
    responses.push(await item.text());
    for (const value of canaries) {
      const filtered = await handleAudit(request({ query: value }), "search");
      expect(filtered.status).toBe(200);
      const result = await filtered.json();
      expect(result.data.items).toEqual([]);
      responses.push(JSON.stringify(result));
      const rejected = await handleAudit(
        request({ password: value }),
        "search",
      );
      expect(rejected.status).toBe(400);
      responses.push(await rejected.text());
    }
    const persisted = JSON.stringify(
      (
        await f.pool.query(
          "SELECT row_to_json(a) AS row FROM audit_event a WHERE schema_version=1",
        )
      ).rows,
    );
    for (const value of canaries) {
      expect(responses.join(" ")).not.toContain(value);
      expect(JSON.stringify(stdout.mock.calls)).not.toContain(value);
      expect(JSON.stringify(stderr.mock.calls)).not.toContain(value);
      expect(persisted).not.toContain(value);
    }
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
});
it("I-41 conditional review and decision fields are rejected atomically rather than partially persisted", async () => {
  const actor = await transaction(f.pool, (db) => auditActor(db, id(2)));
  const V = {
    amountKobo: "100000",
    quantity: "1",
    currency: "NGN",
    unit: "litre",
    basis: "amount",
    medium: "vehicle",
    rateKobo: "100000",
    priceVersionId: id(20),
    revisionId: null,
    credited: false,
    calculation: "captured_rate",
  };
  const G = {
    state: "held",
    holdKinds: ["price"],
    policyBlocks: [],
    creditedSpendKobo: "0",
  };
  const R = {
    reviewPolicyRelease: "review-evidence-v1",
    reviewPolicyRevision: "1",
    reviewEvaluationId: id(20),
    reviewConclusions: ["price_valid_throughout"],
  };
  const base: AuditWriteInput = {
    stationId: id(8),
    action: "price_accepted",
    actor,
    target: {
      kind: "purchase",
      id: id(13),
      code: "SALE001",
      subjectAtEvent: null,
    },
    reason: "Price reviewed",
    before: null,
    after: {
      ...V,
      ...G,
      decisionId: id(20),
      outcome: "accept_captured",
      candidateRevisionId: id(21),
    },
  };
  const accepted: AuditWriteInput[] = [
    base,
    { ...base, after: { ...base.after, ...R } },
    {
      ...base,
      action: "correction_rejected",
      actor: auditSystem("validation"),
      after: { ...V, correctionState: "rejected" },
    },
    {
      ...base,
      action: "correction_rejected",
      after: {
        ...V,
        correctionState: "rejected",
        decisionId: id(20),
        outcome: "reject",
      },
    },
  ];
  for (const input of accepted) {
    const eventId = await transaction(f.pool, (db) => writeAudit(db, input));
    expect((await detail(eventId)).action).toBe(input.action);
  }
  const invalid: AuditWriteInput[] = [
    {
      ...base,
      after: { ...base.after, reviewPolicyRelease: "review-evidence-v1" },
    },
    {
      ...base,
      action: "correction_rejected",
      after: { ...V, correctionState: "rejected" },
    },
    {
      ...base,
      action: "correction_rejected",
      actor: auditSystem("validation"),
      after: {
        ...V,
        correctionState: "rejected",
        decisionId: id(20),
        outcome: "reject",
      },
    },
    {
      ...base,
      action: "price_corrected",
      after: {
        ...base.after,
        ...R,
        outcome: "correct_meter",
        meterPolicyRelease: "meter-reconciliation-v1",
      },
    },
  ];
  const count = (await f.pool.query("SELECT count(*)::int n FROM audit_event"))
    .rows[0].n;
  for (const input of invalid)
    await expect(
      transaction(f.pool, (db) => writeAudit(db, input)),
    ).rejects.toThrow();
  expect(
    (await f.pool.query("SELECT count(*)::int n FROM audit_event")).rows[0].n,
  ).toBe(count);
});
it("I-41 a genuine cursor from another station database cannot authorize a page", async () => {
  // Build another independent station database identity; do not mutate any history.
  const schema = `audit_other_${randomBytes(6).toString("hex")}`,
    station = newId();
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  const other = new pg.Pool({ connectionString: url.toString(), max: 2 });
  await f.pool.query(`CREATE SCHEMA ${schema}`);
  try {
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const dir of (await readdir(migrations, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await other.query(
        await readFile(
          new URL(`${dir.name}/migration.sql`, migrations),
          "utf8",
        ),
      );
    await other.query(
      (
        await readFile(
          new URL("../../prisma/fixtures.sql", import.meta.url),
          "utf8",
        )
      ).replaceAll(id(8), station),
    );
    await other.query("UPDATE auth_user SET must_change_password=false");
    const otherToken = await transaction(
      other,
      async (db) => (await issueSession(db, config, id(2))).token,
    );
    const page = await search({ limit: 1 });
    expect(page.nextCursor).not.toBeNull();
    await expect(
      readAudit(other, config, otherToken, "search", {
        limit: 1,
        cursor: page.nextCursor,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  } finally {
    await other.end();
    await f.pool.query(`DROP SCHEMA ${schema} CASCADE`);
  }
});
const storage = {
  async write() {},
  async read() {
    return new Uint8Array([1]);
  },
};
const layout = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  cardWidthMm: 85.6,
  cardHeightMm: 54,
  marginMm: 10,
  gapMm: 2,
};
it("I-41 revoked export creators and missing PDF configuration each emit one fenced terminal event under concurrent retries", async () => {
  for (const mode of ["revoked", "configuration"] as const) {
    const creator = await f.actor(["cards", "cardExport", "cardGenerate"]);
    const batch = (
      await cardsWrite(f.pool, config, creator.token, "create", {
        operationId: newId(),
        name: "Audit export",
        count: 1,
      })
    ).data as { id: string; version: number };
    const operationId = newId();
    const output = (
      await cardsWrite(
        f.pool,
        config,
        creator.token,
        "export",
        {
          operationId,
          expectedVersion: batch.version,
          format: mode === "configuration" ? "pdf" : "xlsx",
        },
        batch.id,
        { layout },
      )
    ).data as { id: string };
    if (mode === "revoked")
      await f.pool.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='cardExport'",
        [creator.roleId],
      );
    const render = vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      contentType: "application/octet-stream",
      extension: "xlsx" as const,
    }));
    await Promise.all([
      prepareCardExport(f.pool, { storage, render }, output.id),
      prepareCardExport(f.pool, { storage, render }, output.id),
    ]);
    await prepareCardExport(f.pool, { storage, render }, output.id);
    expect(render).not.toHaveBeenCalled();
    const events = (
      await f.pool.query(
        "SELECT * FROM audit_event WHERE operation_id=$1 ORDER BY occurred_at,id",
        [operationId],
      )
    ).rows;
    expect(events.map((r) => r.action)).toEqual([
      "export_requested",
      "export_failed",
    ]);
    expect(events[1].actor_snapshot).toMatchObject({
      kind: "system",
      service: "export",
    });
    expect(
      (
        await f.pool.query("SELECT status FROM card_export WHERE id=$1", [
          output.id,
        ])
      ).rows[0].status,
    ).toBe("failed");
  }
});
it("I-41 failed delivery wrong codes and expiry preserve issued audit without inventing verified events", async () => {
  const customerId = id(26),
    h = phoneTestAdapter(f.pool);
  const expiring = {
    ...h.adapter,
    policy: { ...h.adapter.policy, lifetimeMs: 1500 },
  };
  const context = recoveryContextSchema.parse(
    await recoveryRead(f.pool, config, token, "context", customerId),
  );
  const failedOperation = newId();
  const broken = {
    ...h.adapter,
    async request() {
      throw new Error(canaries.join(" "));
    },
  };
  await expect(
    recoveryWrite(
      f.pool,
      config,
      token,
      "issue",
      customerId,
      {
        operationId: failedOperation,
        expectedVersion: context.customerVersion,
      },
      { adapter: broken, ip: "audit-delivery" },
    ),
  ).rejects.toMatchObject({ code: "delivery_unavailable" });
  expect(
    (
      await f.pool.query(
        "SELECT action FROM audit_event WHERE operation_id=$1",
        [failedOperation],
      )
    ).rows,
  ).toEqual([{ action: "card_verification_issued" }]);
  const pending = phoneChallengeSchema.parse(
    await recoveryWrite(
      f.pool,
      config,
      token,
      "issue",
      customerId,
      { operationId: newId(), expectedVersion: context.customerVersion },
      { adapter: expiring, ip: "audit-delivery" },
    ),
  );
  const sent = phoneChallengeSchema.parse(
    await recoveryRead(
      f.pool,
      config,
      token,
      "challenge",
      customerId,
      {},
      pending.id,
    ),
  );
  const wrongOperation = newId();
  await expect(
    recoveryWrite(
      f.pool,
      config,
      token,
      "verify",
      customerId,
      {
        operationId: wrongOperation,
        expectedVersion: context.customerVersion,
        expectedChallengeVersion: sent.version,
        code: "wrong-code",
      },
      { adapter: expiring, ip: "audit-delivery" },
      sent.id,
    ),
  ).rejects.toMatchObject({ code: "verification_unavailable" });
  await new Promise((resolve) =>
    setTimeout(
      resolve,
      Math.max(0, new Date(sent.expiresAt).getTime() - Date.now()) + 50,
    ),
  );
  const latest = phoneChallengeSchema.parse(
    await recoveryRead(
      f.pool,
      config,
      token,
      "challenge",
      customerId,
      {},
      sent.id,
    ),
  );
  const expiredOperation = newId();
  await expect(
    recoveryWrite(
      f.pool,
      config,
      token,
      "verify",
      customerId,
      {
        operationId: expiredOperation,
        expectedVersion: context.customerVersion,
        expectedChallengeVersion: latest.version,
        code: h.code(sent.id),
      },
      { adapter: expiring, ip: "audit-delivery" },
      sent.id,
    ),
  ).rejects.toMatchObject({ code: "verification_unavailable" });
  expect(
    (
      await f.pool.query(
        "SELECT id FROM audit_event WHERE operation_id=ANY($1::uuid[])",
        [[wrongOperation, expiredOperation]],
      )
    ).rows,
  ).toEqual([]);
  const data = JSON.stringify(
    (
      await f.pool.query(
        "SELECT row_to_json(a) FROM audit_event a WHERE schema_version=1",
      )
    ).rows,
  );
  for (const value of [...canaries, h.code(sent.id)])
    expect(data).not.toContain(value);
});
it("I-07 both audit reads deny first-password and sales-only sessions and immediately reject a disabled audit account", async () => {
  const eventId = await legacy("unknown_action", "pump", {}, {});
  const restricted = await f.actor(["audit"], true),
    narrow = await f.actor(["sales", "customers"]),
    enabled = await f.actor(["audit"]);
  for (const action of ["search", "detail"] as const) {
    await expect(
      readAudit(f.pool, config, restricted.token, action, {}, eventId),
    ).rejects.toMatchObject({ code: "password_change_required" });
    await expect(
      readAudit(f.pool, config, narrow.token, action, {}, eventId),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      readAudit(f.pool, config, enabled.token, action, {}, eventId),
    ).resolves.toBeDefined();
  }
  await f.pool.query(
    "UPDATE auth_user SET enabled=false,auth_version=auth_version+1 WHERE id=$1",
    [enabled.userId],
  );
  for (const action of ["search", "detail"] as const)
    await expect(
      readAudit(f.pool, config, enabled.token, action, {}, eventId),
    ).rejects.toMatchObject({ code: "unauthenticated" });
});
it("I-41 initial reassigned and ended assignment audits preserve exact boundaries and immutable openings across receipt replay", async () => {
  const create = {
    operationId: newId(),
    name: "Favour James",
    username: "audit.favour",
    password: canaries[2]!,
    pumpId: id(14),
    expectedPumpVersion: 1,
  };
  const initial = (await stationWrite(
    f.pool,
    config,
    token,
    "attendants-create",
    create,
  )) as { id: string; version: number; assignment: { id: string } };
  await stationWrite(f.pool, config, token, "attendants-create", create);
  const initialEvents = (
    await f.pool.query(
      "SELECT * FROM audit_event WHERE operation_id=$1 ORDER BY action",
      [create.operationId],
    )
  ).rows;
  expect(initialEvents.map((r) => r.action)).toEqual([
    "assignment_changed",
    "attendant_created",
  ]);
  const reassign = {
    operationId: newId(),
    expectedVersion: initial.version,
    expectedAssignmentId: initial.assignment.id,
    pumpId: id(15),
    expectedPumpVersion: 1,
    reason: "Pump reassignment",
  };
  const reassigned = (await stationWrite(
    f.pool,
    config,
    token,
    "attendants-assignment",
    reassign,
    initial.id,
  )) as { attendant: { version: number; assignment: { id: string } } };
  await stationWrite(
    f.pool,
    config,
    token,
    "attendants-assignment",
    reassign,
    initial.id,
  );
  const openings = (
    await f.pool.query(
      "SELECT row_to_json(a) AS row FROM audit_event a WHERE target_id=$1 AND action='assignment_changed' ORDER BY occurred_at,id",
      [initial.id],
    )
  ).rows;
  expect(openings).toHaveLength(2);
  expect(
    (
      await f.pool.query(
        "SELECT bool_and(a.occurred_at=h.effective_from AND (a.after->>'effectiveFrom')::timestamptz=h.effective_from) AS exact FROM audit_event a JOIN assignment h ON h.id=(a.after->>'assignmentId')::uuid WHERE a.target_id=$1 AND a.action='assignment_changed'",
        [initial.id],
      )
    ).rows[0].exact,
  ).toBe(true);
  const end = {
    operationId: newId(),
    expectedVersion: reassigned.attendant.version,
    expectedAssignmentId: reassigned.attendant.assignment.id,
    reason: "Shift assignment ended",
  };
  await stationWrite(
    f.pool,
    config,
    token,
    "attendants-assignment-end",
    end,
    initial.id,
  );
  await stationWrite(
    f.pool,
    config,
    token,
    "attendants-assignment-end",
    end,
    initial.id,
  );
  const ended = (
    await f.pool.query("SELECT * FROM audit_event WHERE operation_id=$1", [
      end.operationId,
    ])
  ).rows;
  expect(ended).toHaveLength(1);
  expect(
    ended[0].changes.map((c: { field: string }) => c.field).sort(),
  ).toEqual([
    "assignmentId",
    "attendantVersion",
    "authVersion",
    "effectiveUntil",
    "pumpId",
  ]);
  expect(ended[0].after.assignmentId).toBeNull();
  expect(ended[0].after.pumpId).toBeNull();
  expect(
    (
      await f.pool.query(
        "SELECT a.occurred_at=h.effective_until AND (a.after->>'effectiveUntil')::timestamptz=h.effective_until AS exact FROM audit_event a JOIN assignment h ON h.id=(a.before->>'assignmentId')::uuid WHERE a.id=$1",
        [ended[0].id],
      )
    ).rows[0].exact,
  ).toBe(true);
  expect(
    (
      await f.pool.query(
        "SELECT row_to_json(a) AS row FROM audit_event a WHERE target_id=$1 AND action='assignment_changed' ORDER BY occurred_at,id",
        [initial.id],
      )
    ).rows,
  ).toEqual(openings);
  const raw = JSON.stringify(
    (
      await f.pool.query(
        "SELECT row_to_json(a) AS row FROM audit_event a WHERE target_id=$1",
        [initial.id],
      )
    ).rows,
  );
  expect(raw).not.toContain(create.password);
});
