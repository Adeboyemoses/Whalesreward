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
import { database } from "../../src/server/lib/db";
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
import { cardOptions } from "../../src/server/modules/cards/config";
import { createMailLoop } from "../../src/server/modules/admin-access/mail-loop";
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
  it("WHR-97 bounded lock waits return retryable JSON without poisoning the request pool", async () => {
    const holder = await pool.connect();
    await holder.query("BEGIN");
    await holder.query(
      "SELECT id FROM security_state WHERE id=true FOR UPDATE",
    );
    try {
      const { response, body } = await call("cards", "list");
      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(body.error).toMatchObject({
        code: "temporarily_unavailable",
        retryable: true,
      });
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
    expect((await call("cards", "list")).response.status).toBe(200);
  });
  it("WHR-97 exhausted request pool returns retryable JSON and recovers", async () => {
    const requestPool = database();
    const clients = [];
    try {
      for (let n = 0; n < requestPool.options.max!; n++)
        clients.push(await requestPool.connect());
      const { response, body } = await call("cards", "list");
      expect(response.status).toBe(503);
      expect(body.error).toMatchObject({
        code: "temporarily_unavailable",
        retryable: true,
      });
    } finally {
      for (const client of clients) client.release();
    }
    expect((await call("cards", "list")).response.status).toBe(200);
  });
  it("WHR-97 hung storage releases admin authority and leaves a retryable export", async () => {
    const b = await batch(5);
    const e = (
      await cardsWrite(
        pool,
        adminConfig(),
        adminToken,
        "export",
        {
          operationId: newId(),
          expectedVersion: b.version,
          format: "xlsx",
        },
        b.id,
      )
    ).data as { id: string };
    const two = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
    });
    let entered!: () => void, finish!: () => void, completed!: () => void;
    let lateKey = "";
    const lateWrite = new Promise<void>((r) => (completed = r));
    const started = new Promise<void>((r) => (entered = r));
    const hung = new Promise<void>((r) => (finish = r));
    const worker = prepareCardExport(
      two,
      {
        storage: {
          ...storage,
          write: async (key, bytes, type) => {
            lateKey = key;
            entered();
            await hung;
            await storage.write(key, bytes, type);
            completed();
          },
        },
      },
      e.id,
    );
    await started;
    try {
      const responsive = await Promise.race([
        cardsRead(two, adminConfig(), adminToken, "cards", {}, b.id).then(
          () => true,
        ),
        new Promise<boolean>((r) => setTimeout(() => r(false), 500)),
      ]);
      expect(responsive).toBe(true);
      expect(
        await Promise.race([
          worker,
          new Promise((r) => setTimeout(() => r("hung"), 6500)),
        ]),
      ).toEqual({ processed: true, delivered: false });
      expect(
        (
          await pool.query(
            "SELECT status,lease_nonce FROM card_export WHERE id=$1",
            [e.id],
          )
        ).rows[0],
      ).toMatchObject({ status: "failed", lease_nonce: null });
      await pool.query(
        "UPDATE card_export SET next_attempt_at=clock_timestamp() WHERE id=$1",
        [e.id],
      );
      expect(await prepareCardExport(pool, options, e.id)).toEqual({
        processed: true,
        delivered: true,
      });
      const ready = (
        await pool.query("SELECT object_key FROM card_export WHERE id=$1", [
          e.id,
        ])
      ).rows[0];
      finish();
      await lateWrite;
      await worker;
      expect(files.has(lateKey)).toBe(true);
      expect(lateKey).not.toBe(ready.object_key);
      expect(
        (
          await pool.query("SELECT object_key FROM card_export WHERE id=$1", [
            e.id,
          ])
        ).rows[0],
      ).toEqual(ready);
    } finally {
      finish();
      await worker;
      await two.end();
    }
  });
  it("WHR-97 hung download is bounded while independent admin requests remain responsive", async () => {
    const b = await batch(5);
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
    await prepareCardExport(pool, options, e.id);
    let entered!: () => void;
    const started = new Promise<void>((r) => (entered = r));
    const download = downloadCardExport(pool, adminToken, b.id, e.id, {
      ...storage,
      read: async () => {
        entered();
        return new Promise<Uint8Array>(() => {});
      },
    });
    const outcome = download.then(
      () => "unexpected",
      (error) => error.code,
    );
    await started;
    expect(
      await Promise.race([
        cardsRead(pool, adminConfig(), adminToken, "cards", {}, b.id).then(
          () => true,
        ),
        new Promise((r) => setTimeout(() => r(false), 500)),
      ]),
    ).toBe(true);
    expect(await outcome).toBe("temporarily_unavailable");
    expect(
      (await downloadCardExport(pool, adminToken, b.id, e.id, storage)).bytes
        .length,
    ).toBeGreaterThan(0);
  });
  it("WHR-97 upload rechecks authority and lease after storage returns", async () => {
    for (const invalidation of ["revoke", "expire"] as const) {
      const b = await batch();
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
      const result = await prepareCardExport(
        pool,
        {
          storage: {
            ...storage,
            write: async (key, bytes, type) => {
              await storage.write(key, bytes, type);
              if (invalidation === "revoke")
                await pool.query(
                  "UPDATE auth_user SET enabled=false WHERE id=$1",
                  [id(2)],
                );
              else
                await pool.query(
                  "UPDATE card_export SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
                  [e.id],
                );
            },
          },
        },
        e.id,
      );
      await pool.query("UPDATE auth_user SET enabled=true WHERE id=$1", [
        id(2),
      ]);
      expect(result).toEqual({ processed: true, delivered: false });
      expect(
        (
          await pool.query("SELECT object_key FROM card_export WHERE id=$1", [
            e.id,
          ])
        ).rows[0].object_key,
      ).toBeNull();
      await pool.query(
        "UPDATE card_export SET status='failed',failure_code='preparation_failed',attempts=3,lease_nonce=NULL,lease_until=NULL WHERE id=$1",
        [e.id],
      );
    }
  });
  it("WHR-97 download does not release bytes after session revocation during storage read", async () => {
    const b = await batch();
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
    await prepareCardExport(pool, options, e.id);
    try {
      await expect(
        downloadCardExport(pool, adminToken, b.id, e.id, {
          ...storage,
          read: async (key, limit) => {
            const bytes = await storage.read(key, limit);
            await pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
              id(2),
            ]);
            return bytes;
          },
        }),
      ).rejects.toMatchObject({ code: "unauthenticated" });
    } finally {
      await pool.query("UPDATE auth_user SET enabled=true WHERE id=$1", [
        id(2),
      ]);
    }
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
  it("I-52 automatically terminalizes two crashed final claims and releases their preparation quota without changing snapshots or inventory", async () => {
    const b = await batch();
    const create = async () =>
      (
        await cardsWrite(
          pool,
          adminConfig(),
          adminToken,
          "export",
          { operationId: newId(), expectedVersion: 1, format: "xlsx" },
          b.id,
        )
      ).data as { id: string };
    const first = await create(),
      second = await create(),
      ids = [first.id, second.id];
    const inventory = (
      await pool.query("SELECT * FROM card WHERE batch_id=$1 ORDER BY id", [
        b.id,
      ])
    ).rows;
    const snapshots = (
      await pool.query(
        "SELECT * FROM card_export_item WHERE export_id=ANY($1::uuid[]) ORDER BY export_id,ordinal",
        [ids],
      )
    ).rows;
    const history = await cardsRead(
      pool,
      adminConfig(),
      adminToken,
      "history",
      {},
      b.id,
    );
    await pool.query(
      "UPDATE card_export SET attempts=3,fencing_version=3,lease_nonce='fictional-crashed-final-claim',lease_until=clock_timestamp()-interval '1 second' WHERE id=ANY($1::uuid[])",
      [ids],
    );
    // Capacity must recover even before the next automatic polling tick.
    const replacement = await create();
    expect(await prepareCardExport(pool, options)).toEqual({
      processed: true,
      delivered: false,
    });
    expect(await prepareCardExport(pool, options)).toEqual({
      processed: true,
      delivered: false,
    });
    const terminal = (
      await pool.query(
        "SELECT id,status,attempts,fencing_version,lease_nonce,lease_until,failure_code,next_attempt_at FROM card_export WHERE id=ANY($1::uuid[]) ORDER BY id",
        [ids],
      )
    ).rows;
    expect(terminal).toHaveLength(2);
    for (const row of terminal)
      expect(row).toMatchObject({
        status: "failed",
        attempts: 3,
        fencing_version: "4",
        lease_nonce: null,
        lease_until: null,
        failure_code: "preparation_failed",
        next_attempt_at: null,
      });
    expect(await prepareCardExport(pool, options, first.id)).toEqual({
      processed: false,
    });
    expect(
      (
        await pool.query("SELECT * FROM card WHERE batch_id=$1 ORDER BY id", [
          b.id,
        ])
      ).rows,
    ).toEqual(inventory);
    expect(
      (
        await pool.query(
          "SELECT * FROM card_export_item WHERE export_id=ANY($1::uuid[]) ORDER BY export_id,ordinal",
          [ids],
        )
      ).rows,
    ).toEqual(snapshots);
    expect(
      await cardsRead(pool, adminConfig(), adminToken, "history", {}, b.id),
    ).toEqual(history);
    expect(await prepareCardExport(pool, options, replacement.id)).toEqual({
      processed: true,
      delivered: true,
    });
  });
  it("I-52 recovers a final renderer that finishes after expiry and fences its bytes permanently", async () => {
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
    await pool.query(
      "UPDATE card_export SET attempts=2,fencing_version=2 WHERE id=$1",
      [e.id],
    );
    const write = vi.fn(storage.write);
    const staleStorage = { ...storage, write };
    let recovery: Awaited<ReturnType<typeof prepareCardExport>> | undefined;
    expect(
      await prepareCardExport(
        pool,
        {
          storage: staleStorage,
          render: async () => {
            await pool.query(
              "UPDATE card_export SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
              [e.id],
            );
            // Another automatic polling step recovers the row while this expired
            // renderer is still running; its eventual bytes must stay fenced.
            recovery = await prepareCardExport(pool, options, e.id);
            return {
              bytes: new Uint8Array([1, 2, 3]),
              contentType:
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              extension: "xlsx",
            };
          },
        },
        e.id,
      ),
    ).toEqual({ processed: true, delivered: false });
    expect(write).not.toHaveBeenCalled();
    expect(recovery).toEqual({ processed: true, delivered: false });
    expect(await prepareCardExport(pool, options, e.id)).toEqual({
      processed: false,
    });
    const row = (
      await pool.query(
        "SELECT status,attempts,object_key,sha256,byte_size,lease_nonce,lease_until,fencing_version FROM card_export WHERE id=$1",
        [e.id],
      )
    ).rows[0];
    expect(row).toEqual({
      status: "failed",
      attempts: 3,
      object_key: null,
      sha256: null,
      byte_size: null,
      lease_nonce: null,
      lease_until: null,
      fencing_version: "4",
    });
    await expect(
      downloadCardExport(pool, adminToken, b.id, e.id, storage),
    ).rejects.toMatchObject({ code: "export_failed" });
  });
  it("I-52 preserves unexpired final claims and their active quota until their leases end", async () => {
    const b = await batch();
    const create = async () =>
      (
        await cardsWrite(
          pool,
          adminConfig(),
          adminToken,
          "export",
          { operationId: newId(), expectedVersion: 1, format: "xlsx" },
          b.id,
        )
      ).data as { id: string };
    const first = await create(),
      second = await create(),
      ids = [first.id, second.id];
    await pool.query(
      "UPDATE card_export SET attempts=3,fencing_version=3,lease_nonce='fictional-live-final-claim',lease_until=clock_timestamp()+interval '1 hour' WHERE id=ANY($1::uuid[])",
      [ids],
    );
    // A retried final attempt retains failed state while rendering; it is
    // still an active preparation until its lease expires.
    await pool.query(
      "UPDATE card_export SET status='failed',failure_code='preparation_failed' WHERE id=$1",
      [second.id],
    );
    const before = (
      await pool.query(
        "SELECT * FROM card_export WHERE id=ANY($1::uuid[]) ORDER BY id",
        [ids],
      )
    ).rows;
    expect(await prepareCardExport(pool, options, first.id)).toEqual({
      processed: false,
    });
    expect(await prepareCardExport(pool, options, second.id)).toEqual({
      processed: false,
    });
    await expect(create()).rejects.toMatchObject({ code: "rate_limited" });
    expect(
      (
        await pool.query(
          "SELECT * FROM card_export WHERE id=ANY($1::uuid[]) ORDER BY id",
          [ids],
        )
      ).rows,
    ).toEqual(before);
    await pool.query(
      "UPDATE card_export SET lease_until=clock_timestamp()-interval '1 second' WHERE id=ANY($1::uuid[])",
      [ids],
    );
    expect(await prepareCardExport(pool, options, first.id)).toEqual({
      processed: true,
      delivered: false,
    });
    expect(await prepareCardExport(pool, options, second.id)).toEqual({
      processed: true,
      delivered: false,
    });
  });
  const printLayout = {
    pageWidthMm: 210,
    pageHeightMm: 297,
    cardWidthMm: 85.6,
    cardHeightMm: 54,
    marginMm: 10,
    gapMm: 2,
  };
  const blockedPdfCases = ["pending", "failed"].flatMap((state) =>
    [0, 1, 2].flatMap((attempts) =>
      ["missing", "malformed"].flatMap((configuration) =>
        ["absent", "expired"].map((lease) => ({
          state,
          attempts,
          configuration,
          lease,
        })),
      ),
    ),
  );
  it.each(blockedPdfCases)(
    "I-52 PDF configuration loss terminalizes $state/$attempts with $configuration layout and $lease lease, one row per polling step",
    async ({ state, attempts, configuration, lease }) => {
      const b = await batch();
      const create = async (format: "pdf" | "xlsx") =>
        (
          await cardsWrite(
            pool,
            adminConfig(),
            adminToken,
            "export",
            { operationId: newId(), expectedVersion: 1, format },
            b.id,
            format === "pdf" ? { layout: printLayout } : undefined,
          )
        ).data as { id: string };
      const first = await create("pdf"),
        second = await create("pdf"),
        ids = [first.id, second.id];
      await pool.query(
        "UPDATE card_export SET status=$2,failure_code=CASE WHEN $2='failed' THEN 'preparation_failed' ELSE NULL END,attempts=$3::int,fencing_version=$3::int,lease_nonce=CASE WHEN $4='expired' THEN 'fictional-expired-pdf' ELSE NULL END,lease_until=CASE WHEN $4='expired' THEN clock_timestamp()-interval '1 second' ELSE NULL END,next_attempt_at=clock_timestamp()+interval '1 hour' WHERE id=ANY($1::uuid[])",
        [ids, state, attempts, lease],
      );
      const immutable = (
        await pool.query(
          "SELECT id,batch_id,created_by,operation_id,format,batch_version,batch_status,batch_code,batch_name,snapshot_at FROM card_export WHERE id=ANY($1::uuid[]) ORDER BY id",
          [ids],
        )
      ).rows;
      const items = (
        await pool.query(
          "SELECT * FROM card_export_item WHERE export_id=ANY($1::uuid[]) ORDER BY export_id,ordinal",
          [ids],
        )
      ).rows;
      const inventory = (
        await pool.query("SELECT * FROM card WHERE batch_id=$1 ORDER BY id", [
          b.id,
        ])
      ).rows;
      const history = await cardsRead(
        pool,
        adminConfig(),
        adminToken,
        "history",
        {},
        b.id,
      );
      vi.stubEnv(
        "WHR_CARD_PRINT_LAYOUT",
        configuration === "missing" ? undefined : "{malformed",
      );
      try {
        const restarted = { ...cardOptions(), storage };
        expect(restarted.layout).toBeUndefined();
        await expect(create("xlsx")).rejects.toMatchObject({
          code: "rate_limited",
        });
        expect(await prepareCardExport(pool, restarted)).toEqual({
          processed: true,
          delivered: false,
        });
        const firstStep = (
          await pool.query(
            "SELECT status,attempts FROM card_export WHERE id=ANY($1::uuid[])",
            [ids],
          )
        ).rows;
        expect(
          firstStep.filter((r) => r.status === "failed" && r.attempts === 3),
        ).toHaveLength(1);
        expect(firstStep.filter((r) => r.attempts === attempts)).toHaveLength(
          1,
        );
        const xlsx = await create("xlsx");
        expect(await prepareCardExport(pool, restarted)).toEqual({
          processed: true,
          delivered: false,
        });
        const terminal = (
          await pool.query(
            "SELECT status,attempts,fencing_version,lease_nonce,lease_until,next_attempt_at,failure_code FROM card_export WHERE id=ANY($1::uuid[])",
            [ids],
          )
        ).rows;
        for (const row of terminal)
          expect(row).toEqual({
            status: "failed",
            attempts: 3,
            fencing_version: String(attempts + 1),
            lease_nonce: null,
            lease_until: null,
            next_attempt_at: null,
            failure_code: "preparation_failed",
          });
        expect(await prepareCardExport(pool, restarted, first.id)).toEqual({
          processed: false,
        });
        expect(await prepareCardExport(pool, restarted, xlsx.id)).toEqual({
          processed: true,
          delivered: true,
        });
        expect(
          (
            await pool.query(
              "SELECT id,batch_id,created_by,operation_id,format,batch_version,batch_status,batch_code,batch_name,snapshot_at FROM card_export WHERE id=ANY($1::uuid[]) ORDER BY id",
              [ids],
            )
          ).rows,
        ).toEqual(immutable);
        expect(
          (
            await pool.query(
              "SELECT * FROM card_export_item WHERE export_id=ANY($1::uuid[]) ORDER BY export_id,ordinal",
              [ids],
            )
          ).rows,
        ).toEqual(items);
        expect(
          (
            await pool.query(
              "SELECT * FROM card WHERE batch_id=$1 ORDER BY id",
              [b.id],
            )
          ).rows,
        ).toEqual(inventory);
        expect(
          await cardsRead(pool, adminConfig(), adminToken, "history", {}, b.id),
        ).toEqual(history);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
  it("I-52 missing layout preserves live pending and retry PDF leases and their quota until expiry", async () => {
    const b = await batch();
    const create = async (format: "pdf" | "xlsx") =>
      (
        await cardsWrite(
          pool,
          adminConfig(),
          adminToken,
          "export",
          { operationId: newId(), expectedVersion: 1, format },
          b.id,
          format === "pdf" ? { layout: printLayout } : undefined,
        )
      ).data as { id: string };
    const first = await create("pdf"),
      second = await create("pdf"),
      ids = [first.id, second.id];
    await pool.query(
      "UPDATE card_export SET attempts=1,fencing_version=1,lease_nonce='fictional-live-pdf',lease_until=clock_timestamp()+interval '1 hour' WHERE id=ANY($1::uuid[])",
      [ids],
    );
    await pool.query(
      "UPDATE card_export SET status='failed',failure_code='preparation_failed',attempts=2,fencing_version=2 WHERE id=$1",
      [second.id],
    );
    const before = (
      await pool.query(
        "SELECT * FROM card_export WHERE id=ANY($1::uuid[]) ORDER BY id",
        [ids],
      )
    ).rows;
    expect(await prepareCardExport(pool, options, first.id)).toEqual({
      processed: false,
    });
    expect(await prepareCardExport(pool, options, second.id)).toEqual({
      processed: false,
    });
    await expect(create("xlsx")).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(
      (
        await pool.query(
          "SELECT * FROM card_export WHERE id=ANY($1::uuid[]) ORDER BY id",
          [ids],
        )
      ).rows,
    ).toEqual(before);
    await pool.query(
      "UPDATE card_export SET lease_until=clock_timestamp()-interval '1 second' WHERE id=ANY($1::uuid[])",
      [ids],
    );
    expect(await prepareCardExport(pool, options, first.id)).toEqual({
      processed: true,
      delivered: false,
    });
    expect(await prepareCardExport(pool, options, second.id)).toEqual({
      processed: true,
      delivered: false,
    });
    const xlsx = await create("xlsx");
    expect(await prepareCardExport(pool, options, xlsx.id)).toEqual({
      processed: true,
      delivered: true,
    });
  });
  it("I-52 configuration-loss recovery preserves a live PDF renderer then fences its late bytes after lease expiry", async () => {
    const b = await batch(),
      e = (
        await cardsWrite(
          pool,
          adminConfig(),
          adminToken,
          "export",
          { operationId: newId(), expectedVersion: 1, format: "pdf" },
          b.id,
          { layout: printLayout },
        )
      ).data as { id: string };
    const write = vi.fn(storage.write);
    let liveResult: Awaited<ReturnType<typeof prepareCardExport>> | undefined,
      recovery: Awaited<ReturnType<typeof prepareCardExport>> | undefined;
    expect(
      await prepareCardExport(
        pool,
        {
          storage: { ...storage, write },
          layout: printLayout,
          render: async () => {
            liveResult = await prepareCardExport(pool, options, e.id);
            await pool.query(
              "UPDATE card_export SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
              [e.id],
            );
            recovery = await prepareCardExport(pool, options, e.id);
            return {
              bytes: new Uint8Array([1, 2, 3]),
              contentType: "application/pdf",
              extension: "pdf",
            };
          },
        },
        e.id,
      ),
    ).toEqual({ processed: true, delivered: false });
    expect(liveResult).toEqual({ processed: false });
    expect(recovery).toEqual({ processed: true, delivered: false });
    expect(write).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          "SELECT status,attempts,fencing_version,object_key,sha256,prepared_at,lease_nonce,lease_until FROM card_export WHERE id=$1",
          [e.id],
        )
      ).rows[0],
    ).toEqual({
      status: "failed",
      attempts: 3,
      fencing_version: "2",
      object_key: null,
      sha256: null,
      prepared_at: null,
      lease_nonce: null,
      lease_until: null,
    });
    expect(
      await prepareCardExport(pool, { ...options, layout: printLayout }, e.id),
    ).toEqual({ processed: false });
  });
  it("I-52 automatic polling terminalizes configuration-blocked PDFs without any GET and resumes independent XLSX", async () => {
    const b = await batch();
    const create = async (format: "pdf" | "xlsx") =>
      (
        await cardsWrite(
          pool,
          adminConfig(),
          adminToken,
          "export",
          { operationId: newId(), expectedVersion: 1, format },
          b.id,
          format === "pdf" ? { layout: printLayout } : undefined,
        )
      ).data as { id: string };
    const first = await create("pdf"),
      second = await create("pdf");
    const tick = async () => {
      let observed!: (
        result: Awaited<ReturnType<typeof prepareCardExport>>,
      ) => void;
      const completed = new Promise<
        Awaited<ReturnType<typeof prepareCardExport>>
      >((resolve) => {
        observed = resolve;
      });
      const loop = createMailLoop({
        processNext: async () => {
          const result = await prepareCardExport(pool, options);
          observed(result);
          return result;
        },
        close: async () => {},
        batchSize: 1,
        report: () => {},
      });
      try {
        return await completed;
      } finally {
        await loop.stop();
      }
    };
    expect(await tick()).toEqual({ processed: true, delivered: false });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM card_export WHERE id=ANY($1::uuid[]) AND status='pending'",
          [[first.id, second.id]],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(await tick()).toEqual({ processed: true, delivered: false });
    const xlsx = await create("xlsx");
    expect(await tick()).toEqual({ processed: true, delivered: true });
    expect(
      (
        await pool.query("SELECT status FROM card_export WHERE id=$1", [
          xlsx.id,
        ])
      ).rows[0].status,
    ).toBe("ready");
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
