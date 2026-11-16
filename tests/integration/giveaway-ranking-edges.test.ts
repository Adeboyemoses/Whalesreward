import { it, expect } from "vitest";
import {
  cardsFixture,
  config,
  fixtureId,
  historicalSale,
} from "../helpers/cards-adversarial-fixture";
import { giveawayFixture } from "../helpers/giveaway-fixture";
import { readLeaderboards } from "../../src/server/modules/leaderboards/service";
import { totals } from "../../src/server/modules/reports/data";
import {
  prepareGiveaway,
  confirmGiveaway,
} from "../../src/server/modules/giveaway/service";
import { newId } from "../../src/server/lib/ids";
import { z } from "zod";

it("I-42 category ranks recompute from exact spend without transaction tie breakers", async () => {
  const f = await cardsFixture();
  try {
    const token = await f.owner(),
      third = newId();
    await f.pool.query(
      "INSERT INTO customer(id,customer_code,name,phone_normalized,category,version) VALUES($1,'CUST903','Ada Williams','+2348000000903','car_owner',1)",
      [third],
    );
    await historicalSale(f.pool, {
      customerId: fixtureId(27),
      amount: "3000000",
    });
    await historicalSale(f.pool, {
      customerId: fixtureId(26),
      amount: "1000000",
    });
    await historicalSale(f.pool, {
      customerId: fixtureId(26),
      amount: "1000000",
    });
    await historicalSale(f.pool, { customerId: third, amount: "2000000" });
    const overall = await readLeaderboards(f.pool, config, token, {
      basis: "recorded_all_time",
      limit: 10,
    });
    expect(overall.items.map((r) => r.rank)).toEqual(["1", "2", "2"]);
    const cars = await readLeaderboards(f.pool, config, token, {
      basis: "recorded_all_time",
      category: "car_owner",
      limit: 1,
    });
    expect(cars.items[0]).toMatchObject({ rank: "1", sharedRank: true });
    expect(cars.summary?.purchases).toBe("3");
    expect(cars.customers).toBe("2");
    const next = await readLeaderboards(f.pool, config, token, {
      basis: "recorded_all_time",
      category: "car_owner",
      limit: 1,
      cursor: cars.nextCursor,
    });
    expect(next.items[0]).toMatchObject({ rank: "1", sharedRank: true });
  } finally {
    await f.close();
  }
}, 30000);
it("I-42 huge PostgreSQL contributions sum beyond BIGINT and JS safe integer exactly", async () => {
  const f = await cardsFixture();
  try {
    const token = await f.owner(),
      amount = "9007199254740993000";
    await historicalSale(f.pool, { amount });
    await historicalSale(f.pool, { amount });
    const r = await readLeaderboards(f.pool, config, token, {
      basis: "recorded_all_time",
      limit: 10,
    });
    expect(r.items[0]?.totals.spend).toEqual([
      { currency: "NGN", amountKobo: "18014398509481986000" },
    ]);
    expect(r.summary?.litres).toBe("18014398509481.986");
  } finally {
    await f.close();
  }
}, 30000);
it("I-42 mixed currencies fail ranking and PostgreSQL NUMERIC aggregate overflow never clips", async () => {
  const f = await cardsFixture();
  try {
    const token = await f.owner();
    await historicalSale(f.pool, { currency: "NGN" });
    await expect(
      historicalSale(f.pool, { currency: "USD" }),
    ).rejects.toMatchObject({
      constraint: "ck_product_price_version_currency",
    });
    // Widen only the disposable test schema to exercise the prospective read guard.
    if (!/^cards_adversarial_[a-f0-9]+$/.test(f.schema))
      throw new Error("Disposable fixture required");
    for (const table of [
      "product_price_version",
      "purchase",
      "purchase_revision",
    ])
      await f.pool.query(
        `ALTER TABLE ${table} DROP CONSTRAINT ck_${table}_currency, ADD CONSTRAINT ck_${table}_currency CHECK(currency ~ '^[A-Z]{3}$')`,
      );
    await historicalSale(f.pool, { currency: "USD" });
    await expect(
      readLeaderboards(f.pool, config, token, { basis: "recorded_all_time" }),
    ).rejects.toMatchObject({ code: "currency_mismatch" });
    // Boundary fixtures come from PostgreSQL NUMERIC, exercising the same production aggregate validator.
    const rows = (
      await f.pool.query<{ amountKobo: string; quantity: string }>(
        `SELECT '999999999999999999999999999999'::numeric(30,0)::text AS "amountKobo",'1'::numeric(30,6)::text AS quantity FROM generate_series(1,2)`,
      )
    ).rows;
    expect(() =>
      totals(
        rows.map((r) => ({
          ...r,
          currency: "NGN",
          product: "pms",
          unit: "litre",
        })),
      ),
    ).toThrowError(expect.objectContaining({ code: "aggregate_overflow" }));
  } finally {
    await f.close();
  }
}, 30000);
it("I-46 included customer names card locators and ranks stay frozen after identity changes", async () => {
  const f = await giveawayFixture();
  try {
    const sale = await historicalSale(f.pool, { amount: "2000000" }),
      asset = (
        await f.pool.query(
          "SELECT evidence_asset_id id FROM purchase_revision WHERE id=(SELECT current_revision_id FROM purchase WHERE id=$1)",
          [sale.id],
        )
      ).rows[0].id,
      observation = newId();
    await f.pool.query(
      "INSERT INTO photo_receipt_observation(id,station_id,purchase_id,asset_id,declared_digest,observed_digest,observed_bytes,sealed_key,receipt_at) SELECT $1,$2,$3,id,expected_digest,validated_digest,validated_bytes,$4,clock_timestamp() FROM photo_asset WHERE id=$5",
      [
        observation,
        fixtureId(8),
        sale.id,
        `fictional/seal/${observation}`,
        asset,
      ],
    );
    await f.pool.query(
      "INSERT INTO photo_receipt_fact(asset_id,observation_id,purchase_id,receipt_at) SELECT asset_id,id,purchase_id,receipt_at FROM photo_receipt_observation WHERE id=$1",
      [observation],
    );
    const settings = newId();
    await f.pool.query(
      `INSERT INTO settings_version(id,station_id,campaign_id,version,section,launch_at,purchase_start,purchase_cutoff,grace_hours,upload_deadline,timezone,effective_from,actor_id,reason,timing_policy_version)
 VALUES($1,$2,$3,2,'giveaway','2026-11-01T00:00:00Z','2026-11-02T00:00:00Z',statement_timestamp(),0,statement_timestamp(),'Africa/Lagos',clock_timestamp(),$4,'Fictional finished capture window','campaign-timing-v1')`,
      [settings, fixtureId(8), f.campaignId, fixtureId(5)],
    );
    await f.pool.query(
      "UPDATE campaign SET current_timing_version_id=$2,version=version+1,reconciliation_required=true WHERE id=$1",
      [f.campaignId, settings],
    );
    await f.check();
    const prepared = await prepareGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional frozen identities",
        ...(await f.guard()),
      },
      config,
    );
    const preview = z
      .object({ id: z.string(), contentDigest: z.string() })
      .parse(prepared.data);
    await confirmGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      {
        operationId: newId(),
        previewId: preview.id,
        contentDigest: preview.contentDigest,
        ...(await f.guard()),
      },
      undefined,
      config,
    );
    const frozen = (
      await f.pool.query(
        "SELECT rows FROM giveaway_snapshot WHERE campaign_id=$1",
        [f.campaignId],
      )
    ).rows[0].rows;
    expect(frozen).toHaveLength(1);
    expect(frozen[0]).toMatchObject({ name: "Amina Bello", rank: "1" });
    await f.pool.query(
      "UPDATE customer SET name='Grace Okon',version=version+1 WHERE id=$1",
      [fixtureId(26)],
    );
    await f.pool.query(
      "UPDATE card_customer_link SET ended_at=clock_timestamp() WHERE customer_id=$1 AND ended_at IS NULL",
      [fixtureId(26)],
    );
    const live = await readLeaderboards(f.pool, config, f.token, {
      basis: "campaign_qualifying",
      campaignId: f.campaignId,
    });
    expect(live.items[0]).toMatchObject({ name: "Grace Okon", cardCode: null });
    expect(
      (
        await f.pool.query(
          "SELECT rows FROM giveaway_snapshot WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].rows,
    ).toEqual(frozen);
  } finally {
    await f.close();
  }
}, 30000);
