import { readFile, readdir } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { newId } from "../../src/server/lib/ids";
import { digest, sessionSecret } from "../../src/server/modules/auth/crypto";
import { stationWrite } from "../../src/server/modules/station/service";
import { createSyncService } from "../../src/server/modules/sync/service";
import type { EvidenceStorage } from "../../src/server/adapters/storage";
import type { OriginalSale } from "../../src/shared/contracts/sync";
import { newSession } from "../helpers/sync-fixture";
vi.setConfig({ testTimeout: 30000 });
const schema = `station_visibility_${randomBytes(6).toString("hex")}`;
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pool: pg.Pool;
let connectionString: string;
let jpeg: Buffer;
const id = (n: number) =>
  `019a5000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const config = {
  secret: randomBytes(32).toString("hex"),
  origin: "https://station.example.test",
};
let adminToken: string;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
function pauseCommit(pool: pg.Pool) {
  const paused = deferred(),
    resume = deferred();
  const wrapped = new Proxy(pool, {
    get(target, key) {
      if (key === "connect")
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(db, property) {
              if (property === "query")
                return async (...args: unknown[]) => {
                  if (args[0] === "COMMIT") {
                    paused.resolve();
                    await resume.promise;
                  }
                  return Reflect.apply(db.query, db, args);
                };
              const value = Reflect.get(db, property);
              return typeof value === "function" ? value.bind(db) : value;
            },
          });
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { pool: wrapped, paused: paused.promise, resume: resume.resolve };
}
async function capture(pump: string, product: string, hours: number) {
  const userId = newId(),
    attendantId = newId(),
    assignmentId = newId(),
    username = `visibility.${randomBytes(6).toString("hex")}`;
  const start = new Date(Date.now() - hours * 3600000);
  await pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'attendant',$2,$2,'Grace Test',true,1,false,clock_timestamp())",
    [userId, username],
  );
  await pool.query(
    "INSERT INTO attendant(id,user_id,staff_code,version) VALUES($1,$2,$3,1)",
    [attendantId, userId, `TEST-${attendantId}`],
  );
  await pool.query(
    "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,1,clock_timestamp()-interval '30 hours',$4,'Visibility regression capture')",
    [assignmentId, attendantId, pump, id(5)],
  );
  const originalSession = await newSession(
    pool,
    { userId, attendantId, assignmentId, username },
    start,
  );
  const live =
    hours >= 24
      ? await newSession(pool, { userId, attendantId, assignmentId, username })
      : originalSession;
  const price = (
    await pool.query(
      "SELECT *,rate_kobo::text FROM product_price_version WHERE station_id=$1 AND product_id=$2 ORDER BY version DESC LIMIT 1",
      [id(8), product],
    )
  ).rows[0];
  const original: OriginalSale = {
    operationId: newId(),
    captureContextId: originalSession.contextId,
    assignmentId,
    cardCode: "A7K3M9Q",
    appCapturedAt: start.toISOString(),
    priceVersionId: price.id,
    rateKobo: price.rate_kobo,
    currency: "NGN",
    quantityPrecision: price.quantity_precision,
    unit: product === id(12) ? "kilogram" : "litre",
    medium: product === id(12) ? "cylinder" : "vehicle",
    entry: {
      basis: "amount",
      enteredAmountKobo: (BigInt(price.rate_kobo) * 20n).toString(),
      amountKobo: (BigInt(price.rate_kobo) * 20n).toString(),
      quantity: "20",
    },
    photo: {
      sha256: createHash("sha256").update(jpeg).digest("hex"),
      bytes: jpeg.length,
      mediaType: "image/jpeg",
    },
  };
  return { token: live.token, original, price };
}
describe("station activation and credit share committed price history", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    connectionString = url.toString();
    pool = new pg.Pool({ connectionString, max: 12 });
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
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [id(2)],
    );
    const session = newId();
    adminToken = sessionSecret(config.secret, session);
    await pool.query(
      "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',1,clock_timestamp())",
      [session, id(2), digest(adminToken)],
    );
    jpeg = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#777777" },
    })
      .jpeg()
      .toBuffer();
  });
  afterAll(async () => {
    await pool?.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  });
  it.each([
    {
      name: "in-interval rate change",
      product: id(9),
      pump: id(14),
      code: "pms",
      hours: 1,
      precisionOnly: false,
      held: true,
    },
    {
      name: "precision-only change",
      product: id(12),
      pump: id(17),
      code: "cooking_gas",
      hours: 1,
      precisionOnly: true,
      held: false,
    },
    {
      name: "rate change outside original capped interval",
      product: id(11),
      pump: id(16),
      code: "kerosene",
      hours: 25,
      precisionOnly: false,
      held: false,
    },
  ])(
    "I-31/I-32 P-20 $name waits for activation commit then credits only uniform history",
    async (test) => {
      const f = await capture(test.pump, test.product, test.hours);
      const writerPool = new pg.Pool({ connectionString, max: 1 }),
        readerName = `price-reader-${randomBytes(5).toString("hex")}`,
        readerPool = new pg.Pool({
          connectionString,
          max: 4,
          application_name: readerName,
        });
      const barrier = pauseCommit(writerPool),
        storage: EvidenceStorage = {
          signPut: async () => ({
            url: "https://storage.example.test/staging",
            headers: {},
          }),
          read: async () => jpeg,
          writeFinal: async () => {},
        };
      const sync = createSyncService({ pool: readerPool, storage });
      const activation = stationWrite(
        barrier.pool,
        config,
        adminToken,
        "prices-activate",
        {
          operationId: newId(),
          expectedVersion: f.price.version,
          rateKobo: test.precisionOnly
            ? f.price.rate_kobo
            : (BigInt(f.price.rate_kobo) + 10000n).toString(),
          currency: "NGN",
          quantityPrecision: test.precisionOnly
            ? (f.price.quantity_precision + 1) % 7
            : f.price.quantity_precision,
          reason: "Price visibility regression",
        },
        test.code,
      );
      let finished = false;
      let finalization: ReturnType<typeof sync.finalize> | undefined;
      try {
        await barrier.paused;
        const submitted = await sync.submit(f.token, f.original);
        const receivedBefore = (
          await pool.query(
            "SELECT server_received_at::text AS r FROM purchase WHERE id=$1",
            [submitted.status.purchaseId],
          )
        ).rows[0].r;
        const upload = await sync.uploadPermission(
          f.token,
          submitted.status.purchaseId,
          { operationId: newId(), ...f.original.photo },
        );
        finalization = sync
          .finalize(f.token, submitted.status.purchaseId, {
            operationId: newId(),
            expectedVersion: submitted.status.version,
            uploadId: upload.uploadId,
          })
          .then((result) => {
            finished = true;
            return result;
          });
        const blocked = async () => {
          for (let i = 0; i < 200; i++) {
            if (finished) return false;
            const waiting = (
              await pool.query(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory') AS waiting",
                [readerName],
              )
            ).rows[0].waiting;
            if (waiting) return true;
            await delay(5);
          }
          return false;
        };
        expect(
          await blocked(),
          "settlement must wait behind the uncommitted activation",
        ).toBe(true);
        expect(finished).toBe(false);
        expect(
          (
            await pool.query(
              "SELECT 1 FROM sync_validation WHERE purchase_id=$1",
              [submitted.status.purchaseId],
            )
          ).rowCount,
        ).toBe(0);
        barrier.resume();
        await activation;
        const result = await finalization;
        expect(result.credited).toBe(!test.held);
        expect(result.state).toBe(test.held ? "held" : "credited");
        const persisted = (
          await pool.query(
            "SELECT v.reasons,p.server_received_at::text AS r FROM sync_validation v JOIN purchase p ON p.id=v.purchase_id WHERE p.id=$1",
            [result.purchaseId],
          )
        ).rows[0];
        expect(persisted.reasons).toEqual(test.held ? ["price_uncertain"] : []);
        expect(persisted.r).toBe(receivedBefore);
        const times = (
          await pool.query(
            "SELECT (extract(epoch from effective_from)*1000000)::bigint::text AS activation,(extract(epoch from (SELECT server_received_at FROM purchase WHERE id=$2))*1000000)::bigint::text AS receipt FROM product_price_version WHERE product_id=$1 ORDER BY version DESC LIMIT 1",
            [test.product, result.purchaseId],
          )
        ).rows[0];
        expect(BigInt(times.activation) < BigInt(times.receipt)).toBe(true);
      } finally {
        barrier.resume();
        await activation;
        await finalization;
        await writerPool.end();
        await readerPool.end();
      }
    },
  );
});
