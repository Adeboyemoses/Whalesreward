import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { newId } from "../../src/server/lib/ids";
import {
  registerCustomer,
  lookupCustomer,
  customerRead,
} from "../../src/server/modules/customers/service";
import { cardsWrite, cardsRead } from "../../src/server/modules/cards/service";
import {
  cardsFixture,
  config,
  fixtureId,
  historicalSale,
} from "../helpers/cards-adversarial-fixture";
import { newSession } from "../helpers/sync-fixture";
import { handleCardsCustomers } from "../../src/server/modules/cards/http";
import { COOKIE as ADMIN_COOKIE } from "../../src/server/modules/admin-access/http";
import { COOKIE as ATTENDANT_COOKIE } from "../../src/server/modules/auth/http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  prepareCardExport,
  downloadCardExport,
} from "../../src/server/modules/cards/exports";
import { renderCardExport } from "../../src/server/modules/cards/renderer";
import type { CardArtifactStorage } from "../../src/server/adapters/card-artifacts";
import { stationWrite } from "../../src/server/modules/station/service";

vi.setConfig({ testTimeout: 30000 });
let f: Awaited<ReturnType<typeof cardsFixture>>;
let owner: string;
let phone = 100;
let ip = 1;
async function localArtifacts() {
  const directory = await mkdtemp(join(tmpdir(), "whr-card-artifacts-"));
  const paths = new Map<string, string>();
  const storage: CardArtifactStorage = {
    async write(key, bytes) {
      const path = join(
        directory,
        createHash("sha256").update(key).digest("hex"),
      );
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      paths.set(key, path);
    },
    async read(key, maximum) {
      const bytes = await readFile(paths.get(key)!);
      if (bytes.length > maximum) throw new Error("Artifact too large");
      return bytes;
    },
  };
  return {
    storage,
    paths,
    close: () => rm(directory, { recursive: true, force: true }),
  };
}
async function http(
  area: "customers" | "cards",
  action: string,
  options: {
    token?: string;
    body?: unknown;
    raw?: string;
    target?: string;
    exportId?: string;
    query?: string;
    origin?: string;
    method?: string;
    attendant?: boolean;
  } = {},
) {
  const headers = new Headers({
    origin: options.origin ?? config.origin,
    "x-test-ip": `10.64.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
  });
  if (options.token)
    headers.set(
      "cookie",
      `${options.attendant ? ATTENDANT_COOKIE : ADMIN_COOKIE}=${options.token}`,
    );
  const body =
    options.raw ??
    (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await handleCardsCustomers(
    new Request(`${config.origin}/api/fictional${options.query ?? ""}`, {
      method: options.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
    }),
    area,
    action,
    options.target,
    options.exportId,
  );
  return { response, body: await response.json() };
}
async function attendant() {
  return newSession(f.pool, {
    userId: fixtureId(3),
    attendantId: fixtureId(6),
    assignmentId: fixtureId(18),
    username: "grace.okon",
  });
}
async function batch(count = 2, token = owner) {
  return (
    await cardsWrite(f.pool, config, token, "create", {
      operationId: newId(),
      name: "Fictional adversarial batch",
      count,
    })
  ).data;
}
async function activate(id: string, token = owner) {
  await cardsWrite(
    f.pool,
    config,
    token,
    "mark-printed",
    {
      operationId: newId(),
      expectedVersion: 1,
      reason: "Fictional print reference",
    },
    id,
  );
  return (
    await cardsWrite(
      f.pool,
      config,
      token,
      "activate",
      {
        operationId: newId(),
        expectedVersion: 2,
        reason: "Fictional activation",
      },
      id,
    )
  ).data;
}
async function inventory(id: string) {
  return (
    await f.pool.query(
      "SELECT id,code,state FROM card WHERE batch_id=$1 ORDER BY id",
      [id],
    )
  ).rows;
}
function registration(code: string) {
  return {
    operationId: newId(),
    name: "Amina Bello",
    phone: `0800000${String(phone++).padStart(4, "0")}`,
    category: "car_owner",
    card: { source: "code", code },
  };
}

describe("independent M2 customer and card adversarial checks", () => {
  beforeAll(async () => {
    f = await cardsFixture();
    owner = await f.owner();
  }, 30000);
  afterAll(async () => {
    await f?.close();
  });

  it("I-16 bounded code collisions roll back every card, batch, audit and receipt and permit same-key retry", async () => {
    const input = {
      operationId: newId(),
      name: "Fictional exhausted allocation",
      count: 2,
    };
    const actor = await f.actor(["cards", "cardGenerate"]);
    const snapshot = async () =>
      (
        await f.pool.query(
          "SELECT (SELECT count(*) FROM card_batch)::text batches,(SELECT count(*) FROM card)::text cards,(SELECT count(*) FROM audit_event)::text audits,(SELECT count(*) FROM mutation_receipt)::text receipts",
        )
      ).rows[0];
    const before = await snapshot();
    let calls = 0;
    await expect(
      cardsWrite(f.pool, config, actor.token, "create", input, undefined, {
        codeGenerator: () => (++calls === 1 ? "B7K3M9Q" : "A7K3M9Q"),
      }),
    ).rejects.toMatchObject({
      code: "code_allocation_unavailable",
      status: 503,
    });
    expect(calls).toBeGreaterThan(2);
    expect(calls).toBeLessThanOrEqual(21);
    expect(await snapshot()).toEqual(before);
    const created = await cardsWrite(
      f.pool,
      config,
      actor.token,
      "create",
      input,
    );
    expect(created.replayed).toBe(false);
    expect(await inventory(created.data.id)).toHaveLength(2);
    expect(
      (await cardsWrite(f.pool, config, actor.token, "create", input)).data,
    ).toEqual(created.data);
  });

  it("I-15 normalized phone and parsed QR/code content replay one registration while changed content conflicts", async () => {
    const b = await batch();
    await activate(b.id);
    const card = (await inventory(b.id))[0];
    const session = await attendant();
    const input = registration(` ${card.code.toLowerCase()} `);
    const first = await registerCustomer(f.pool, config, session.token, input);
    const replay = await registerCustomer(f.pool, config, session.token, {
      ...input,
      phone: `+234${input.phone.slice(1)}`,
      card: { source: "qr", qr: card.code },
    });
    expect(replay.replayed).toBe(true);
    expect(replay.data).toEqual(first.data);
    expect(first.data.registeredAtStation).toEqual({
      id: fixtureId(8),
      name: "Station 01",
    });
    expect(first.data.registeredBy).toMatchObject({
      id: fixtureId(6),
      code: "STAFF002",
    });
    await expect(
      registerCustomer(f.pool, config, session.token, {
        ...input,
        name: "Tunde Adebayo",
      }),
    ).rejects.toMatchObject({ code: "operation_conflict", status: 409 });
    const lookup = await lookupCustomer(f.pool, session.token, {
      phone: `+234${input.phone.slice(1)}`,
    });
    expect(lookup.customer.id).toBe(first.data.customer.id);
    expect(Object.keys(lookup).sort()).toEqual([
      "cardCode",
      "cardUsable",
      "customer",
      "lookedUpAt",
    ]);
    expect(JSON.stringify(lookup)).not.toContain(input.phone);
    await expect(
      f.pool.query(
        "UPDATE customer SET registered_station_id=NULL,version=version+1 WHERE id=$1",
        [first.data.customer.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("I-14 unknown legacy registration provenance stays null despite a known card link actor", async () => {
    const view = await customerRead(
      f.pool,
      config,
      owner,
      "profile",
      {},
      fixtureId(26),
    );
    expect(view).toMatchObject({
      registeredAtStation: null,
      registeredBy: null,
      phoneMasked: "•••• 0026",
      activeCardCode: "A7K3M9Q",
    });
    expect(JSON.stringify(view)).not.toContain("+2348000000026");
  });

  it("I-42 I-44 exact accepted totals ignore late proposals and campaign cutoff, preserve duplicates, and separate product units and upload pending", async () => {
    const accepted = await historicalSale(f.pool, {
      amount: "1000000",
      acceptedAmount: "9007199254740993",
      lateProposal: true,
    });
    const second = await historicalSale(f.pool, {
      amount: "11",
      product: "diesel",
    });
    await historicalSale(f.pool, { amount: "1234567", product: "cooking_gas" });
    const held = await historicalSale(f.pool, {
      state: "held",
      amount: "7777777",
    });
    await expect(
      f.pool.query(
        "UPDATE purchase SET status='credited',version=version+1 WHERE id=$1",
        [held.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await historicalSale(f.pool, { state: "cancelled", amount: "8888888" });
    for (const [state, amount] of [
      ["received", "101"],
      ["photo_pending", "202"],
      ["finalizing", "303"],
    ] as const)
      await historicalSale(f.pool, { state, amount });
    await f.pool.query(
      "INSERT INTO duplicate_flag(id,purchase_id,other_purchase_id,reason,state,version) VALUES($1,$2,$3,'Fictional suspected duplicate','open',1)",
      [newId(), accepted.id, second.id],
    );
    const profile = await customerRead(
      f.pool,
      config,
      owner,
      "profile",
      {},
      fixtureId(26),
    );
    expect(profile).toMatchObject({
      recordedSpendKobo: "9007199255975571",
      completedPurchaseCount: "3",
      pending: { amountKobo: "606", count: "3" },
    });
    if (!("quantities" in profile))
      throw new Error("Expected customer profile");
    expect(profile.quantities).toEqual([
      { product: "cooking_gas", unit: "kilogram", quantity: "1.234567" },
      { product: "diesel", unit: "litre", quantity: "0.000011" },
      { product: "pms", unit: "litre", quantity: "9007199254.740993" },
    ]);
    const history = await customerRead(
      f.pool,
      config,
      owner,
      "purchases",
      {},
      fixtureId(26),
    );
    if (!("items" in history)) throw new Error("Expected purchase page");
    expect(history.items).toHaveLength(8);
    expect(
      history.items.find((sale: { id: string }) => sale.id === accepted.id),
    ).toMatchObject({
      amountKobo: "9007199254740993",
      quantity: "9007199254.740993",
      correctionPending: true,
      duplicateFlag: true,
      credited: true,
    });
    expect(
      history.items.filter((sale) => "credited" in sale && sale.credited),
    ).toHaveLength(3);
  });

  it("I-07 card inventory without customers permission never reveals linked customer identity", async () => {
    const actor = await f.actor(["cards"]);
    const hidden = await cardsRead(
      f.pool,
      config,
      actor.token,
      "cards",
      {},
      fixtureId(28),
    );
    if (!("items" in hidden)) throw new Error("Expected inventory page");
    expect(hidden.items).toHaveLength(1);
    expect(hidden.items[0]).toMatchObject({
      state: "linked",
      linkedCustomer: null,
      assignmentEligible: false,
    });
    const visible = await cardsRead(
      f.pool,
      config,
      owner,
      "cards",
      {},
      fixtureId(28),
    );
    if (!("items" in visible)) throw new Error("Expected inventory page");
    expect(visible.items[0]).toMatchObject({
      linkedCustomer: { id: fixtureId(26), name: "Amina Bello" },
    });
    await expect(
      customerRead(f.pool, config, actor.token, "profile", {}, fixtureId(26)),
    ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
    const onlyCustomers = await f.actor(["customers"]);
    await expect(
      customerRead(
        f.pool,
        config,
        onlyCustomers.token,
        "purchases",
        {},
        fixtureId(26),
      ),
    ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
  });

  it("I-07 customer cursors bind actor, endpoint, category and query", async () => {
    const page = await customerRead(f.pool, config, owner, "search", {
      limit: 1,
    });
    if (!("nextCursor" in page))
      throw new Error("Expected customer search page");
    expect(page.nextCursor).toBeTruthy();
    const another = await f.actor(["customers", "sales"]);
    for (const [token, action, input, target] of [
      [
        another.token,
        "search",
        { limit: 1, cursor: page.nextCursor },
        undefined,
      ],
      [
        owner,
        "search",
        { limit: 1, query: "Amina", cursor: page.nextCursor },
        undefined,
      ],
      [
        owner,
        "search",
        { limit: 1, category: "car_owner", cursor: page.nextCursor },
        undefined,
      ],
      [
        owner,
        "purchases",
        { limit: 1, cursor: page.nextCursor },
        fixtureId(26),
      ],
    ] as const)
      await expect(
        customerRead(f.pool, config, token, action, input, target),
      ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
  });

  it("I-20 export snapshot ordered before card linking remains unassigned while a later export records linked", async () => {
    const actor = await f.actor([
      "cards",
      "cardGenerate",
      "cardPrint",
      "cardActivate",
      "cardExport",
    ]);
    const b = await batch(2, actor.token);
    await activate(b.id, actor.token);
    const card = (await inventory(b.id))[0],
      seller = await attendant();
    const gate = await f.pool.connect();
    let exporting: ReturnType<typeof cardsWrite> | undefined;
    let registering: ReturnType<typeof registerCustomer> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query("SELECT id FROM card_batch WHERE id=$1 FOR UPDATE", [
        b.id,
      ]);
      exporting = cardsWrite(
        f.pool,
        config,
        actor.token,
        "export",
        { operationId: newId(), expectedVersion: 3, format: "xlsx" },
        b.id,
      );
      await f.waitForLock("card_batch");
      registering = registerCustomer(
        f.pool,
        config,
        seller.token,
        registration(card.code),
      );
      await f.waitForLock("security_state");
      await gate.query("COMMIT");
      const [snapshot, registered] = await Promise.all([
        exporting,
        registering,
      ]);
      expect(registered.data.cardCode).toBe(card.code);
      const items = async (id: string) =>
        (
          await f.pool.query(
            "SELECT card_id,code,qr_payload,card_state,assignment_eligible FROM card_export_item WHERE export_id=$1 ORDER BY ordinal",
            [id],
          )
        ).rows;
      const frozen = await items(snapshot.data.id);
      expect(frozen.find((item) => item.card_id === card.id)).toMatchObject({
        code: card.code,
        qr_payload: card.code,
        card_state: "unassigned",
        assignment_eligible: true,
      });
      const later = await cardsWrite(
        f.pool,
        config,
        actor.token,
        "export",
        { operationId: newId(), expectedVersion: 3, format: "xlsx" },
        b.id,
      );
      expect(
        (await items(later.data.id)).find((item) => item.card_id === card.id),
      ).toMatchObject({ card_state: "linked", assignment_eligible: false });
      expect(await items(snapshot.data.id)).toEqual(frozen);
      expect(
        await cardsRead(f.pool, config, actor.token, "detail", {}, b.id),
      ).toMatchObject({
        status: "active",
        version: 3,
        total: "2",
        linked: "1",
        unassigned: "1",
      });
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await Promise.allSettled([exporting, registering]);
    }
  });

  it("I-20 export ordered before lifecycle activation retains original batch metadata and original pending receipt", async () => {
    const actor = await f.actor([
      "cards",
      "cardGenerate",
      "cardPrint",
      "cardActivate",
      "cardExport",
    ]);
    const b = await batch(1, actor.token);
    await cardsWrite(
      f.pool,
      config,
      actor.token,
      "mark-printed",
      { operationId: newId(), expectedVersion: 1, reason: "Fictional print" },
      b.id,
    );
    const input = { operationId: newId(), expectedVersion: 2, format: "xlsx" };
    const gate = await f.pool.connect();
    let exporting: ReturnType<typeof cardsWrite> | undefined;
    let activating: ReturnType<typeof cardsWrite> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query("SELECT id FROM card_batch WHERE id=$1 FOR UPDATE", [
        b.id,
      ]);
      exporting = cardsWrite(
        f.pool,
        config,
        actor.token,
        "export",
        input,
        b.id,
      );
      await f.waitForLock("card_batch");
      activating = cardsWrite(
        f.pool,
        config,
        actor.token,
        "activate",
        {
          operationId: newId(),
          expectedVersion: 2,
          reason: "Fictional activation race",
        },
        b.id,
      );
      await f.waitForLock("security_state");
      await gate.query("COMMIT");
      const [snapshot, activated] = await Promise.all([exporting, activating]);
      expect(activated.data).toMatchObject({ status: "active" });
      expect(snapshot.data).toMatchObject({
        state: "pending",
        batchVersion: 2,
        batchStatus: "printed",
        cardCount: "1",
      });
      expect(
        (await cardsWrite(f.pool, config, actor.token, "export", input, b.id))
          .data,
      ).toEqual(snapshot.data);
      expect(
        (
          await f.pool.query(
            "SELECT assignment_eligible FROM card_export_item WHERE export_id=$1",
            [snapshot.data.id],
          )
        ).rows,
      ).toEqual([{ assignment_eligible: false }]);
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await Promise.allSettled([exporting, activating]);
    }
  });

  it("I-09 grant revocation while a card write waits cannot authorize either a commit or receipt replay", async () => {
    const actor = await f.actor(["cards", "cardGenerate"]);
    const first = {
      operationId: newId(),
      name: "Fictional replay denied",
      count: 1,
    };
    await cardsWrite(f.pool, config, actor.token, "create", first);
    const input = {
      operationId: newId(),
      name: "Fictional waiting denied",
      count: 1,
    };
    const gate = await f.pool.connect();
    let pending: ReturnType<typeof cardsWrite> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query(
        "SELECT id FROM security_state WHERE id=true FOR UPDATE",
      );
      pending = cardsWrite(f.pool, config, actor.token, "create", input);
      // Attach rejection handling before releasing the lock, avoiding an unhandled rejection.
      const settled = pending.then(
        () => null,
        (error: unknown) => error,
      );
      await f.waitForLock("security_state");
      await gate.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='cardGenerate'",
        [actor.roleId],
      );
      await gate.query("COMMIT");
      expect(await settled).toMatchObject({
        code: "permission_denied",
        status: 403,
      });
      await expect(
        cardsWrite(f.pool, config, actor.token, "create", first),
      ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
      expect(
        (
          await f.pool.query(
            "SELECT count(*)::int AS n FROM card_batch WHERE name=$1",
            [input.name],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await Promise.allSettled([pending]);
    }
  });

  it("I-07 every customer and card route rejects absent, restricted, wrong-kind and ungranted authority", async () => {
    const denied = await f.actor([]),
      restricted = await f.actor(
        [
          "cards",
          "customers",
          "sales",
          "cardGenerate",
          "cardPrint",
          "cardActivate",
          "cardExport",
        ],
        true,
      ),
      seller = await attendant();
    const routes = [
      ["customers", "search", {}],
      ["customers", "profile", undefined],
      ["customers", "purchases", undefined],
      ["cards", "list", undefined],
      ["cards", "detail", undefined],
      ["cards", "cards", undefined],
      ["cards", "history", undefined],
      [
        "cards",
        "create",
        { operationId: newId(), name: "Fictional denied", count: 1 },
      ],
      [
        "cards",
        "mark-printed",
        {
          operationId: newId(),
          expectedVersion: 1,
          reason: "Fictional denied",
        },
      ],
      [
        "cards",
        "activate",
        {
          operationId: newId(),
          expectedVersion: 2,
          reason: "Fictional denied",
        },
      ],
      [
        "cards",
        "export",
        { operationId: newId(), expectedVersion: 3, format: "xlsx" },
      ],
      ["cards", "exports", undefined],
      ["cards", "export-detail", undefined],
      ["cards", "file", undefined],
    ] as const;
    for (const [area, action, body] of routes) {
      for (const [token, expected] of [
        [undefined, 401],
        [denied.token, 403],
        [restricted.token, 403],
        [seller.token, 401],
      ] as const) {
        const result = await http(area, action, {
          token,
          body,
          target: area === "customers" ? fixtureId(26) : fixtureId(28),
          exportId: newId(),
        });
        expect(
          result.response.status,
          `${area}/${action}: ${JSON.stringify(result.body)}`,
        ).toBe(expected);
        expect(result.response.headers.get("cache-control")).toBe("no-store");
      }
    }
    for (const action of ["register", "lookup"]) {
      for (const token of [undefined, owner]) {
        const result = await http("customers", action, {
          token,
          attendant: true,
          body:
            action === "register"
              ? registration("A7K3M9Q")
              : { phone: "08000000026" },
        });
        expect(result.response.status).toBe(401);
      }
    }
    const restrictedSeller = await attendant();
    const restrictedToken = await f.restrictAttendant(restrictedSeller.token);
    for (const action of ["register", "lookup"]) {
      const result = await http("customers", action, {
        token: restrictedToken,
        attendant: true,
        body:
          action === "register"
            ? registration("A7K3M9Q")
            : { phone: "08000000026" },
      });
      expect(result.response.status).toBe(403);
      expect(result.body.error.code).toBe("password_change_required");
    }
  });

  it("I-07 HTTP rejects cross-origin reads by POST, oversized bodies, unsupported fields and duplicate query parameters", async () => {
    const cases = [
      [
        "customers",
        "search",
        { token: owner, body: {}, origin: "https://other.example.test" },
        403,
      ],
      [
        "cards",
        "create",
        {
          token: owner,
          body: { operationId: newId(), name: "Fictional", count: 1 },
          origin: "https://other.example.test",
        },
        403,
      ],
      [
        "customers",
        "search",
        { token: owner, raw: JSON.stringify({ query: "X".repeat(33000) }) },
        413,
      ],
      [
        "customers",
        "search",
        { token: owner, body: { phone: "08000000026" } },
        400,
      ],
      [
        "cards",
        "create",
        {
          token: owner,
          body: {
            operationId: newId(),
            name: "Fictional",
            count: 1,
            reason: "Not a creation field",
          },
        },
        400,
      ],
      ["cards", "list", { token: owner, query: "?limit=1&limit=2" }, 400],
      ["cards", "list", { token: owner, query: "?sort=name" }, 400],
      [
        "cards",
        "detail",
        { token: owner, target: fixtureId(28), query: "?limit=1" },
        400,
      ],
    ] as const;
    for (const [area, action, options, status] of cases) {
      const result = await http(area, action, options);
      expect(
        result.response.status,
        `${area}/${action}: ${JSON.stringify(result.body)}`,
      ).toBe(status);
      expect(result.response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("I-20 private prepared bytes remain checksum-identical, GETs do not prepare files, replay retains pending receipt, and expiry requires a new export", async () => {
    const files = await localArtifacts(),
      actor = await f.actor(["cards", "cardGenerate", "cardExport"]);
    try {
      const b = await batch(2, actor.token),
        input = { operationId: newId(), expectedVersion: 1, format: "xlsx" };
      const pending = await cardsWrite(
        f.pool,
        config,
        actor.token,
        "export",
        input,
        b.id,
      );
      const raw = async () =>
        (
          await f.pool.query(
            "SELECT to_jsonb(e) AS snapshot FROM card_export e WHERE id=$1",
            [pending.data.id],
          )
        ).rows[0].snapshot;
      const before = await raw();
      for (const action of ["exports", "export-detail"]) {
        const view = await http("cards", action, {
          token: actor.token,
          target: b.id,
          exportId: pending.data.id,
        });
        expect(view.response.status).toBe(200);
        expect(JSON.stringify(view.body)).not.toMatch(
          /object_key|sha256|https?:|final\/card-exports/,
        );
      }
      expect(await raw()).toEqual(before);
      await expect(
        downloadCardExport(
          f.pool,
          actor.token,
          b.id,
          pending.data.id,
          files.storage,
        ),
      ).rejects.toMatchObject({ code: "export_not_ready", status: 409 });
      expect(
        await prepareCardExport(
          f.pool,
          { storage: files.storage, artifactLifetimeMs: 60000 },
          pending.data.id,
        ),
      ).toEqual({ processed: true, delivered: true });
      const prepared = await raw(),
        first = await downloadCardExport(
          f.pool,
          actor.token,
          b.id,
          pending.data.id,
          files.storage,
        );
      expect(Buffer.from(first.bytes).subarray(0, 2).toString()).toBe("PK");
      expect(createHash("sha256").update(first.bytes).digest("hex")).toBe(
        prepared.sha256,
      );
      expect(BigInt(first.bytes.byteLength)).toBe(BigInt(prepared.byte_size));
      expect(
        (
          await downloadCardExport(
            f.pool,
            actor.token,
            b.id,
            pending.data.id,
            files.storage,
          )
        ).bytes,
      ).toEqual(first.bytes);
      expect(
        await prepareCardExport(
          f.pool,
          { storage: files.storage },
          pending.data.id,
        ),
      ).toEqual({ processed: false });
      expect(await raw()).toEqual(prepared);
      const replay = await cardsWrite(
        f.pool,
        config,
        actor.token,
        "export",
        input,
        b.id,
      );
      expect(replay.replayed).toBe(true);
      expect(replay.data).toEqual(pending.data);
      await expect(
        downloadCardExport(
          f.pool,
          actor.token,
          fixtureId(28),
          pending.data.id,
          files.storage,
        ),
      ).rejects.toMatchObject({ code: "not_found", status: 404 });
      const expiring = await cardsWrite(
        f.pool,
        config,
        actor.token,
        "export",
        { ...input, operationId: newId() },
        b.id,
      );
      expect(
        await prepareCardExport(
          f.pool,
          { storage: files.storage, artifactLifetimeMs: 1 },
          expiring.data.id,
        ),
      ).toEqual({ processed: true, delivered: true });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await expect(
        downloadCardExport(
          f.pool,
          actor.token,
          b.id,
          expiring.data.id,
          files.storage,
        ),
      ).rejects.toMatchObject({ code: "export_expired", status: 410 });
      expect(await raw()).toEqual(prepared);
      expect(await inventory(b.id)).toHaveLength(2);
      expect(
        await cardsRead(f.pool, config, actor.token, "detail", {}, b.id),
      ).toMatchObject({ status: "generated", version: 1, unassigned: "2" });
    } finally {
      await files.close();
    }
  });

  it("I-09 revoked creator permission blocks both preparation and a previously prepared download", async () => {
    const files = await localArtifacts(),
      actor = await f.actor(["cards", "cardGenerate", "cardExport"]);
    try {
      const b = await batch(1, actor.token);
      const exports = [];
      for (let n = 0; n < 2; n++)
        exports.push(
          (
            await cardsWrite(
              f.pool,
              config,
              actor.token,
              "export",
              { operationId: newId(), expectedVersion: 1, format: "xlsx" },
              b.id,
            )
          ).data.id,
        );
      expect(
        await prepareCardExport(
          f.pool,
          { storage: files.storage },
          exports[0]!,
        ),
      ).toEqual({ processed: true, delivered: true });
      await f.pool.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='cardExport'",
        [actor.roleId],
      );
      await expect(
        downloadCardExport(f.pool, owner, b.id, exports[0]!, files.storage),
      ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
      await expect(
        downloadCardExport(
          f.pool,
          actor.token,
          b.id,
          exports[0]!,
          files.storage,
        ),
      ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
      expect(
        await prepareCardExport(
          f.pool,
          { storage: files.storage },
          exports[1]!,
        ),
      ).toEqual({ processed: true, delivered: false });
      expect(files.paths.size).toBe(1);
      expect(
        (
          await f.pool.query(
            "SELECT status,failure_code,object_key FROM card_export WHERE id=$1",
            [exports[1]!],
          )
        ).rows[0],
      ).toEqual({
        status: "failed",
        failure_code: "preparation_failed",
        object_key: null,
      });
    } finally {
      await files.close();
    }
  });

  it("I-52 a renderer from an expired lease cannot replace a newer worker's private artifact", async () => {
    const files = await localArtifacts(),
      actor = await f.actor(["cards", "cardGenerate", "cardExport"]);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let stale: ReturnType<typeof prepareCardExport> | undefined;
    try {
      const b = await batch(1, actor.token),
        e = (
          await cardsWrite(
            f.pool,
            config,
            actor.token,
            "export",
            { operationId: newId(), expectedVersion: 1, format: "xlsx" },
            b.id,
          )
        ).data;
      stale = prepareCardExport(
        f.pool,
        {
          storage: files.storage,
          render: async (...args) => {
            entered();
            await gate;
            return renderCardExport(...args);
          },
        },
        e.id,
      );
      await started;
      expect(
        await prepareCardExport(f.pool, { storage: files.storage }, e.id),
      ).toEqual({ processed: false });
      await f.pool.query(
        "UPDATE card_export SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [e.id],
      );
      expect(
        await prepareCardExport(f.pool, { storage: files.storage }, e.id),
      ).toEqual({ processed: true, delivered: true });
      const before = (
        await f.pool.query(
          "SELECT to_jsonb(e) AS snapshot FROM card_export e WHERE id=$1",
          [e.id],
        )
      ).rows[0].snapshot;
      release();
      expect(await stale).toEqual({ processed: true, delivered: false });
      expect(
        (
          await f.pool.query(
            "SELECT to_jsonb(e) AS snapshot FROM card_export e WHERE id=$1",
            [e.id],
          )
        ).rows[0].snapshot,
      ).toEqual(before);
      expect(before.fencing_version).toBe(2);
      expect(before.attempts).toBe(2);
      expect(files.paths.size).toBe(1);
      const download = await downloadCardExport(
        f.pool,
        actor.token,
        b.id,
        e.id,
        files.storage,
      );
      await writeFile(
        files.paths.get(before.object_key)!,
        Buffer.from("Fictional tampered artifact"),
      );
      await expect(
        downloadCardExport(f.pool, actor.token, b.id, e.id, files.storage),
      ).rejects.toMatchObject({ code: "export_failed", status: 409 });
      expect(download.bytes.byteLength).toBeGreaterThan(0);
    } finally {
      release();
      await stale;
      await files.close();
    }
  });

  it("I-16 retired exact card search resolves its historical customer and the retired code can never be allocated again", async () => {
    const b = await batch(1);
    await activate(b.id);
    const card = (await inventory(b.id))[0],
      seller = await attendant();
    const registered = await registerCustomer(
      f.pool,
      config,
      seller.token,
      registration(card.code),
    );
    const db = await f.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "UPDATE card_customer_link SET ended_at=clock_timestamp()+interval '1 millisecond' WHERE card_id=$1",
        [card.id],
      );
      await db.query(
        "UPDATE card SET state='retired',retired_at=clock_timestamp(),retirement_reason='Fictional historical replacement',version=version+1 WHERE id=$1",
        [card.id],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
    const found = await customerRead(f.pool, config, owner, "search", {
      query: ` ${card.code.toLowerCase()} `,
    });
    expect(found).toMatchObject({
      items: [{ id: registered.data.customer.id, activeCardCode: null }],
    });
    let calls = 0;
    const created = await cardsWrite(
      f.pool,
      config,
      owner,
      "create",
      { operationId: newId(), name: "Fictional terminal code", count: 1 },
      undefined,
      { codeGenerator: () => (++calls === 1 ? card.code : "C7K3M9Q") },
    );
    expect(calls).toBe(2);
    expect((await inventory(created.data.id))[0].code).toBe("C7K3M9Q");
    expect((await inventory(b.id))[0].state).toBe("retired");
  });

  it("I-20 linking ordered before PDF snapshot excludes that linked card and cannot later broaden the print sheet", async () => {
    const actor = await f.actor([
      "cards",
      "cardGenerate",
      "cardPrint",
      "cardActivate",
      "cardExport",
    ]);
    const b = await batch(2, actor.token);
    await activate(b.id, actor.token);
    const cards = await inventory(b.id),
      seller = await attendant(),
      gate = await f.pool.connect();
    const layout = {
      pageWidthMm: 210,
      pageHeightMm: 297,
      cardWidthMm: 85.6,
      cardHeightMm: 54,
      marginMm: 10,
      gapMm: 2,
    };
    let linking: ReturnType<typeof registerCustomer> | undefined,
      exporting: ReturnType<typeof cardsWrite> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query("SELECT id FROM card_batch WHERE id=$1 FOR UPDATE", [
        b.id,
      ]);
      linking = registerCustomer(
        f.pool,
        config,
        seller.token,
        registration(cards[0].code),
      );
      await f.waitForLock("card_batch");
      exporting = cardsWrite(
        f.pool,
        config,
        actor.token,
        "export",
        { operationId: newId(), expectedVersion: 3, format: "pdf" },
        b.id,
        { layout },
      );
      await f.waitForLock("security_state");
      await gate.query("COMMIT");
      const [, exported] = await Promise.all([linking, exporting]);
      expect(exported.data).toMatchObject({
        cardCount: "1",
        batchStatus: "active",
        batchVersion: 3,
      });
      const rows = (
        await f.pool.query(
          "SELECT card_id,code,card_state,assignment_eligible FROM card_export_item WHERE export_id=$1",
          [exported.data.id],
        )
      ).rows;
      expect(rows).toEqual([
        {
          card_id: cards[1].id,
          code: cards[1].code,
          card_state: "unassigned",
          assignment_eligible: true,
        },
      ]);
      await expect(
        f.pool.query("UPDATE card_export_item SET code=$2 WHERE export_id=$1", [
          exported.data.id,
          cards[0].code,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await Promise.allSettled([linking, exporting]);
    }
  });

  it("I-14 registration provenance remains original after pump reassignment and a fresh same-account receipt replay", async () => {
    const b = await batch(1);
    await activate(b.id);
    const card = (await inventory(b.id))[0],
      seller = await attendant();
    const input = registration(card.code);
    const original = await registerCustomer(
      f.pool,
      config,
      seller.token,
      input,
    );
    const before = await customerRead(
      f.pool,
      config,
      owner,
      "profile",
      {},
      original.data.customer.id,
    );
    await stationWrite(
      f.pool,
      config,
      owner,
      "attendants-assignment",
      {
        operationId: newId(),
        expectedVersion: 1,
        expectedAssignmentId: fixtureId(18),
        pumpId: fixtureId(13),
        expectedPumpVersion: 1,
        reason: "Fictional provenance reassignment",
      },
      fixtureId(6),
    );
    await expect(
      registerCustomer(f.pool, config, seller.token, input),
    ).rejects.toMatchObject({ code: "online_sign_in_required", status: 403 });
    const assignment = (
      await f.pool.query(
        "SELECT id FROM assignment WHERE attendant_id=$1 AND effective_until IS NULL",
        [fixtureId(6)],
      )
    ).rows[0].id;
    const fresh = await newSession(f.pool, {
      userId: fixtureId(3),
      attendantId: fixtureId(6),
      assignmentId: assignment,
      username: "grace.okon",
    });
    const replay = await registerCustomer(f.pool, config, fresh.token, input);
    expect(replay.replayed).toBe(true);
    expect(replay.data).toEqual(original.data);
    expect(
      await customerRead(
        f.pool,
        config,
        owner,
        "profile",
        {},
        original.data.customer.id,
      ),
    ).toEqual(before);
    expect(original.data).toMatchObject({
      registeredAtStation: { id: fixtureId(8), name: "Station 01" },
      registeredBy: { id: fixtureId(6), code: "STAFF002" },
    });
  });
});
