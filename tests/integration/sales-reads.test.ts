import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { newId } from "../../src/server/lib/ids";
import { digest } from "../../src/server/modules/auth/crypto";
import { readSales } from "../../src/server/modules/sales/service";
import { readSalePhoto } from "../../src/server/modules/sales/evidence";
import { createSyncService } from "../../src/server/modules/sync/service";
import {
  newSession,
  campaign,
  fixtureId as id,
  sha256,
} from "../helpers/sync-fixture";
import type { OriginalSale } from "../../src/shared/contracts/sync";
import type { SaleEvidenceReader } from "../../src/server/adapters/sale-evidence";
import { handleSalesRead } from "../../src/server/modules/sales/http";
import { salePageSchema } from "../../src/shared/contracts/sales";
import { COOKIE } from "../../src/server/modules/admin-access/http";
vi.setConfig({ testTimeout: 30000 });
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const schema = `sales_reads_${randomBytes(6).toString("hex")}`;
let pool: pg.Pool,
  jpeg: Buffer,
  attendant: Awaited<ReturnType<typeof newSession>>,
  other: Awaited<ReturnType<typeof newSession>>,
  adminToken: string;
const config = {
  secret: randomBytes(32).toString("hex"),
  origin: "https://sales.example.test",
};
const files = new Map<string, Buffer>();
const storage = {
  async signPut() {
    return { url: "https://storage.example.test/put", headers: {} };
  },
  async read() {
    return jpeg;
  },
  async writeFinal(key: string, bytes: Buffer) {
    files.set(key, bytes);
  },
};
const reader: SaleEvidenceReader = {
  async read(key) {
    const b = files.get(key);
    if (!b) throw new Error("Missing");
    return b;
  },
  async available(key, bytes) {
    return BigInt(files.get(key)?.length ?? 0) === bytes;
  },
  async signGet() {
    return "https://storage.example.test/private?fictional-signature";
  },
};
let service: ReturnType<typeof createSyncService>;
async function sale(amount = "2000000") {
  const input: OriginalSale = {
    operationId: newId(),
    captureContextId: attendant.contextId,
    assignmentId: id(18),
    cardCode: "A7K3M9Q",
    appCapturedAt: new Date().toISOString(),
    priceVersionId: id(20),
    rateKobo: "100000",
    currency: "NGN",
    quantityPrecision: 2,
    unit: "litre",
    medium: "vehicle",
    entry: {
      basis: "amount",
      enteredAmountKobo: amount,
      amountKobo: amount,
      quantity: (BigInt(amount) / 1000n).toString().replace(/(..)$/, ".$1"),
    },
    photo: {
      sha256: sha256(jpeg),
      bytes: jpeg.length,
      mediaType: "image/jpeg",
    },
  };
  // amountToQuantity in production derives the exact rounded display quantity.
  const { amountToQuantity } = await import("../../src/shared/quantity");
  input.entry.quantity = amountToQuantity(BigInt(amount), 100000n, 2);
  const submitted = await service.submit(attendant.token, input);
  const uploaded = await service.uploadPermission(
    attendant.token,
    submitted.status.purchaseId,
    { operationId: newId(), ...input.photo },
  );
  const result = await service.finalize(
    attendant.token,
    submitted.status.purchaseId,
    {
      operationId: newId(),
      uploadId: uploaded.uploadId,
      expectedVersion: submitted.status.version,
    },
  );
  return result;
}
async function adminSearch(input: unknown = {}) {
  return salePageSchema.parse(
    await readSales(pool, config, adminToken, "admin", "search", input),
  );
}

describe("M3 sales reads and private evidence", () => {
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
      [[id(2), id(3), id(4)]],
    );
    attendant = await newSession(pool, {
      userId: id(3),
      attendantId: id(6),
      assignmentId: id(18),
      username: "grace.okon",
    });
    other = await newSession(pool, {
      userId: id(4),
      attendantId: id(7),
      assignmentId: id(19),
      username: "favour.james",
    });
    adminToken = randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,created_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 day',1,clock_timestamp(),clock_timestamp())",
      [newId(), id(2), digest(adminToken)],
    );
    await campaign(
      pool,
      { stationId: id(8), start: new Date(Date.now() - 60000) },
      false,
    );
    jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#fff" },
    })
      .jpeg()
      .toBuffer();
    service = createSyncService({ pool, storage });
    process.env.BETTER_AUTH_SECRET = config.secret;
    process.env.BETTER_AUTH_URL = config.origin;
    process.env.WHR_ENV = "test";
  }, 30000);
  afterAll(async () => {
    await pool?.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  });
  it("reads own accepted sale and denies foreign IDs, wrong kind and restricted sessions", async () => {
    const s = await sale(),
      purchaseId = s.purchaseId;
    const own = await readSales(
      pool,
      config,
      attendant.token,
      "attendant",
      "detail",
      {},
      purchaseId,
    );
    expect(own).toMatchObject({
      id: purchaseId,
      credited: true,
      displayedValues: { amountKobo: "2000000" },
      historyCursors: { revisions: null, corrections: null, decisions: null },
    });
    expect(JSON.stringify(own)).not.toContain("actor");
    expect(JSON.stringify(own)).not.toContain("phone");
    expect(JSON.stringify(own)).not.toContain("+234");
    await expect(
      readSales(
        pool,
        config,
        other.token,
        "attendant",
        "detail",
        {},
        purchaseId,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      readSales(
        pool,
        config,
        attendant.token,
        "admin",
        "detail",
        {},
        purchaseId,
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    const restrictedToken = randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,capture_context_id,access_scope) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',1,clock_timestamp(),$4,'first_password')",
      [newId(), id(4), digest(restrictedToken), other.contextId],
    );
    await expect(
      readSales(pool, config, restrictedToken, "attendant", "list"),
    ).rejects.toMatchObject({ code: "password_change_required" });
  });
  it("uses current accepted exact amounts for filtered whole-result totals and duplicates remain included", async () => {
    const first = await sale("9007199254740993"),
      second = await sale("100000");
    await pool.query(
      "INSERT INTO duplicate_flag(id,purchase_id,other_purchase_id,reason,state,version) VALUES($1,$2,$3,'Fictional suspected pair','open',1)",
      [newId(), ...[first.purchaseId, second.purchaseId].sort()],
    );
    const page = await adminSearch({ status: "duplicate", limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.summary).toMatchObject({
      records: "2",
      completed: "2",
      spend: [{ amountKobo: "9007199254840993" }],
    });
    expect(page.nextCursor).toBeTruthy();
    const next = await adminSearch({
      status: "duplicate",
      limit: 1,
      cursor: page.nextCursor,
    });
    expect(next.items[0]!.id).not.toBe(page.items[0]!.id);
    await expect(
      adminSearch({ status: "all", limit: 1, cursor: page.nextCursor }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(
      (await adminSearch({ query: "Amina", customerId: id(27) })).items,
    ).toHaveLength(0);
    expect((await adminSearch({ query: "+2348000000026" })).items).toHaveLength(
      0,
    );
    expect(JSON.stringify(page)).not.toContain("phone");
  });
  it("history and detail share strict privacy projection and exact numeric values", async () => {
    const s = await sale("9007199254740993");
    const own = await readSales(
      pool,
      config,
      attendant.token,
      "attendant",
      "history",
      { kind: "revisions" },
      s.purchaseId,
    );
    expect(own).toMatchObject({
      items: [{ values: { amountKobo: "9007199254740993" } }],
    });
    expect(JSON.stringify(own)).not.toContain("actor");
    const admin = await readSales(
      pool,
      config,
      adminToken,
      "admin",
      "detail",
      {},
      s.purchaseId,
    );
    expect(admin).toMatchObject({
      original: { amountKobo: "9007199254740993" },
      replacement: null,
      revisions: [{ actor: { code: "STAFF002" } }],
    });
  });
  it("an expired capture window does not deny reads or renew it", async () => {
    const expired = await newSession(
      pool,
      {
        userId: id(3),
        attendantId: id(6),
        assignmentId: id(18),
        username: "grace.okon",
      },
      new Date(Date.now() - 25 * 3600000),
    );
    const before = (
      await pool.query(
        "SELECT last_online_sign_in_at FROM auth_session WHERE id=$1",
        [expired.sessionId],
      )
    ).rows[0];
    await expect(
      readSales(pool, config, expired.token, "attendant", "list"),
    ).resolves.toMatchObject({ items: expect.any(Array) });
    expect(
      (
        await pool.query(
          "SELECT last_online_sign_in_at FROM auth_session WHERE id=$1",
          [expired.sessionId],
        )
      ).rows[0],
    ).toEqual(before);
  });
  it("serves only own validated bytes and binds signed access to the selected asset", async () => {
    const s = await sale();
    const photo = (
      await pool.query("SELECT id FROM photo_asset WHERE purchase_id=$1", [
        s.purchaseId,
      ])
    ).rows[0].id;
    const own = await readSalePhoto(
      pool,
      attendant.token,
      "attendant",
      s.purchaseId,
      {},
      () => reader,
    );
    expect(own).toEqual(jpeg);
    expect(
      await readSalePhoto(
        pool,
        adminToken,
        "admin",
        s.purchaseId,
        { assetId: photo },
        () => reader,
      ),
    ).toMatchObject({
      assetId: photo,
      url: expect.stringContaining("https://storage.example.test/"),
    });
    await expect(
      readSalePhoto(
        pool,
        adminToken,
        "admin",
        s.purchaseId,
        { assetId: newId() },
        () => reader,
      ),
    ).rejects.toMatchObject({ code: "evidence_unavailable" });
    const factory = vi.fn(() => {
      throw new Error("No config");
    });
    await expect(
      readSalePhoto(pool, other.token, "attendant", s.purchaseId, {}, factory),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(factory).not.toHaveBeenCalled();
    await expect(
      readSalePhoto(
        pool,
        attendant.token,
        "attendant",
        s.purchaseId,
        {},
        factory,
      ),
    ).rejects.toMatchObject({ code: "storage_unavailable" });
    await expect(
      readSalePhoto(
        pool,
        adminToken,
        "admin",
        s.purchaseId,
        { assetId: photo },
        () => ({ ...reader, available: async () => false }),
      ),
    ).rejects.toMatchObject({ code: "evidence_unavailable" });
    await expect(
      readSalePhoto(
        pool,
        attendant.token,
        "attendant",
        s.purchaseId,
        {},
        () => ({ ...reader, read: async () => Buffer.from("changed") }),
      ),
    ).rejects.toMatchObject({ code: "evidence_unavailable" });
  });
  it("photo/search HTTP is private, no-store and rejects GET search or unknown query fields", async () => {
    const request = new Request(`${config.origin}/api/admin/sales/search`, {
      method: "POST",
      headers: {
        origin: config.origin,
        "content-type": "application/json",
        cookie: `${COOKIE}=${adminToken}`,
      },
      body: JSON.stringify({ query: "Amina" }),
    });
    const response = await handleSalesRead(request, "admin", "search");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("phone");
    const get = await handleSalesRead(
      new Request(`${config.origin}/api/admin/sales/search`),
      "admin",
      "search",
    );
    expect(get.status).toBe(400);
  });
});
