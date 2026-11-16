import { z } from "zod";
import { it, expect } from "vitest";
import { giveawayFixture } from "../helpers/giveaway-fixture";
import {
  readReadiness,
  prepareGiveaway,
  confirmGiveaway,
} from "../../src/server/modules/giveaway/service";
import { newId } from "../../src/server/lib/ids";
import { config } from "../helpers/cards-adversarial-fixture";
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
  } finally {
    await f.close();
  }
}, 30000);
