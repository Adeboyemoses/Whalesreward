import { z } from "zod";
import { it, expect } from "vitest";
import {
  giveawayFixture,
  pendingGiveawayProposal,
} from "../helpers/giveaway-fixture";
import {
  readReadiness,
  prepareGiveaway,
  confirmGiveaway,
} from "../../src/server/modules/giveaway/service";
import { newId } from "../../src/server/lib/ids";
import { config, historicalSale } from "../helpers/cards-adversarial-fixture";
it("I-46 complete phone checklist permits one frozen initial snapshot", async () => {
  const f = await giveawayFixture();
  try {
    await f.check();
    const r = await readReadiness(f.pool, f.token, f.campaignId);
    expect(r.blockers).toEqual([]);
    const p = await prepareGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional results",
        ...(await f.guard()),
      },
      config,
    );
    const preview = z
      .object({ id: z.string(), contentDigest: z.string() })
      .parse(p.data);
    const body = {
      operationId: newId(),
      previewId: preview.id,
      contentDigest: preview.contentDigest,
      ...(await f.guard()),
    };
    const saved = await confirmGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      body,
      undefined,
      config,
    );
    const replay = await confirmGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      body,
      undefined,
      config,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.data).toEqual(saved.data);
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::text n FROM giveaway_snapshot WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe("1");
    const frozen = (
      await f.pool.query(
        "SELECT to_jsonb(s) AS snapshot FROM giveaway_snapshot s WHERE campaign_id=$1",
        [f.campaignId],
      )
    ).rows;
    await f.check("revision");
    const unchanged = await prepareGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "revision",
        reason: "Fictional unchanged reconciliation",
        ...(await f.guard()),
      },
      config,
    );
    expect(unchanged.data).toMatchObject({ state: "unchanged" });
    expect(
      (
        await f.pool.query(
          "SELECT to_jsonb(s) AS snapshot FROM giveaway_snapshot s WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows,
    ).toEqual(frozen);
    const sale = await historicalSale(f.pool, {});
    await pendingGiveawayProposal(f, sale.id);
    const blocked = await readReadiness(f.pool, f.token, f.campaignId);
    expect(blocked.blockers).toContain("reviews_unresolved");
    await expect(
      prepareGiveaway(
        f.pool,
        f.token,
        f.campaignId,
        {
          operationId: newId(),
          kind: "revision",
          reason: "Fictional pending proposal",
          ...(await f.guard()),
        },
        config,
      ),
    ).rejects.toMatchObject({ code: "finalization_blocked" });
    expect(
      (
        await f.pool.query(
          "SELECT to_jsonb(s) AS snapshot FROM giveaway_snapshot s WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows,
    ).toEqual(frozen);
  } finally {
    await f.close();
  }
}, 30000);

it("SR-06 stale pending proposal with inactive policy and resolved-looking target blocks initial readiness", async () => {
  const f = await giveawayFixture();
  try {
    const sale = await historicalSale(f.pool, {});
    await pendingGiveawayProposal(f, sale.id);
    const r = await readReadiness(f.pool, f.token, f.campaignId);
    expect(r.counts.policyBlocks).toBe("1");
    expect(r.blockers).toContain("reviews_unresolved");
    expect(r.canPrepare).toBe(false);
  } finally {
    await f.close();
  }
}, 30000);
