import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { newId } from "../../src/server/lib/ids";
import { digest, sessionSecret } from "../../src/server/modules/auth/crypto";
import { adminConfig } from "../../src/server/modules/admin-access/config";
import { cardsWrite, cardsRead } from "../../src/server/modules/cards/service";
import {
  registerCustomer,
  lookupCustomer,
  customerRead,
} from "../../src/server/modules/customers/service";
import { handleCardsCustomers } from "../../src/server/modules/cards/http";
import {
  prepareCardExport,
  downloadCardExport,
} from "../../src/server/modules/cards/exports";
import type { CardArtifactStorage } from "../../src/server/adapters/card-artifacts";
vi.setConfig({ testTimeout: 30000 });
const schema = `customers_cards_${randomBytes(6).toString("hex")}`;
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pool: pg.Pool;
const id = (n: number) =>
  `019a5000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const secret = randomBytes(32).toString("hex"),
  origin = "https://cards.example.test";
let adminToken: string, attendantToken: string;
const files = new Map<string, Uint8Array>();
const storage: CardArtifactStorage = {
  async write(key, bytes) {
    files.set(key, bytes);
  },
  async read(key) {
    const b = files.get(key);
    if (!b) throw new Error("Missing");
    return b;
  },
};
const options = { storage };
async function batch(count = 4) {
  const r = await cardsWrite(pool, adminConfig(), adminToken, "create", {
    operationId: newId(),
    name: "Fictional print run",
    count,
  });
  return r.data as { id: string; version: number; status: string };
}
async function active(count = 4) {
  let b = await batch(count);
  for (const action of ["mark-printed", "activate"]) {
    b = (
      await cardsWrite(
        pool,
        adminConfig(),
        adminToken,
        action,
        {
          operationId: newId(),
          expectedVersion: b.version,
          reason: "Fictional stock confirmation",
        },
        b.id,
      )
    ).data as typeof b;
  }
  return b;
}
async function codes(batchId: string) {
  return (await cardsRead(
    pool,
    adminConfig(),
    adminToken,
    "cards",
    {},
    batchId,
  )) as { items: { id: string; code: string; state: string }[] };
}
const registration = (code: string, phone = "08000001000") => ({
  operationId: newId(),
  name: "Amina Bello",
  phone,
  category: "car_owner",
  card: { source: "code", code },
});
async function call(
  area: "cards" | "customers",
  action: string,
  input?: unknown,
  target?: string,
  extraHeaders: Record<string, string> = {},
  query = "",
) {
  const r = await handleCardsCustomers(
    new Request(`${origin}/api/test${query}`, {
      method: input === undefined ? "GET" : "POST",
      headers: {
        cookie:
          action === "register" || action === "lookup"
            ? `__Host-whr-session=${attendantToken}`
            : `__Host-whr-admin-session=${adminToken}`,
        origin,
        "content-type": "application/json",
        "x-test-ip": "10.47.0.1",
        ...extraHeaders,
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    }),
    area,
    action,
    target,
  );
  return { response: r, body: await r.json() };
}
describe("M2 atomic customers and card inventory", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    pool = new pg.Pool({ connectionString: url.toString(), max: 15 });
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const d of (await readdir(migrations, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await pool.query(
        await readFile(new URL(`${d.name}/migration.sql`, migrations), "utf8"),
      );
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    await pool.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=ANY($1::uuid[])",
      [[id(2), id(3)]],
    );
    process.env.BETTER_AUTH_SECRET = secret;
    process.env.BETTER_AUTH_URL = origin;
    process.env.WHR_ENV = "test";
    process.env.WHR_TRUSTED_IP_HEADER = "x-test-ip";
    for (const [user, kind] of [
      [id(2), "admin"],
      [id(3), "attendant"],
    ]) {
      const session = newId(),
        token = sessionSecret(secret, session),
        context = kind === "attendant" ? newId() : null;
      if (context)
        await pool.query(
          "INSERT INTO capture_context(id,attendant_id,assignment_id,signed_in_at,offline_expires_at,seller_name,seller_username,device_binding_digest) VALUES($1,$2,$3,clock_timestamp(),clock_timestamp()+interval '24 hours','Grace Okon','grace.okon','fictional-digest')",
          [context, id(6), id(18)],
        );
      await pool.query(
        "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,capture_context_id) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',1,clock_timestamp(),$4)",
        [session, user, digest(token), context],
      );
      if (kind === "admin") adminToken = token;
      else attendantToken = token;
    }
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM auth_rate_bucket");
  });
  afterAll(async () => {
    await pool?.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  });
  it("I-16/I-20 reserves cryptographic globally unique codes and returns original inventory on replay", async () => {
    const input = { operationId: newId(), name: "Fictional batch", count: 40 },
      r = await cardsWrite(pool, adminConfig(), adminToken, "create", input),
      b = r.data as { id: string };
    const cards = await codes(b.id);
    expect(new Set(cards.items.map((c) => c.code)).size).toBe(25); // pagination is bounded
    const all = (
      await pool.query("SELECT code,qr_payload FROM card WHERE batch_id=$1", [
        b.id,
      ])
    ).rows;
    expect(all).toHaveLength(40);
    expect(new Set(all.map((c) => c.code)).size).toBe(40);
    for (const c of all) {
      expect(c.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{7}$/);
      expect(c.qr_payload).toBe(c.code);
    }
    expect(
      await cardsWrite(pool, adminConfig(), adminToken, "create", input),
    ).toEqual({ ...r, replayed: true });
    await expect(
      cardsWrite(pool, adminConfig(), adminToken, "create", {
        ...input,
        count: 41,
      }),
    ).rejects.toMatchObject({ code: "operation_conflict" });
  });
  it("I-18 requires forward CAS transitions, reason, audit and historical Domain replay", async () => {
    const b = await batch(),
      input = {
        operationId: newId(),
        expectedVersion: 1,
        reason: "Fictional print reference",
      };
    await expect(
      cardsWrite(pool, adminConfig(), adminToken, "activate", input, b.id),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    const results = await Promise.allSettled([
      cardsWrite(pool, adminConfig(), adminToken, "mark-printed", input, b.id),
      cardsWrite(
        pool,
        adminConfig(),
        adminToken,
        "mark-printed",
        { ...input, operationId: newId() },
        b.id,
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    await cardsWrite(
      pool,
      adminConfig(),
      adminToken,
      "activate",
      { ...input, operationId: newId(), expectedVersion: 2 },
      b.id,
    );
    expect(
      (
        await cardsWrite(
          pool,
          adminConfig(),
          adminToken,
          "mark-printed",
          input,
          b.id,
        )
      ).data,
    ).toMatchObject({ version: 2, status: "printed" });
    const history = (await cardsRead(
      pool,
      adminConfig(),
      adminToken,
      "history",
      {},
      b.id,
    )) as { items: unknown[] };
    expect(history.items).toHaveLength(3);
    expect(history.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: null,
          to: "generated",
          reason: "Batch generated",
        }),
        expect.objectContaining({
          from: "generated",
          to: "printed",
          reason: input.reason,
        }),
      ]),
    );
  });
  it("I-19 inactive cards cannot register and failed attempts leave no customer or receipt", async () => {
    const b = await batch(),
      code = (await codes(b.id)).items[0]!.code,
      input = registration(code);
    await expect(
      registerCustomer(pool, adminConfig(), attendantToken, input),
    ).rejects.toMatchObject({ code: "card_unavailable" });
    expect(
      (
        await pool.query(
          "SELECT 1 FROM customer WHERE phone_normalized='+2348000001000'",
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM mutation_receipt WHERE operation_id=$1",
          [input.operationId],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("I-14/I-15/I-19 two registrations racing for one phone create exactly one customer/link", async () => {
    const b = await active(),
      cs = (await codes(b.id)).items;
    const results = await Promise.allSettled([
      registerCustomer(
        pool,
        adminConfig(),
        attendantToken,
        registration(cs[0]!.code, "08000001001"),
      ),
      registerCustomer(
        pool,
        adminConfig(),
        attendantToken,
        registration(cs[1]!.code, "+234 800 000 1001"),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "phone_in_use" },
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM card_customer_link WHERE card_id=ANY($1::uuid[])",
          [[cs[0]!.id, cs[1]!.id]],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("I-19 same card race rolls back losing customer; exact lookup follows the successful link", async () => {
    const b = await active(),
      code = (await codes(b.id)).items[0]!.code;
    const results = await Promise.allSettled([
      registerCustomer(
        pool,
        adminConfig(),
        attendantToken,
        registration(code, "08000001002"),
      ),
      registerCustomer(
        pool,
        adminConfig(),
        attendantToken,
        registration(code, "08000001003"),
      ),
    ]);
    const win = results.find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<Awaited<ReturnType<typeof registerCustomer>>>;
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "card_unavailable" },
    });
    const lookup = await lookupCustomer(pool, attendantToken, {
      phone: win.value.data.customer.phone,
    });
    expect(lookup).toMatchObject({
      customer: { id: win.value.data.customer.id },
      cardCode: code,
      cardUsable: true,
    });
    expect(lookup).not.toHaveProperty("phone");
  });
  it("registration replay preserves immutable provenance and only the original account can see the receipt", async () => {
    const b = await active(),
      code = (await codes(b.id)).items[0]!.code,
      input = registration(code, "08000001004");
    const first = await registerCustomer(
      pool,
      adminConfig(),
      attendantToken,
      input,
    );
    expect(first.data).toMatchObject({
      registeredAtStation: { id: id(8) },
      registeredBy: { id: id(6) },
      customer: { category: "car_owner", phone: "+2348000001004" },
    });
    expect(
      await registerCustomer(pool, adminConfig(), attendantToken, {
        ...input,
        phone: "+2348000001004",
        card: { source: "qr", qr: code.toLowerCase() },
      }),
    ).toEqual({ ...first, replayed: true });
    await expect(
      pool.query("UPDATE customer SET registered_by_user_id=$2 WHERE id=$1", [
        first.data.customer.id,
        id(4),
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    const profile = await customerRead(
      pool,
      adminConfig(),
      adminToken,
      "profile",
      {},
      first.data.customer.id,
    );
    expect(profile).toMatchObject({
      registeredBy: { id: id(6) },
      phoneMasked: "•••• 1004",
      recordedSpendKobo: "0",
      pending: { amountKobo: "0", count: "0" },
    });
    expect(profile).not.toHaveProperty("phone");
  });
  it("I-20 immutable XLSX snapshots prepare privately with checksum and never mutate inventory", async () => {
    const b = await active(),
      input = {
        operationId: newId(),
        expectedVersion: b.version,
        format: "xlsx",
      },
      before = (
        await pool.query("SELECT * FROM card WHERE batch_id=$1 ORDER BY id", [
          b.id,
        ])
      ).rows;
    const created = await cardsWrite(
        pool,
        adminConfig(),
        adminToken,
        "export",
        input,
        b.id,
      ),
      e = created.data as { id: string };
    await expect(
      downloadCardExport(pool, adminToken, b.id, e.id, storage),
    ).rejects.toMatchObject({ code: "export_not_ready" });
    expect(await prepareCardExport(pool, options, e.id)).toEqual({
      processed: true,
      delivered: true,
    });
    const file = await downloadCardExport(
      pool,
      adminToken,
      b.id,
      e.id,
      storage,
    );
    expect(file.contentType).toContain("spreadsheetml");
    expect(file.bytes.byteLength).toBeGreaterThan(100);
    const current = await cardsRead(
      pool,
      adminConfig(),
      adminToken,
      "export-detail",
      {},
      b.id,
      e.id,
    );
    expect(current).toMatchObject({
      state: "ready",
      cardCount: "4",
      batchStatus: "active",
      batchVersion: 3,
    });
    expect(
      (await cardsWrite(pool, adminConfig(), adminToken, "export", input, b.id))
        .data,
    ).toEqual(created.data);
    expect(
      (
        await pool.query("SELECT * FROM card WHERE batch_id=$1 ORDER BY id", [
          b.id,
        ])
      ).rows,
    ).toEqual(before);
    await expect(
      pool.query(
        "UPDATE card_export_item SET code='AAAAAAA' WHERE export_id=$1",
        [e.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      downloadCardExport(pool, adminToken, newId(), e.id, storage),
    ).rejects.toMatchObject({ code: "not_found" });
    const object = (
      await pool.query("SELECT object_key FROM card_export WHERE id=$1", [e.id])
    ).rows[0].object_key;
    files.set(object, new Uint8Array([1]));
    await expect(
      downloadCardExport(pool, adminToken, b.id, e.id, storage),
    ).rejects.toMatchObject({ code: "export_failed" });
  });
  it("D08 PDF requires configured layout; preparation failures retain the same snapshot and bounded retry", async () => {
    const b = await batch();
    await expect(
      cardsWrite(
        pool,
        adminConfig(),
        adminToken,
        "export",
        { operationId: newId(), expectedVersion: 1, format: "pdf" },
        b.id,
      ),
    ).rejects.toMatchObject({ code: "print_layout_unconfigured" });
    const e = (
      await cardsWrite(
        pool,
        adminConfig(),
        adminToken,
        "export",
        { operationId: newId(), expectedVersion: 1, format: "xlsx" },
        b.id,
      )
    ).data as { id: string };
    const snapshots = (
      await pool.query(
        "SELECT * FROM card_export_item WHERE export_id=$1 ORDER BY ordinal",
        [e.id],
      )
    ).rows;
    expect(
      await prepareCardExport(
        pool,
        {
          storage,
          render: async () => {
            throw new Error("fictional provider failure with private info");
          },
        },
        e.id,
      ),
    ).toEqual({ processed: true, delivered: false });
    expect(
      await cardsRead(
        pool,
        adminConfig(),
        adminToken,
        "export-detail",
        {},
        b.id,
        e.id,
      ),
    ).toMatchObject({ state: "failed", failure: "preparation_failed" });
    await pool.query(
      "UPDATE card_export SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [e.id],
    );
    expect(await prepareCardExport(pool, options, e.id)).toEqual({
      processed: true,
      delivered: true,
    });
    expect(
      (
        await pool.query(
          "SELECT * FROM card_export_item WHERE export_id=$1 ORDER BY ordinal",
          [e.id],
        )
      ).rows,
    ).toEqual(snapshots);
  });
  it("D08 invalid physical layout rejects PDF before snapshot while independent XLSX remains usable", async () => {
    const b = await batch(),
      input = { operationId: newId(), expectedVersion: 1, format: "pdf" };
    const invalid = {
      pageWidthMm: 0,
      pageHeightMm: 297,
      cardWidthMm: 85.6,
      cardHeightMm: 54,
      marginMm: 10,
      gapMm: 2,
    };
    await expect(
      cardsWrite(pool, adminConfig(), adminToken, "export", input, b.id, {
        layout: invalid,
      }),
    ).rejects.toMatchObject({ code: "print_layout_unconfigured" });
    expect(
      (
        await pool.query("SELECT 1 FROM card_export WHERE operation_id=$1", [
          input.operationId,
        ])
      ).rowCount,
    ).toBe(0);
    vi.stubEnv("WHR_CARD_PRINT_LAYOUT", JSON.stringify(invalid));
    try {
      const exportResult = await cardsWrite(
        pool,
        adminConfig(),
        adminToken,
        "export",
        { ...input, operationId: newId(), format: "xlsx" },
        b.id,
      );
      expect(exportResult.data).toMatchObject({
        state: "pending",
        format: "xlsx",
      });
      expect(
        await prepareCardExport(
          pool,
          options,
          (exportResult.data as { id: string }).id,
        ),
      ).toEqual({ processed: true, delivered: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("export snapshots cannot gain additional rows after the creation transaction", async () => {
    const b = await batch(),
      e = (
        await cardsWrite(
          pool,
          adminConfig(),
          adminToken,
          "export",
          { operationId: newId(), expectedVersion: 1, format: "xlsx" },
          b.id,
        )
      ).data as { id: string };
    const card = (
      await pool.query(
        "SELECT * FROM card WHERE batch_id=$1 ORDER BY id LIMIT 1",
        [b.id],
      )
    ).rows[0];
    await expect(
      pool.query(
        "INSERT INTO card_export_item(export_id,card_id,ordinal,code,qr_payload,card_state,assignment_eligible) VALUES($1,$2,1001,$3,$3,'unassigned',false)",
        [e.id, card.id, card.code],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await prepareCardExport(pool, options, e.id)).toEqual({
      processed: true,
      delivered: true,
    });
  });
  it("ready artifacts require all checksum metadata and cannot be overwritten after publication", async () => {
    const b = await batch(),
      e = (
        await cardsWrite(
          pool,
          adminConfig(),
          adminToken,
          "export",
          { operationId: newId(), expectedVersion: 1, format: "xlsx" },
          b.id,
        )
      ).data as { id: string };
    await expect(
      pool.query(
        "UPDATE card_export SET status='ready',prepared_at=clock_timestamp() WHERE id=$1",
        [e.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await prepareCardExport(pool, options, e.id)).toEqual({
      processed: true,
      delivered: true,
    });
    await expect(
      pool.query("UPDATE card_export SET sha256=repeat('a',64) WHERE id=$1", [
        e.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query("UPDATE card_export SET status='pending' WHERE id=$1", [e.id]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("HTTP validates bodies, origin, cookie surface, oversized input and fixed category", async () => {
    const b = await active(),
      code = (await codes(b.id)).items[0]!.code,
      input = registration(code, "08000001005");
    expect(
      (
        await call("customers", "register", input, undefined, {
          origin: "https://evil.example.test",
        })
      ).response.status,
    ).toBe(403);
    expect(
      (await call("customers", "register", { ...input, attendantId: id(7) }))
        .response.status,
    ).toBe(400);
    expect(
      (await call("customers", "register", { ...input, category: "vehicle" }))
        .response.status,
    ).toBe(400);
    expect(
      (
        await call("customers", "register", {
          ...input,
          extra: "x".repeat(33000),
        })
      ).response.status,
    ).toBe(413);
    const first = await call("customers", "register", input);
    expect(first.response.status, JSON.stringify(first.body)).toBe(201);
    expect(first.response.headers.get("cache-control")).toBe("no-store");
    expect((await call("customers", "register", input)).response.status).toBe(
      200,
    );
  });
});
