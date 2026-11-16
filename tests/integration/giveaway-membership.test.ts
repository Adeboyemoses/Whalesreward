import { it, expect } from "vitest";
import {
  cardsFixture,
  fixtureId,
  historicalSale,
} from "../helpers/cards-adversarial-fixture";
import { contributions } from "../../src/server/modules/giveaway/data";
import { newId } from "../../src/server/lib/ids";
it("I-45/P-30 exact capture and details/photo deadline boundaries use durable database facts", async () => {
  const f = await cardsFixture();
  const db = await f.pool.connect();
  try {
    const sale = await historicalSale(f.pool, {});
    const facts = (
      await db.query(
        `SELECT r.evidence_asset_id asset,p.server_received_at,
 (extract(epoch FROM ctx.signed_in_at)*1000000)::bigint::text lo,
 (extract(epoch FROM least(ctx.offline_expires_at,p.server_received_at))*1000000)::bigint::text hi,
 (extract(epoch FROM p.server_received_at)*1000000)::bigint::text details
 FROM purchase p JOIN capture_context ctx ON ctx.id=p.capture_context_id JOIN purchase_revision r ON r.id=p.current_revision_id WHERE p.id=$1`,
        [sale.id],
      )
    ).rows[0];
    const bounds = {
      id: newId(),
      settingsVersionId: newId(),
      launch: facts.lo,
      start: facts.lo,
      cutoff: facts.hi,
      deadline: facts.details,
    };
    let source = (await contributions(db, fixtureId(8), bounds)).find(
      (s) => s.purchaseId === sale.id,
    )!;
    expect(source.reasons).toContain("evidence_deadline_unresolved");
    expect(source.included).toBe(false);
    const observation = newId();
    await db.query(
      "INSERT INTO photo_receipt_observation(id,station_id,purchase_id,asset_id,declared_digest,observed_digest,observed_bytes,sealed_key,receipt_at) SELECT $1,$2,$3,$4,expected_digest,validated_digest,validated_bytes,$5,(SELECT server_received_at FROM purchase WHERE id=$3) FROM photo_asset WHERE id=$4",
      [
        observation,
        fixtureId(8),
        sale.id,
        facts.asset,
        `fictional/sealed/${observation}`,
      ],
    );
    await db.query(
      "INSERT INTO photo_receipt_fact(asset_id,observation_id,purchase_id,receipt_at) SELECT $1,$2,$3,receipt_at FROM photo_receipt_observation WHERE id=$2",
      [facts.asset, observation, sale.id],
    );
    // Match exact DB microseconds, not JS Date's millisecond truncation, in the fictional immutable fixture.
    const photo = (
      await db.query(
        "SELECT (extract(epoch FROM receipt_at)*1000000)::bigint::text at FROM photo_receipt_fact WHERE asset_id=$1",
        [facts.asset],
      )
    ).rows[0].at;
    source = (await contributions(db, fixtureId(8), bounds)).find(
      (s) => s.purchaseId === sale.id,
    )!;
    expect(source.included).toBe(true);
    for (const [patch, reason] of [
      [{ deadline: (BigInt(facts.details) - 1n).toString() }, "upload_late"],
      [{ start: (BigInt(facts.lo) + 1n).toString() }, "timing_unresolved"],
      [{ cutoff: (BigInt(facts.hi) - 1n).toString() }, "timing_unresolved"],
      [{ cutoff: (BigInt(facts.lo) - 1n).toString() }, "outside_period"],
      [
        {
          launch: (BigInt(facts.hi) + 1n).toString(),
          start: (BigInt(facts.hi) + 1n).toString(),
        },
        "before_launch",
      ],
    ] as const) {
      const row = (
        await contributions(db, fixtureId(8), { ...bounds, ...patch })
      ).find((s) => s.purchaseId === sale.id)!;
      expect(row.reasons).toContain(reason);
      expect(row.included).toBe(false);
    }
    expect(photo).toBe(facts.details);
  } finally {
    db.release();
    await f.close();
  }
}, 30000);
