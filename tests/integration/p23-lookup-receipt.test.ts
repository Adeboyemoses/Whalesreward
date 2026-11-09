import { createHmac, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { correctionsFixture } from "../helpers/corrections-adversarial-fixture";
import { handleSync } from "../../src/server/modules/sync/http";
import { handleCardsCustomers } from "../../src/server/modules/cards/http";
import { database } from "../../src/server/lib/db";
import { newId } from "../../src/server/lib/ids";
import type { EvidenceStorage } from "../../src/server/adapters/storage";
import { createSyncService } from "../../src/server/modules/sync/service";
import { registerCustomer } from "../../src/server/modules/customers/service";
import { createCorrectionsService } from "../../src/server/modules/corrections/service";
import { createPhoneNormalizer } from "../../src/server/adapters/phone";
import {
  campaign,
  changePrice,
  fixtureId,
  newSession,
  syncFixture,
} from "../helpers/sync-fixture";
import type { LookupReceiptKeys } from "../../src/server/modules/sync/lookup-receipt";
import {
  receipt,
  transaction,
} from "../../src/server/modules/admin-access/repo";

const schema = `p23_${randomBytes(6).toString("hex")}`;
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pool: pg.Pool;
let jpeg: Buffer;
const objects = new Map<string, Buffer>();
const storage: EvidenceStorage = {
  async signPut(key) {
    return { url: key, headers: {} };
  },
  async read(key) {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("Missing test evidence");
    return bytes;
  },
  async writeFinal(key, bytes) {
    objects.set(key, bytes);
  },
};
const key = randomBytes(32);
const ring: LookupReceiptKeys = {
  activeKid: "current",
  keys: new Map([["current", key]]),
};
const config = {
  secret: randomBytes(32).toString("hex"),
  origin: "https://p23.example.test",
};
const normalizer = createPhoneNormalizer({ production: false });
const makeService = (keys = () => ring) =>
  createSyncService({ pool, storage, lookupReceiptKeys: keys });
type Fixture = Awaited<ReturnType<typeof syncFixture>>;
const iso = (ms: number) => new Date(ms).toISOString();

// This independent encoder deliberately implements the wire spec rather than calling production signing.
function sign(
  claims: Record<string, unknown>,
  kid = "current",
  signingKey = key,
) {
  const prefix = `lr1.${kid}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  return `${prefix}.${createHmac("sha256", signingKey).update(prefix).digest("base64url")}`;
}
async function claims(
  f: Fixture,
  issuedAt = iso(f.start.getTime() + 1000),
  db = pool,
) {
  const row = (
    await db.query(
      "SELECT c.id AS card_id,l.id AS link_id,l.customer_id FROM card c JOIN card_customer_link l ON l.card_id=c.id WHERE c.code=$1",
      [f.original.cardCode],
    )
  ).rows[0];
  return {
    version: 1,
    purpose: "capture_lookup",
    captureContextId: f.original.captureContextId,
    originatingAccountId: f.attendantId,
    stationId: f.stationId,
    cardId: row.card_id,
    cardCode: f.original.cardCode,
    customerId: row.customer_id,
    cardCustomerLinkId: row.link_id,
    issuedAt,
    expiresAt: iso(f.start.getTime() + 86400000),
  };
}
async function unusedCard() {
  const id = newId();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = [...randomBytes(7)]
    .map((v) => alphabet[v % alphabet.length])
    .join("");
  await pool.query(
    "INSERT INTO card(id,batch_id,code,qr_payload,state,version) SELECT $1,batch_id,$2,$2,'unassigned',1 FROM card WHERE code='A7K3M9Q'",
    [id, code],
  );
  return { id, code };
}
async function fixture(age = 60000) {
  const f = await syncFixture(pool, jpeg, age);
  const card = await unusedCard();
  const customerId = newId();
  await pool.query(
    "INSERT INTO customer(id,customer_code,name,phone_normalized,category,version) VALUES($1,$2,'Amina Bello',$3,'car_owner',1)",
    [
      customerId,
      `P23-${customerId}`,
      normalizer.normalize(registration(card.code).phone),
    ],
  );
  await pool.query(
    "INSERT INTO card_customer_link(id,card_id,customer_id,linked_at,actor_user_id,reason) VALUES($1,$2,$3,$4,$5,'Fictional P23 history')",
    [
      newId(),
      card.id,
      customerId,
      new Date(f.start.getTime() - 1000),
      fixtureId(2),
    ],
  );
  await pool.query("UPDATE card SET state='linked',version=2 WHERE id=$1", [
    card.id,
  ]);
  f.original.cardCode = card.code;
  return f;
}
async function evidenceRow(id: string) {
  return (
    await pool.query(
      "SELECT lookup_receipt_status,capture_lower_bound,lookup_receipt_claims,lookup_receipt_input,capture_policy_version,server_received_at,payload_digest FROM purchase WHERE id=$1",
      [id],
    )
  ).rows[0];
}
async function finish(f: Fixture, svc = makeService(), original = f.original) {
  const submitted = await svc.submit(f.token, original);
  const upload = await svc.uploadPermission(
    f.token,
    submitted.status.purchaseId,
    { operationId: newId(), ...original.photo },
  );
  const asset = (
    await pool.query("SELECT staging_key FROM photo_asset WHERE id=$1", [
      upload.uploadId,
    ])
  ).rows[0];
  objects.set(asset.staging_key, jpeg);
  const result = await svc.finalize(f.token, submitted.status.purchaseId, {
    operationId: newId(),
    uploadId: upload.uploadId,
    expectedVersion: submitted.status.version,
  });
  return { result, upload, submitted };
}
async function reasons(id: string): Promise<string[]> {
  return (
    await pool.query(
      "SELECT reasons FROM sync_validation WHERE purchase_id=$1",
      [id],
    )
  ).rows[0].reasons;
}
async function register(
  f: Fixture,
  capable = true,
  input?: ReturnType<typeof registration>,
) {
  const card = input ? undefined : await unusedCard();
  const body = input ?? registration(card!.code);
  const result = await registerCustomer(
    pool,
    config,
    f.token,
    body,
    normalizer,
    { receiptCapable: capable, lookupReceiptKeys: () => ring },
  );
  return { ...result, body };
}
function registration(code: string) {
  return {
    operationId: newId(),
    name: "Amina Bello",
    phone: `080${(BigInt(`0x${randomBytes(8).toString("hex")}`) % 100000000n).toString().padStart(8, "0")}`,
    category: "car_owner",
    card: { source: "code", code },
  };
}
function receiptValue(data: unknown): string | null {
  return (data as { lookupReceipt: string | null }).lookupReceipt;
}

describe("P-23 signed lookup lower bound with real PostgreSQL", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    pool = new pg.Pool({ connectionString: url.toString(), max: 15 });
    vi.stubEnv("DATABASE_URL", url.toString());
    vi.stubEnv("BETTER_AUTH_SECRET", config.secret);
    vi.stubEnv("BETTER_AUTH_URL", config.origin);
    vi.stubEnv("WHR_ENV", "test");
    vi.stubEnv("WHR_TRUSTED_IP_HEADER", "x-test-ip");
    vi.stubEnv("WHR_LOOKUP_RECEIPT_ACTIVE_KID", "current");
    vi.stubEnv(
      "WHR_LOOKUP_RECEIPT_KEYS",
      JSON.stringify({ current: key.toString("base64url") }),
    );
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const dir of (await readdir(migrations, { withFileTypes: true }))
      .filter((v) => v.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await pool.query(
        await readFile(
          new URL(`${dir.name}/migration.sql`, migrations),
          "utf8",
        ),
      );
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
  }, 30000);
  afterAll(async () => {
    await database().end();
    await pool?.end();
    vi.unstubAllEnvs();
    await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await root.end();
  });

  it("I-28a register-then-sell is credited with signed evidence while a legacy sale remains held", async () => {
    const f = await fixture();
    const registered = await register(f);
    expect(typeof receiptValue(registered.data)).toBe("string");
    f.original.cardCode = registered.body.card.code;
    const legacy = await finish(f);
    expect(legacy.result.state).toBe("held");
    const capable = await finish(f, makeService(), {
      ...f.original,
      operationId: newId(),
      lookupReceipt: receiptValue(registered.data),
    });
    expect(capable.result.state).toBe("credited");
    expect(
      (await evidenceRow(capable.result.purchaseId)).lookup_receipt_status,
    ).toBe("valid");
  });

  it("I-28b registration freezes evidence even for legacy projection and replay never renews its context", async () => {
    const f = await fixture();
    const first = await register(f, false);
    expect(Object.hasOwn(first.data as object, "lookupReceipt")).toBe(false);
    const replay = await register(f, true, first.body);
    const original = receiptValue(replay.data);
    expect(typeof original).toBe("string");
    f.token = (await newSession(pool, f)).token;
    const again = await register(f, true, first.body);
    expect(receiptValue(again.data) === original).toBe(true);
    expect(again.replayed).toBe(true);
    const parsed = JSON.parse(
      Buffer.from(original!.split(".")[2]!, "base64url").toString(),
    );
    expect(parsed.captureContextId).toBe(f.contextId);
    expect((await register(f, false, first.body)).data).not.toHaveProperty(
      "lookupReceipt",
    );
  });

  it("I-28a lookup derives live context and omits evidence for legacy callers", async () => {
    const f = await fixture();
    const svc = makeService();
    expect(
      await svc.lookup(f.token, { source: "code", code: f.original.cardCode }),
    ).not.toHaveProperty("lookupReceipt");
    const result = await svc.lookup(
      f.token,
      { source: "code", code: f.original.cardCode },
      true,
    );
    const value = receiptValue(result);
    expect(typeof value).toBe("string");
    const c = JSON.parse(
      Buffer.from(value!.split(".")[2]!, "base64url").toString(),
    );
    expect(c.captureContextId).toBe(f.contextId);
    expect(c.originatingAccountId).toBe(f.attendantId);
    expect(c.stationId).toBe(f.stationId);
    expect(Object.keys(c)).toEqual([
      "version",
      "purpose",
      "captureContextId",
      "originatingAccountId",
      "stationId",
      "cardId",
      "cardCode",
      "customerId",
      "cardCustomerLinkId",
      "issuedAt",
      "expiresAt",
    ]);
  });

  it("I-28a absent signing configuration returns null without changing ordinary lookup", async () => {
    const f = await fixture();
    const svc = makeService(() => ({ activeKid: null, keys: new Map() }));
    expect(
      receiptValue(
        await svc.lookup(
          f.token,
          { source: "code", code: f.original.cardCode },
          true,
        ),
      ),
    ).toBeNull();
  });

  it.each(["before", "after"])(
    "I-45b price change %s lookup uses the narrowed interval",
    async (when) => {
      const f = await fixture();
      const t = f.start.getTime() + 30000;
      const changedAt = new Date(t + (when === "before" ? -1000 : 1000));
      const priceId = await changePrice(pool, {
        stationId: f.stationId,
        start: new Date(changedAt.getTime() - 1000),
      });
      f.original = {
        ...f.original,
        priceVersionId: priceId,
        rateKobo: "110000",
        entry: {
          basis: "amount",
          enteredAmountKobo: "2200000",
          amountKobo: "2200000",
          quantity: "20",
        },
        lookupReceipt: sign(await claims(f, iso(t))),
      };
      const { result } = await finish(f);
      expect(result.state).toBe(when === "before" ? "credited" : "held");
      expect(
        (await reasons(result.purchaseId)).includes("price_uncertain"),
      ).toBe(when === "after");
    },
  );

  it.each(["before", "after"])(
    "I-45b campaign start %s lookup retains independent time policy",
    async (when) => {
      const f = await fixture();
      const t = f.start.getTime() + 30000;
      await campaign(
        pool,
        {
          stationId: f.stationId,
          start: new Date(t + (when === "before" ? -2000 : 0)),
        },
        true,
      );
      f.original.lookupReceipt = sign(await claims(f, iso(t)));
      const { result } = await finish(f);
      expect(result.state).toBe(when === "before" ? "credited" : "held");
      expect(
        (await reasons(result.purchaseId)).includes("capture_time_unresolved"),
      ).toBe(when === "after");
    },
  );

  it("I-45b assignment beginning after sign-in but before lookup is evaluated at L", async () => {
    const f = await fixture();
    const t = f.start.getTime() + 30000;
    // A trusted history fixture models an original context whose assignment starts inside [S,L].
    const assignmentId = newId();
    await pool.query("UPDATE assignment SET effective_until=$2 WHERE id=$1", [
      f.assignmentId,
      new Date(t - 1000),
    ]);
    await pool.query(
      "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,2,$4,$5,'Fictional P23 assignment')",
      [assignmentId, f.attendantId, f.pumpId, new Date(t - 1000), fixtureId(5)],
    );
    f.assignmentId = assignmentId;
    const session = await newSession(pool, f, f.start);
    f.token = session.token;
    f.original.captureContextId = session.contextId;
    f.original.assignmentId = assignmentId;
    f.original.lookupReceipt = sign(await claims(f, iso(t)));
    expect((await finish(f)).result.state).toBe("credited");
  });

  it.each(["at lookup", "after lookup"])(
    "I-45b assignment ending %s still blocks credit",
    async (when) => {
      const f = await fixture();
      const t = f.start.getTime() + 30000;
      f.original.lookupReceipt = sign(await claims(f, iso(t)));
      await pool.query("UPDATE assignment SET effective_until=$2 WHERE id=$1", [
        f.assignmentId,
        new Date(t + (when === "at lookup" ? 0 : 1000)),
      ]);
      const nextAssignment = newId();
      await pool.query(
        "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,2,$4,$5,'Fictional fresh assignment')",
        [
          nextAssignment,
          f.attendantId,
          f.pumpId,
          new Date(t + 2000),
          fixtureId(5),
        ],
      );
      f.token = (
        await newSession(pool, { ...f, assignmentId: nextAssignment })
      ).token;
      const { result } = await finish(f);
      expect(result.state).toBe("held");
      expect(await reasons(result.purchaseId)).toContain(
        "capture_authorization_unresolved",
      );
    },
  );

  it.each(["S", "before S", "expiry", "future"])(
    "I-28a exact timing %s accepts only the original composition window",
    async (boundary) => {
      const f = await fixture();
      const t =
        boundary === "S"
          ? f.start.getTime()
          : boundary === "before S"
            ? f.start.getTime() - 1
            : boundary === "expiry"
              ? f.start.getTime() + 86400000
              : Date.now() + 3600000;
      const sale = {
        ...f.original,
        lookupReceipt: sign(await claims(f, iso(t))),
      };
      const submitted = await makeService().submit(f.token, sale);
      const row = await evidenceRow(submitted.status.purchaseId);
      expect(row.lookup_receipt_status).toBe(
        boundary === "S" ? "valid" : "fallback",
      );
      expect(row.capture_lower_bound.toISOString()).toBe(f.start.toISOString());
    },
  );

  it.each([
    "captureContextId",
    "originatingAccountId",
    "stationId",
    "cardId",
    "cardCode",
    "customerId",
    "cardCustomerLinkId",
    "expiresAt",
  ])(
    "I-28a signed %s mismatch falls back without sale rejection",
    async (field) => {
      const f = await fixture();
      const c: Record<string, unknown> = await claims(f);
      c[field] =
        field === "cardCode"
          ? "B7K3M9Q"
          : field === "expiresAt"
            ? iso(f.start.getTime() + 86400001)
            : newId();
      const submitted = await makeService().submit(f.token, {
        ...f.original,
        lookupReceipt: sign(c),
      });
      const row = await evidenceRow(submitted.status.purchaseId);
      expect(row.lookup_receipt_status).toBe("fallback");
      expect(row.lookup_receipt_claims).toBeNull();
      expect(row.capture_lower_bound.toISOString()).toBe(f.start.toISOString());
    },
  );

  it("I-28a malformed JSON evidence and noncanonical signed claims fall back without rejecting saved sales", async () => {
    const f = await fixture();
    const c = await claims(f);
    const good = sign(c);
    const parts = good.split(".");
    const badMac = `${parts[0]}.${parts[1]}.${parts[2]}.${randomBytes(32).toString("base64url")}`;
    const whitespacePayload = Buffer.from(JSON.stringify(c, null, 1)).toString(
      "base64url",
    );
    const prefix = `lr1.current.${whitespacePayload}`;
    const malformed: unknown[] = [
      null,
      false,
      42,
      [],
      {},
      { lookupReceipt: good },
      "x".repeat(2049),
      "lr1.bad.payload.mac",
      badMac,
      `${good}=`,
      sign({ ...c, extra: true }),
      sign({ ...c, version: 2 }),
      `${prefix}.${createHmac("sha256", key).update(prefix).digest("base64url")}`,
    ];
    for (const value of malformed) {
      const submitted = await makeService().submit(f.token, {
        ...f.original,
        operationId: newId(),
        lookupReceipt: value,
      });
      const row = await evidenceRow(submitted.status.purchaseId);
      expect(row.lookup_receipt_status).toBe("fallback");
      expect(row.lookup_receipt_claims).toBeNull();
    }
  });

  it("I-22 evidence is immutable, JSON key order is canonical, and omission/null keep the legacy digest", async () => {
    const f = await fixture();
    const svc = makeService();
    const first = await svc.submit(f.token, f.original);
    expect(
      (await svc.submit(f.token, { ...f.original, lookupReceipt: null })).status
        .purchaseId,
    ).toBe(first.status.purchaseId);
    await expect(
      svc.submit(f.token, {
        ...f.original,
        lookupReceipt: sign(await claims(f)),
      }),
    ).rejects.toMatchObject({ code: "operation_conflict" });
    const invalid = {
      ...f.original,
      operationId: newId(),
      lookupReceipt: { b: 2, a: 1 },
    };
    const second = await svc.submit(f.token, invalid);
    expect(
      (await svc.submit(f.token, { ...invalid, lookupReceipt: { a: 1, b: 2 } }))
        .status.purchaseId,
    ).toBe(second.status.purchaseId);
    await expect(
      svc.submit(f.token, { ...invalid, lookupReceipt: { a: 1, b: 3 } }),
    ).rejects.toMatchObject({ code: "operation_conflict" });
  });

  it("I-28b key rotation retains outstanding evidence and removal never changes a frozen valid receipt", async () => {
    const f = await fixture();
    f.original.lookupReceipt = sign(await claims(f));
    let current = ring;
    const svc = makeService(() => current);
    const first = await svc.submit(f.token, f.original);
    const frozen = await evidenceRow(first.status.purchaseId);
    const next = randomBytes(32);
    current = {
      activeKid: "next",
      keys: new Map([
        ["next", next],
        ["current", key],
      ]),
    };
    const retained = await svc.submit(f.token, {
      ...f.original,
      operationId: newId(),
    });
    expect(
      (await evidenceRow(retained.status.purchaseId)).lookup_receipt_status,
    ).toBe("valid");
    current = { activeKid: "next", keys: new Map([["next", next]]) };
    const retired = await svc.submit(f.token, {
      ...f.original,
      operationId: newId(),
    });
    expect(
      (await evidenceRow(retired.status.purchaseId)).lookup_receipt_status,
    ).toBe("fallback");
    const { result } = await finish(f, svc);
    expect(result.state).toBe("credited");
    const after = await evidenceRow(result.purchaseId);
    expect(after.lookup_receipt_status).toBe("valid");
    expect(after.capture_lower_bound).toEqual(frozen.capture_lower_bound);
    expect(after.server_received_at).toEqual(frozen.server_received_at);
  });

  it("I-28a delayed upload after expiry and fresh authentication keeps original receipt and capped U", async () => {
    const f = await fixture(90000000);
    const expiry = f.start.getTime() + 86400000;
    f.original.lookupReceipt = sign(await claims(f, iso(expiry - 1)));
    f.token = (await newSession(pool, f)).token;
    const { result } = await finish(f);
    expect(result.state).toBe("credited");
    const row = await evidenceRow(result.purchaseId);
    expect(row.lookup_receipt_status).toBe("valid");
    expect(row.capture_lower_bound.toISOString()).toBe(iso(expiry - 1));
  });

  it("I-33 a link ending after U but before delayed R still prevents credit", async () => {
    const f = await fixture(90000000);
    const expiry = f.start.getTime() + 86400000;
    f.original.lookupReceipt = sign(await claims(f, iso(expiry - 1000)));
    f.token = (await newSession(pool, f)).token;
    await pool.query(
      "UPDATE card_customer_link SET ended_at=$2 WHERE card_id=(SELECT id FROM card WHERE code=$1)",
      [f.original.cardCode, new Date(expiry + 1000)],
    );
    const { result } = await finish(f);
    expect(result.state).toBe("held");
    expect(await reasons(result.purchaseId)).toContain(
      "card_policy_unresolved",
    );
  });

  it("I-35 a valid lookup receipt does not clear a price hold or an independent authorization block", async () => {
    const f = await fixture();
    const t = f.start.getTime() + 1000;
    f.original.lookupReceipt = sign(await claims(f, iso(t)));
    await changePrice(pool, { stationId: f.stationId, start: new Date(t) });
    await pool.query("UPDATE capture_context SET revoked_at=$2 WHERE id=$1", [
      f.contextId,
      new Date(t + 2000),
    ]);
    f.token = (await newSession(pool, f)).token;
    const { result } = await finish(f);
    expect(result.state).toBe("held");
    const why = await reasons(result.purchaseId);
    expect(why).toContain("price_uncertain");
    expect(why).toContain("capture_authorization_unresolved");
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM purchase_revision WHERE purchase_id=$1 AND state='accepted'",
          [result.purchaseId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("I-28b correction processing reuses the frozen receipt and lower bound", async () => {
    const f = await fixture();
    const registered = await register(f);
    f.original.cardCode = registered.body.card.code;
    f.original.lookupReceipt = receiptValue(registered.data);
    const { result, upload } = await finish(f);
    expect(result.state).toBe("credited");
    const before = await evidenceRow(result.purchaseId);
    const corrections = createCorrectionsService({ pool, storage });
    await corrections.submit(f.token, result.purchaseId, {
      operationId: newId(),
      expectedVersion: result.version,
      basedOnRevisionId: result.currentRevisionId!,
      edit: { basis: "amount", enteredAmountKobo: "3000000" },
      evidenceAssetId: upload.uploadId,
      reason: "Corrected meter amount",
    });
    await corrections.processNext();
    const after = await evidenceRow(result.purchaseId);
    expect(after.capture_lower_bound).toEqual(before.capture_lower_bound);
    expect(after.lookup_receipt_status).toBe("valid");
    expect(
      JSON.stringify(after.lookup_receipt_claims) ===
        JSON.stringify(before.lookup_receipt_claims),
    ).toBe(true);
    expect(
      (
        await pool.query("SELECT status FROM purchase WHERE id=$1", [
          result.purchaseId,
        ])
      ).rows[0].status,
    ).toBe("credited");
  });
  it("I-28b legacy registration snapshots project null and stay byte-identical", async () => {
    const f = await fixture();
    const first = await register(f);
    const body = { ...first.body, operationId: newId() };
    const legacy: Record<string, unknown> = {
      ...(first.data as Record<string, unknown>),
      operationId: body.operationId,
    };
    delete legacy.lookupReceipt;
    await transaction(pool, (db) =>
      receipt(
        db,
        config,
        { user_id: f.userId },
        "customer-register",
        {
          ...body,
          phone: normalizer.normalize(body.phone),
          card: { code: body.card.code },
        },
        async () => legacy,
      ),
    );
    const before = (
      await pool.query(
        "SELECT result_snapshot::text snapshot FROM mutation_receipt WHERE actor_user_id=$1 AND operation_id=$2",
        [f.userId, body.operationId],
      )
    ).rows[0].snapshot;
    expect(receiptValue((await register(f, true, body)).data)).toBeNull();
    const after = (
      await pool.query(
        "SELECT result_snapshot::text snapshot FROM mutation_receipt WHERE actor_user_id=$1 AND operation_id=$2",
        [f.userId, body.operationId],
      )
    ).rows[0].snapshot;
    expect(after === before).toBe(true);
  });

  it("I-21 concurrent replacement serializes lookup after committed retirement", async () => {
    const f = await fixture();
    const c = await claims(f);
    const db = await pool.connect();
    await db.query("BEGIN");
    await db.query("SELECT id FROM card WHERE id=$1 FOR UPDATE", [c.cardId]);
    const pid = (await db.query("SELECT pg_backend_pid() pid")).rows[0].pid;
    const lookup = makeService()
      .lookup(f.token, { source: "code", code: f.original.cardCode }, true)
      .then(
        () => "issued",
        (e) => (e as { code: string }).code,
      );
    try {
      let blocked = false;
      for (let n = 0; n < 100 && !blocked; n++) {
        blocked = (
          await root.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) blocked",
            [pid],
          )
        ).rows[0].blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(blocked).toBe(true);
      await db.query(
        "UPDATE card_customer_link SET ended_at=clock_timestamp() WHERE id=$1",
        [c.cardCustomerLinkId],
      );
      await db.query(
        "UPDATE card SET state='retired',retired_at=clock_timestamp(),retirement_reason='Fictional concurrent replacement',version=version+1 WHERE id=$1",
        [c.cardId],
      );
      await db.query("COMMIT");
      const outcome = await lookup;
      expect(outcome).toBe("card_unavailable");
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });

  it("I-45b replacement strictly after R does not rewrite captured card eligibility", async () => {
    const f = await fixture();
    const svc = makeService();
    f.original.lookupReceipt = sign(await claims(f));
    const first = await svc.submit(f.token, f.original);
    const c = await claims(f);
    await pool.query(
      "UPDATE card_customer_link SET ended_at=clock_timestamp() WHERE id=$1",
      [c.cardCustomerLinkId],
    );
    await pool.query(
      "UPDATE card SET state='retired',retired_at=clock_timestamp(),retirement_reason='Fictional later replacement',version=version+1 WHERE id=$1",
      [c.cardId],
    );
    const { result } = await finish(f, svc);
    expect(result.purchaseId).toBe(first.status.purchaseId);
    expect(result.state).toBe("credited");
  });
  it("P-23 HTTP capability requires exact 1 and lookup/registration remain no-store", async () => {
    const f = await fixture();
    const card = await unusedCard();
    const body = registration(card.code);
    for (const capability of [undefined, "true", "01", "1"]) {
      const headers: Record<string, string> = {
        cookie: `__Host-whr-session=${f.token}`,
        origin: config.origin,
        "content-type": "application/json",
        "x-test-ip": "10.93.0.1",
      };
      if (capability !== undefined) headers["X-WR-Lookup-Receipt"] = capability;
      const lookup = await handleSync(
        new Request(`${config.origin}/api/attendant/cards/lookup`, {
          method: "POST",
          headers,
          body: JSON.stringify({ source: "code", code: f.original.cardCode }),
        }),
        "lookup",
      );
      expect(lookup.status).toBe(200);
      expect(lookup.headers.get("cache-control")).toBe("no-store");
      expect(Object.hasOwn((await lookup.json()).data, "lookupReceipt")).toBe(
        capability === "1",
      );
      const registrationResponse = await handleCardsCustomers(
        new Request(`${config.origin}/api/attendant/customers/register`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
        "customers",
        "register",
      );
      expect([200, 201].includes(registrationResponse.status)).toBe(true);
      expect(registrationResponse.headers.get("cache-control")).toBe(
        "no-store",
      );
      expect(
        Object.hasOwn(
          (await registrationResponse.json()).data,
          "lookupReceipt",
        ),
      ).toBe(capability === "1");
    }
  });
  it.each([0, 1])(
    "I-33 card link ending R plus %i microseconds respects the exact open boundary",
    async (offset) => {
      const f = await fixture();
      const svc = makeService();
      f.original.lookupReceipt = sign(await claims(f));
      const first = await svc.submit(f.token, f.original);
      const c = await claims(f);
      await pool.query(
        "UPDATE card_customer_link SET ended_at=(SELECT server_received_at FROM purchase WHERE id=$2)+($3::integer * interval '1 microsecond') WHERE id=$1",
        [c.cardCustomerLinkId, first.status.purchaseId, offset],
      );
      const { result } = await finish(f, svc);
      expect(result.state).toBe(offset === 0 ? "held" : "credited");
    },
  );

  it("I-28b database guards prevent rewriting frozen evidence and lower bound", async () => {
    const f = await fixture();
    f.original.lookupReceipt = sign(await claims(f));
    const first = await makeService().submit(f.token, f.original);
    await expect(
      pool.query(
        "UPDATE purchase SET capture_lower_bound=capture_lower_bound+interval '1 second' WHERE id=$1",
        [first.status.purchaseId],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        "UPDATE purchase SET lookup_receipt_input='false'::jsonb WHERE id=$1",
        [first.status.purchaseId],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        "UPDATE purchase SET lookup_receipt_status='fallback',lookup_receipt_claims=NULL WHERE id=$1",
        [first.status.purchaseId],
      ),
    ).rejects.toThrow();
  });

  it("I-36 recovered-correction review preserves P-23 evidence and requires the independent reviewer", async () => {
    // Existing trusted recovery fixture models durable provenance, not a new recovery-intake endpoint.
    const fx = await correctionsFixture();
    try {
      const sale = await fx.sale(
        async (source) => {
          await campaign(fx.pool, source, true);
          source.original = {
            ...source.original,
            lookupReceipt: sign(
              await claims(source, iso(source.start.getTime() + 2000), fx.pool),
            ),
          };
        },
        {
          signedInAt: "2026-11-09T10:00:00.000Z",
          receivedAt: "2026-11-09T11:00:00.000Z",
        },
      );
      expect(sale.status.state).toBe("credited");
      const frozen = async () =>
        (
          await fx.pool.query(
            "SELECT lookup_receipt_status,capture_lower_bound,lookup_receipt_claims,server_received_at FROM purchase WHERE id=$1",
            [sale.purchaseId],
          )
        ).rows[0];
      const before = await frozen();
      expect(before.lookup_receipt_status).toBe("valid");
      const executor = await fx.actor(["sales", "corrections"]),
        authorizer = await fx.actor(["sales", "corrections"]),
        reviewer = await fx.actor(["sales", "corrections"]);
      const recovered = await fx.recovered(sale, executor, authorizer);
      const svc = createCorrectionsService({
        pool: fx.pool,
        storage: fx.storage,
      });
      const input = {
        operationId: newId(),
        expectedVersion: recovered.purchaseVersion,
        expectedRevisionId: sale.revisionId,
        expectedCorrectionVersion: recovered.version,
        outcome: "approve",
        reason: "Independent fictional recovery review",
      };
      await expect(
        svc.decide(
          executor.token,
          sale.purchaseId,
          recovered.correctionId,
          input,
        ),
      ).rejects.toMatchObject({ code: "permission_denied" });
      const result = await svc.decide(
        reviewer.token,
        sale.purchaseId,
        recovered.correctionId,
        input,
      );
      expect(result.creditedAfter).toBe(true);
      expect(JSON.stringify(await frozen()) === JSON.stringify(before)).toBe(
        true,
      );
    } finally {
      await fx.close();
    }
  }, 30000);
  it.each([
    "nul value",
    "unpaired surrogate value",
    "nul key",
    "unpaired surrogate key",
  ])(
    "I-28a arbitrary JSON %s evidence falls back and remains immutable",
    async (kind) => {
      const f = await fixture();
      const svc = makeService();
      const value = kind.startsWith("nul")
        ? String.fromCharCode(0)
        : String.fromCharCode(0xd800);
      const evidence = kind.endsWith("key") ? { [value]: "kept" } : { value };
      const original = { ...f.original, lookupReceipt: evidence };
      const first = await svc.submit(f.token, original);
      expect(
        (await evidenceRow(first.status.purchaseId)).lookup_receipt_status,
      ).toBe("fallback");
      const stored = (
        await pool.query(
          "SELECT lookup_receipt_input_json FROM purchase WHERE id=$1",
          [first.status.purchaseId],
        )
      ).rows[0].lookup_receipt_input_json;
      expect(
        JSON.stringify(JSON.parse(stored)) === JSON.stringify(evidence),
      ).toBe(true);
      expect(
        (await evidenceRow(first.status.purchaseId)).lookup_receipt_input,
      ).toBeNull();
      await expect(
        pool.query(
          "UPDATE purchase SET lookup_receipt_input_json='null' WHERE id=$1",
          [first.status.purchaseId],
        ),
      ).rejects.toThrow();
      expect((await svc.submit(f.token, original)).status.purchaseId).toBe(
        first.status.purchaseId,
      );
      await expect(
        svc.submit(f.token, {
          ...original,
          lookupReceipt: { value: "changed" },
        }),
      ).rejects.toMatchObject({ code: "operation_conflict" });
    },
  );

  it("I-28a deeply nested JSON evidence below the HTTP limit falls back instead of losing the sale", async () => {
    const f = await fixture();
    const nested = "[".repeat(7000) + "0" + "]".repeat(7000);
    const body =
      JSON.stringify(f.original).slice(0, -1) + `,"lookupReceipt":${nested}}`;
    expect(Buffer.byteLength(body)).toBeLessThan(16384);
    const response = await handleSync(
      new Request(`${config.origin}/api/sync/sales`, {
        method: "POST",
        headers: {
          cookie: `__Host-whr-session=${f.token}`,
          origin: config.origin,
          "content-type": "application/json",
          "x-test-ip": "10.93.0.2",
        },
        body,
      }),
      "submit",
    );
    expect(response.status).toBe(201);
    const id = (await response.json()).data.purchaseId;
    expect((await evidenceRow(id)).lookup_receipt_status).toBe("fallback");
  });
});
