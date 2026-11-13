import { createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { correctionsFixture } from "../helpers/corrections-adversarial-fixture";
import { fixtureId, newSession, syncFixture } from "../helpers/sync-fixture";
import { newId } from "../../src/server/lib/ids";
import { getSession } from "../../src/server/modules/auth/service";
import { createSyncService } from "../../src/server/modules/sync/service";
import { createCorrectionsService } from "../../src/server/modules/corrections/service";
import type { LookupReceiptKeys } from "../../src/server/modules/sync/lookup-receipt";

type Harness = Awaited<ReturnType<typeof correctionsFixture>>;
type Fixture = Awaited<ReturnType<typeof syncFixture>>;
let h: Harness;
const signingKey = randomBytes(32);
const keys: LookupReceiptKeys = {
  activeKid: "preservation",
  keys: new Map([["preservation", signingKey]]),
};
const service = () =>
  createSyncService({
    pool: h.pool,
    storage: h.storage,
    lookupReceiptKeys: () => keys,
  });

async function activate(
  f: Fixture,
  rate: string,
  precision: number,
  effectiveAt?: Date,
  productId = fixtureId(9),
) {
  const id = newId();
  await h.pool.query(
    `INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason)
     SELECT $1,$2,$3,coalesce(max(version),0)+1,$4,'NGN',$5,coalesce($6::timestamptz,clock_timestamp()),$7,'Fictional preservation price'
     FROM product_price_version WHERE station_id=$2 AND product_id=$3`,
    [id, f.stationId, productId, rate, precision, effectiveAt, fixtureId(5)],
  );
  return id;
}

async function readPrices(f: Fixture, receipts = true) {
  const session = await getSession(h.pool, h.config, f.token, newId());
  const lookup = await service().lookup(
    f.token,
    { source: "code", code: f.original.cardCode },
    receipts,
    true,
  );
  expect(lookup.priceRefresh?.price.priceVersionId).toBe(
    session.price.priceVersionId,
  );
  return { session, lookup };
}

async function finish(f: Fixture) {
  const svc = service();
  const submitted = await svc.submit(f.token, f.original);
  const upload = await svc.uploadPermission(
    f.token,
    submitted.status.purchaseId,
    {
      operationId: newId(),
      ...f.original.photo,
    },
  );
  const asset = (
    await h.pool.query("SELECT staging_key FROM photo_asset WHERE id=$1", [
      upload.uploadId,
    ])
  ).rows[0];
  h.objects.set(asset.staging_key, Buffer.from(h.jpeg));
  const result = await svc.finalize(f.token, submitted.status.purchaseId, {
    operationId: newId(),
    uploadId: upload.uploadId,
    expectedVersion: submitted.status.version,
  });
  return { result, upload };
}

async function durableSnapshot(purchaseId: string, contextId: string) {
  const p = await h.pool.query(
    `SELECT row_to_json(p)::text AS purchase,
       (SELECT json_agg(r ORDER BY r.revision_number)::text FROM purchase_revision r WHERE r.purchase_id=p.id) AS revisions,
       (SELECT json_agg(a ORDER BY a.id)::text FROM photo_asset a WHERE a.purchase_id=p.id) AS photos,
       (SELECT json_agg(v ORDER BY v.id)::text FROM purchase_hold v WHERE v.purchase_id=p.id) AS holds,
       (SELECT sum(r.amount_kobo)::text FROM purchase_revision r WHERE r.id=p.current_revision_id AND r.state='accepted') AS accepted_total
     FROM purchase p WHERE p.id=$1`,
    [purchaseId],
  );
  const c = await h.pool.query(
    "SELECT row_to_json(c)::text AS context FROM capture_context c WHERE id=$1",
    [contextId],
  );
  return { ...p.rows[0], ...c.rows[0] };
}

async function historicalReceipt(f: Fixture, issuedAt: Date) {
  const link = (
    await h.pool.query(
      "SELECT c.id AS card_id,l.id AS link_id,l.customer_id FROM card c JOIN card_customer_link l ON l.card_id=c.id WHERE c.code=$1 AND l.ended_at IS NULL",
      [f.original.cardCode],
    )
  ).rows[0];
  const claims = {
    version: 1,
    purpose: "capture_lookup",
    captureContextId: f.contextId,
    originatingAccountId: f.attendantId,
    stationId: f.stationId,
    cardId: link.card_id,
    cardCode: f.original.cardCode,
    customerId: link.customer_id,
    cardCustomerLinkId: link.link_id,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(f.start.getTime() + 86400000).toISOString(),
  };
  // Encode independently so this regression does not test the signer against itself.
  const prefix = `lr1.preservation.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  return `${prefix}.${createHmac("sha256", signingKey).update(prefix).digest("base64url")}`;
}

describe("P-27 refresh preserves saved sales, evidence and settlement", () => {
  beforeAll(async () => {
    h = await correctionsFixture();
  }, 30000);
  afterAll(async () => {
    await h?.close();
  });

  it.each([false, true])(
    "PR-T1-10 activation before lookup narrows L only with P-23=%s",
    async (receipts) => {
      const f = await syncFixture(h.pool, h.jpeg);
      const priceId = await activate(
        f,
        "90000",
        2,
        new Date(f.start.getTime() + 1000),
      );
      const { lookup } = await readPrices(f, receipts);
      expect(lookup.priceRefresh?.price).toMatchObject({
        priceVersionId: priceId,
        rateKobo: "90000",
        version: 2,
      });
      f.original = {
        ...f.original,
        priceVersionId: priceId,
        rateKobo: "90000",
        entry: {
          basis: "amount",
          enteredAmountKobo: "1800000",
          amountKobo: "1800000",
          quantity: "20",
        },
        ...(receipts ? { lookupReceipt: lookup.lookupReceipt } : {}),
      };
      const { result } = await finish(f);
      expect(result.state).toBe(receipts ? "credited" : "held");
      const stored = (
        await h.pool.query(
          "SELECT lookup_receipt_status,capture_lower_bound,signed_in_at FROM purchase p JOIN capture_context c ON c.id=p.capture_context_id WHERE p.id=$1",
          [result.purchaseId],
        )
      ).rows[0];
      expect(stored.lookup_receipt_status).toBe(
        receipts ? "valid" : "fallback",
      );
      if (!receipts)
        expect(stored.capture_lower_bound).toEqual(stored.signed_in_at);
      const before = await durableSnapshot(result.purchaseId, f.contextId);
      await readPrices(f);
      expect(await durableSnapshot(result.purchaseId, f.contextId)).toEqual(
        before,
      );
    },
  );

  it("PR-T1-10 a later refresh and newer receipt cannot clear a saved sale's after-lookup price hold", async () => {
    const f = await syncFixture(h.pool, h.jpeg);
    const initial = await readPrices(f);
    f.original.lookupReceipt = initial.lookup.lookupReceipt;
    await h.pool.query("SELECT pg_sleep(0.002)");
    const priceId = await activate(f, "80000", 3);
    const fresh = await readPrices(f);
    expect(fresh.lookup.priceRefresh?.price.priceVersionId).toBe(priceId);
    const bytes = JSON.stringify(f.original);
    const { result } = await finish(f);
    expect(result.state).toBe("held");
    expect(result.holds.some((hold) => hold.kind === "price")).toBe(true);
    const before = await durableSnapshot(result.purchaseId, f.contextId);
    await readPrices(f);
    expect(
      (await service().submit(f.token, f.original)).status.purchaseId,
    ).toBe(result.purchaseId);
    expect(await durableSnapshot(result.purchaseId, f.contextId)).toEqual(
      before,
    );
    expect(JSON.stringify(f.original)).toBe(bytes);
    await expect(
      service().submit(f.token, {
        ...f.original,
        lookupReceipt: fresh.lookup.lookupReceipt,
      }),
    ).rejects.toMatchObject({ code: "operation_conflict", status: 409 });
  });

  it.each(
    [false, true].flatMap((receipts) =>
      [0, 1].map((offset) => ({ receipts, offset })),
    ),
  )(
    "PR-T1-10 late upload P-23=$receipts retains original U with activation U+$offset ms",
    async ({ receipts, offset }) => {
      const f = await syncFixture(h.pool, h.jpeg, 25 * 3600000);
      const expiry = new Date(f.start.getTime() + 86400000);
      if (receipts)
        f.original.lookupReceipt = await historicalReceipt(
          f,
          new Date(expiry.getTime() - 1000),
        );
      await activate(f, "90000", 2, new Date(expiry.getTime() + offset));
      const originalBytes = JSON.stringify(f.original);
      const originalContext = (
        await h.pool.query(
          "SELECT row_to_json(c)::text AS value FROM capture_context c WHERE id=$1",
          [f.contextId],
        )
      ).rows[0].value;
      const freshSession = await newSession(h.pool, f);
      f.token = freshSession.token;
      const refreshed = await readPrices(f);
      expect(refreshed.lookup.priceRefresh?.captureContextId).toBe(
        freshSession.contextId,
      );
      expect(refreshed.lookup.priceRefresh?.price.rateKobo).toBe("90000");
      const { result } = await finish(f);
      expect(result.state).toBe(offset === 0 ? "held" : "credited");
      const row = (
        await h.pool.query(
          "SELECT p.capture_context_id,p.lookup_receipt_status,p.capture_lower_bound,p.server_received_at,c.offline_expires_at FROM purchase p JOIN capture_context c ON c.id=p.capture_context_id WHERE p.id=$1",
          [result.purchaseId],
        )
      ).rows[0];
      expect(row.capture_context_id).toBe(f.contextId);
      expect(row.offline_expires_at).toEqual(expiry);
      expect(row.server_received_at.getTime()).toBeGreaterThan(
        expiry.getTime(),
      );
      expect(row.lookup_receipt_status).toBe(receipts ? "valid" : "fallback");
      expect(row.capture_lower_bound.getTime()).toBe(
        receipts ? expiry.getTime() - 1000 : f.start.getTime(),
      );
      expect(JSON.stringify(f.original)).toBe(originalBytes);
      expect(
        (
          await h.pool.query(
            "SELECT row_to_json(c)::text AS value FROM capture_context c WHERE id=$1",
            [f.contextId],
          )
        ).rows[0].value,
      ).toBe(originalContext);
    },
  );

  it.each(
    ["amount", "quantity"].flatMap((basis) =>
      ["litre", "kilogram"].map((unit) => ({ basis, unit })),
    ),
  )(
    "PR-T1-08 $basis/$unit retains exact arithmetic and captured precision after precision-only refresh",
    async ({ basis, unit }) => {
      const f = await syncFixture(h.pool, h.jpeg);
      const product = unit === "kilogram" ? fixtureId(12) : fixtureId(9);
      if (unit === "kilogram") {
        const pumpId = newId(),
          assignmentId = newId();
        const assignedAt = new Date(f.start.getTime() - 2000);
        await h.pool.query(
          "INSERT INTO pump(id,station_id,code,product_id,enabled,version) VALUES($1,$2,'GAS01',$3,true,1)",
          [pumpId, f.stationId, product],
        );
        await h.pool.query(
          "UPDATE assignment SET effective_until=$2 WHERE id=$1",
          [f.assignmentId, assignedAt],
        );
        await h.pool.query(
          "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,2,$4,$5,'Fictional gas assignment')",
          [assignmentId, f.attendantId, pumpId, assignedAt, fixtureId(5)],
        );
        Object.assign(f, { pumpId, assignmentId });
        Object.assign(f, await newSession(h.pool, f, f.start));
        f.original.captureContextId = f.contextId;
        f.original.assignmentId = assignmentId;
      }
      const priceId = await activate(
        f,
        "330",
        2,
        new Date(f.start.getTime() - 1000),
        product,
      );
      f.original = {
        ...f.original,
        priceVersionId: priceId,
        rateKobo: "330",
        quantityPrecision: 2,
        unit: unit as "litre" | "kilogram",
        medium: unit === "kilogram" ? "cylinder" : "vehicle",
        entry:
          basis === "amount"
            ? {
                basis: "amount",
                enteredAmountKobo: "17",
                amountKobo: "17",
                quantity: "0.05",
              }
            : {
                basis: "quantity",
                enteredQuantity: "0.05",
                amountKobo: "17",
                quantity: "0.05",
              },
      };
      const initial = await readPrices(f);
      f.original.lookupReceipt = initial.lookup.lookupReceipt;
      const frozen = JSON.stringify(f.original);
      await activate(f, "330", 3, undefined, product);
      expect(
        (await readPrices(f)).lookup.priceRefresh?.price.quantityPrecision,
      ).toBe(3);
      const { result } = await finish(f);
      expect(result.state).toBe("credited");
      const revision = (
        await h.pool.query(
          "SELECT amount_kobo::text,quantity::text,quantity_precision,unit,basis,rate_kobo::text FROM purchase_revision WHERE id=$1",
          [result.currentRevisionId],
        )
      ).rows[0];
      expect(revision).toMatchObject({
        amount_kobo: "17",
        quantity: "0.050000",
        quantity_precision: 2,
        unit,
        basis,
        rate_kobo: "330",
      });
      expect(JSON.stringify(f.original)).toBe(frozen);
      const snapshot = await durableSnapshot(result.purchaseId, f.contextId);
      await readPrices(f);
      expect(await durableSnapshot(result.purchaseId, f.contextId)).toEqual(
        snapshot,
      );
    },
  );

  it.each([false, true])(
    "PR-T1-11 refresh leaves finalized and corrected revisions, evidence bytes, digests and accepted totals unchanged with P-23=%s",
    async (receipts) => {
      const f = await syncFixture(h.pool, h.jpeg);
      const lookedUp = await readPrices(f, receipts);
      if (receipts) f.original.lookupReceipt = lookedUp.lookup.lookupReceipt;
      const frozen = JSON.stringify(f.original);
      const { result, upload } = await finish(f);
      expect(result.state).toBe("credited");
      const corrections = createCorrectionsService({
        pool: h.pool,
        storage: h.storage,
      });
      await corrections.submit(f.token, result.purchaseId, {
        operationId: newId(),
        expectedVersion: result.version,
        basedOnRevisionId: result.currentRevisionId!,
        edit: { basis: "amount", enteredAmountKobo: "3000000" },
        evidenceAssetId: upload.uploadId,
        reason: "Corrected meter amount",
      });
      await corrections.processNext();
      const before = await durableSnapshot(result.purchaseId, f.contextId);
      expect(before.accepted_total).toBe("3000000");
      const blobs = [...h.objects].map(([name, value]) => [
        name,
        value.toString("hex"),
      ]);
      await activate(f, "70000", 4);
      await readPrices(f);
      await readPrices(f);
      expect(
        (await service().submit(f.token, f.original)).status.purchaseId,
      ).toBe(result.purchaseId);
      expect(await durableSnapshot(result.purchaseId, f.contextId)).toEqual(
        before,
      );
      expect(
        [...h.objects].map(([name, value]) => [name, value.toString("hex")]),
      ).toEqual(blobs);
      expect(JSON.stringify(f.original)).toBe(frozen);
    },
  );
});
