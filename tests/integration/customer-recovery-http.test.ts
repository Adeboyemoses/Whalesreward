import { beforeAll, afterAll, expect, it } from "vitest";
import {
  cardsFixture,
  config,
  fixtureId,
} from "../helpers/cards-adversarial-fixture";
import { newId } from "../../src/server/lib/ids";
import { handleCustomerRecovery } from "../../src/server/modules/customers/recovery-http";
import { COOKIE } from "../../src/server/modules/admin-access/http";
import {
  recoveryRead,
  recoveryWrite,
} from "../../src/server/modules/customers/recovery";
import {
  recoveryContextSchema,
  managerCaseViewSchema,
} from "../../src/shared/contracts/customer-recovery";
let f: Awaited<ReturnType<typeof cardsFixture>>, token: string;
let n = 1;
beforeAll(async () => {
  f = await cardsFixture();
  token = await f.owner();
});
afterAll(async () => f?.close());
async function http(
  action: Parameters<typeof handleCustomerRecovery>[1],
  options: {
    token?: string;
    body?: unknown;
    raw?: string;
    query?: string;
    id?: string;
    target?: string;
    origin?: string;
    method?: string;
  } = {},
) {
  const body =
    options.raw ??
    (options.body === undefined ? undefined : JSON.stringify(options.body));
  const headers = new Headers({
    origin: options.origin ?? config.origin,
    "x-test-ip": `192.0.2.${n++}`,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (options.token) headers.set("cookie", `${COOKIE}=${options.token}`);
  const response = await handleCustomerRecovery(
    new Request(
      `${config.origin}/api/admin/customers/example${options.query ?? ""}`,
      {
        method: options.method ?? (body === undefined ? "GET" : "POST"),
        headers,
        body,
      },
    ),
    action,
    options.id ?? fixtureId(26),
    options.target,
  );
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}
it("checks full current sessions and the customers/recovery conjunction", async () => {
  expect((await http("context")).status).toBe(401);
  for (const permissions of [
    [],
    ["customers"],
    ["recovery"],
    ["customers", "managerRecovery"],
  ]) {
    const a = await f.actor(permissions);
    expect((await http("context", { token: a.token })).status).toBe(403);
  }
  const first = await f.actor(["customers", "recovery"], true);
  expect((await http("context", { token: first.token })).body.error.code).toBe(
    "password_change_required",
  );
  const a = await f.actor(["customers", "recovery"]);
  expect((await http("context", { token: a.token })).status).toBe(200);
  await f.pool.query(
    "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='recovery'",
    [a.roleId],
  );
  expect((await http("context", { token: a.token })).status).toBe(403);
});
it("fails closed before issuance and retains the strict no-store error envelope", async () => {
  const result = await http("issue", {
    token,
    body: { operationId: newId(), expectedVersion: 1 },
  });
  expect(result.status).toBe(409);
  expect(result.body.error).toEqual({
    code: "phone_verification_unconfigured",
    message: "This request could not be completed.",
    retryable: false,
  });
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(
    (
      await f.pool.query(
        "SELECT 1 FROM verification_challenge WHERE purpose='replace_card'",
      )
    ).rowCount,
  ).toBe(0);
});
it("rejects Origin, oversized/malformed bodies, extra fields, missing attestation and malformed routes", async () => {
  const base = { operationId: newId(), expectedVersion: 1 };
  expect(
    (
      await http("issue", {
        token,
        body: base,
        origin: "https://foreign.example.com",
      })
    ).status,
  ).toBe(403);
  expect((await http("issue", { token, raw: "[" })).status).toBe(400);
  expect((await http("issue", { token, raw: " ".repeat(32769) })).status).toBe(
    413,
  );
  expect(
    (
      await http("issue", {
        token,
        body: { ...base, destination: "forbidden" },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await http("phone-change", {
        token,
        body: {
          ...base,
          newPhone: "08019990001",
          activeCardCode: "A7K3M9Q",
          expectedCardVersion: 2,
          reason: "Card inspected",
        },
      })
    ).status,
  ).toBe(400);
  expect((await http("context", { token, id: "invalid" })).status).toBe(400);
  expect((await http("context", { token, id: newId() })).status).toBe(404);
  expect((await http("context", { token, query: "?extra=true" })).status).toBe(
    400,
  );
});
it("intake is protected, accepts manager read but never manager-only intake, and rejects sensitive notes", async () => {
  const reader = await f.actor(["customers", "managerRecovery"]);
  const body = {
    operationId: newId(),
    expectedVersion: 1,
    customerPresent: true,
    reason: "Customer cannot receive OTP",
    verificationNotes: "Passport inspected in person",
  };
  expect(
    (await http("case-create", { token: reader.token, body })).status,
  ).toBe(403);
  expect(
    (
      await http("case-create", {
        token,
        body: { ...body, verificationNotes: "Passport number A1234567" },
      })
    ).status,
  ).toBe(400);
  const created = await http("case-create", { token, body });
  expect(created.status).toBe(201);
  const entry = managerCaseViewSchema.parse(created.body.data);
  expect(
    (await http("case", { token: reader.token, target: entry.id })).status,
  ).toBe(200);
  expect(
    (
      await http("case", {
        token: reader.token,
        target: entry.id,
        id: fixtureId(27),
      })
    ).status,
  ).toBe(404);
  expect(
    (await http("cases", { token: reader.token })).body.data.items,
  ).toHaveLength(1);
  expect(
    (
      await http("case-create", {
        token,
        body: { ...body, operationId: newId() },
      })
    ).body.error.code,
  ).toBe("case_already_open");
  expect(
    recoveryContextSchema.parse(
      await recoveryRead(f.pool, config, token, "context", fixtureId(26)),
    ).customerVersion,
  ).toBe(1);
});
it("history is masked and cursor binds customer, actor and action", async () => {
  const id = fixtureId(26);
  for (let index = 0; index < 2; index++) {
    const ctx = recoveryContextSchema.parse(
      await recoveryRead(f.pool, config, token, "context", id),
    );
    await recoveryWrite(f.pool, config, token, "phone-change", id, {
      operationId: newId(),
      expectedVersion: ctx.customerVersion,
      newPhone: `0801999000${index + 1}`,
      activeCardCode: ctx.activeCard!.code,
      expectedCardVersion: ctx.activeCard!.version,
      cardInspectedInPerson: true,
      reason: "Customer presented their card",
    });
  }
  const reader = await f.actor(["customers"]);
  const first = await http("changes", {
    token: reader.token,
    query: "?limit=1",
  });
  expect(first.status).toBe(200);
  expect(first.body.data.items).toHaveLength(1);
  expect(first.body.data.nextCursor).toBeTruthy();
  const query = `?limit=1&cursor=${encodeURIComponent(first.body.data.nextCursor)}`;
  const second = await http("changes", { token: reader.token, query });
  expect(second.status).toBe(200);
  expect(second.body.data.items[0].id).not.toBe(first.body.data.items[0].id);
  expect((await http("changes", { token, query })).status).toBe(400);
  expect(
    (await http("changes", { token: reader.token, query, id: fixtureId(27) }))
      .status,
  ).toBe(400);
  expect(
    (await http("changes", { token: reader.token, query: "?limit=1&limit=2" }))
      .status,
  ).toBe(400);
  const stored = await f.pool.query(
    "SELECT phone_normalized FROM customer WHERE id=$1",
    [id],
  );
  expect(
    JSON.stringify(first.body).includes(stored.rows[0].phone_normalized),
  ).toBe(false);
  const events = await f.pool.query(
    "SELECT * FROM audit_event WHERE action IN ('phone_changed','manager_case_recorded')",
  );
  expect(
    events.rows.every(
      (r) => !JSON.stringify(r).includes(stored.rows[0].phone_normalized),
    ),
  ).toBe(true);
});
