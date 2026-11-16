import { it, expect } from "vitest";
import { z } from "zod";
import { giveawayFixture } from "../helpers/giveaway-fixture";
import { historicalSale, config } from "../helpers/cards-adversarial-fixture";
import {
  prepareGiveaway,
  confirmGiveaway,
} from "../../src/server/modules/giveaway/service";
import { newId } from "../../src/server/lib/ids";
const mutations = {
  cancellation: `UPDATE purchase SET status='cancelled',cancellation_reason='Fictional cancellation',version=version+1 WHERE id=$1`,
  hold: `UPDATE purchase_hold SET state='resolved',resolved_by=(SELECT id FROM admin ORDER BY id LIMIT 1),resolution_operation_id=gen_random_uuid(),resolution_reason='Fictional review',resolved_at=clock_timestamp(),resolution_revision_id=opened_revision_id,version=version+1 WHERE purchase_id=$1`,
  capture_block: `INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES(gen_random_uuid(),$1,'campaign_uncertain','fixture',clock_timestamp(),1)`,
  duplicate: `INSERT INTO duplicate_flag(id,purchase_id,other_purchase_id,reason,state,version) SELECT gen_random_uuid(),least($1::uuid,id),greatest($1::uuid,id),'validated_photo','open',1 FROM purchase WHERE id<>$1 LIMIT 1`,
  customer_display: `UPDATE customer SET name='Amina Bello',version=version+1 WHERE id=(SELECT customer_id FROM purchase WHERE id=$1)`,
  card_display: `UPDATE card SET state='retired',retired_at=clock_timestamp(),retirement_reason='Fictional replacement',version=version+1 WHERE id=(SELECT card_id FROM purchase WHERE id=$1)`,
} as const;
for (const [name, sql] of Object.entries(mutations))
  it(`I-46 ${name} writer commits before confirmation and invalidates the entire reviewed snapshot`, async () => {
    const f = await giveawayFixture();
    let writer;
    try {
      const sale = await historicalSale(
        f.pool,
        name === "hold" ? { state: "held" } : {},
      );
      await historicalSale(f.pool, { amount: "3000000" });
      await f.check();
      const prepared = await prepareGiveaway(
        f.pool,
        f.token,
        f.campaignId,
        {
          operationId: newId(),
          kind: "initial",
          reason: "Fictional writer race",
          ...(await f.guard()),
        },
        config,
      );
      const preview = z
          .object({ id: z.string(), contentDigest: z.string() })
          .parse(prepared.data),
        guard = await f.guard();
      writer = await f.pool.connect();
      await writer.query("BEGIN");
      await writer.query(sql, [sale.id]);
      // The writer retains the shared reporting/campaign boundary until COMMIT.
      const confirmation = confirmGiveaway(
        f.pool,
        f.token,
        f.campaignId,
        {
          operationId: newId(),
          previewId: preview.id,
          contentDigest: preview.contentDigest,
          ...guard,
        },
        undefined,
        config,
      );
      const result = expect(confirmation).rejects.toMatchObject({
        code: "version_conflict",
      });
      await writer.query("COMMIT");
      writer.release();
      writer = undefined;
      await result;
      expect(
        (
          await f.pool.query(
            "SELECT count(*)::text n FROM giveaway_snapshot WHERE campaign_id=$1",
            [f.campaignId],
          )
        ).rows[0].n,
      ).toBe("0");
      const c = (
        await f.pool.query(
          "SELECT reconciliation_required,version FROM campaign WHERE id=$1",
          [f.campaignId],
        )
      ).rows[0];
      expect(c.reconciliation_required).toBe(true);
      expect(c.version).toBeGreaterThan(guard.expectedVersion);
    } finally {
      if (writer) {
        await writer.query("ROLLBACK");
        writer.release();
      }
      await f.close();
    }
  }, 30000);
it("I-46 every durable M3 source table participates in the shared reporting-generation protocol", async () => {
  const f = await giveawayFixture();
  try {
    const tables = [
      "purchase",
      "purchase_revision",
      "purchase_hold",
      "purchase_validation_block",
      "sync_validation",
      "photo_asset",
      "correction_request",
      "duplicate_flag",
      "customer",
      "card",
      "card_customer_link",
      "review_evaluation",
      "held_release_state",
      "photo_receipt_observation",
      "photo_receipt_fact",
    ];
    const rows = (
      await f.pool.query(
        `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid WHERE c.relnamespace=current_schema()::regnamespace AND p.proname='advance_report_generation' AND NOT t.tgisinternal`,
      )
    ).rows.map((r) => r.relname);
    for (const table of tables) expect(rows).toContain(table);
  } finally {
    await f.close();
  }
}, 30000);
it("I-46 actual M3 duplicate clear and cancellation services invalidate reviewed snapshot guards", async () => {
  const { createReviewsService } =
    await import("../../src/server/modules/reviews/service");
  const { evidenceStore } =
    await import("../helpers/corrections-adversarial-fixture");
  for (const outcome of ["keep_both", "cancel"] as const) {
    const f = await giveawayFixture();
    try {
      const a = await historicalSale(f.pool, {}),
        b = await historicalSale(f.pool, {}),
        flag = newId();
      await f.pool.query(
        "INSERT INTO duplicate_flag(id,purchase_id,other_purchase_id,reason,state,version) VALUES($1,$2,$3,'validated_photo','open',1)",
        [flag, ...[a.id, b.id].sort()],
      );
      await f.check();
      const prepared = await prepareGiveaway(
        f.pool,
        f.token,
        f.campaignId,
        {
          operationId: newId(),
          kind: "initial",
          reason: "Fictional reviewed duplicate",
          ...(await f.guard()),
        },
        config,
      );
      const p = z
          .object({ id: z.string(), contentDigest: z.string() })
          .parse(prepared.data),
        guard = await f.guard();
      const purchases = (
        await f.pool.query(
          "SELECT id,version,current_revision_id FROM purchase WHERE id=ANY($1::uuid[]) ORDER BY id",
          [[a.id, b.id]],
        )
      ).rows.map((r) => ({
        id: r.id,
        expectedVersion: r.version,
        expectedRevisionId: r.current_revision_id,
      }));
      await createReviewsService({
        pool: f.pool,
        storage: evidenceStore().storage,
      }).decideDuplicate(f.token, flag, {
        operationId: newId(),
        expectedFlagVersion: 1,
        purchases,
        decision:
          outcome === "cancel"
            ? { outcome, cancelPurchaseId: a.id }
            : { outcome },
        reason: "Fictional duplicate review",
      });
      await expect(
        confirmGiveaway(
          f.pool,
          f.token,
          f.campaignId,
          {
            operationId: newId(),
            previewId: p.id,
            contentDigest: p.contentDigest,
            ...guard,
          },
          undefined,
          config,
        ),
      ).rejects.toMatchObject({ code: "version_conflict" });
    } finally {
      await f.close();
    }
  }
}, 30000);
it.each(["approved", "rejected", "superseded"] as const)(
  "SR-06 persisted %s transition invalidates real giveaway confirmation even after pending blocker closes",
  async (state) => {
    const { pendingGiveawayProposal } =
      await import("../helpers/giveaway-fixture");
    const f = await giveawayFixture();
    try {
      const sale = await historicalSale(f.pool, {});
      await f.check();
      const prepared = await prepareGiveaway(
        f.pool,
        f.token,
        f.campaignId,
        {
          operationId: newId(),
          kind: "initial",
          reason: "Fictional release race",
          ...(await f.guard()),
        },
        config,
      );
      const preview = z
          .object({ id: z.string(), contentDigest: z.string() })
          .parse(prepared.data),
        guard = await f.guard();
      const proposal = await pendingGiveawayProposal(f, sale.id),
        before = await f.guard();
      const db = await f.pool.connect();
      try {
        await db.query("BEGIN");
        await db.query(
          "UPDATE held_release_state SET state=$2,version=version+1 WHERE proposal_id=$1",
          [proposal, state],
        );
        await db.query(
          "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) SELECT $1,$2,2,$3,proposer_id,'{}' FROM held_release_proposal WHERE id=$2",
          [newId(), proposal, state],
        );
        await db.query("COMMIT");
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      } finally {
        db.release();
      }
      expect(BigInt((await f.guard()).expectedDataVersion)).toBeGreaterThan(
        BigInt(before.expectedDataVersion),
      );
      await expect(
        confirmGiveaway(
          f.pool,
          f.token,
          f.campaignId,
          {
            operationId: newId(),
            previewId: preview.id,
            contentDigest: preview.contentDigest,
            ...guard,
          },
          undefined,
          config,
        ),
      ).rejects.toMatchObject({ code: "version_conflict" });
      expect(
        (
          await f.pool.query(
            "SELECT count(*)::text n FROM giveaway_snapshot WHERE campaign_id=$1",
            [f.campaignId],
          )
        ).rows[0].n,
      ).toBe("0");
    } finally {
      await f.close();
    }
  },
  30000,
);
