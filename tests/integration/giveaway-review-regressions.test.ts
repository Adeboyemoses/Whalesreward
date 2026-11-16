import { readiness } from "../../src/server/modules/giveaway/readiness";
import { it, expect } from "vitest";
import { giveawayFixture } from "../helpers/giveaway-fixture";
import {
  fixtureId,
  historicalSale,
  config,
} from "../helpers/cards-adversarial-fixture";
import {
  contributions,
  campaignData,
} from "../../src/server/modules/giveaway/data";
import { readGiveawayHistory } from "../../src/server/modules/giveaway/history";
import {
  prepareGiveaway,
  confirmGiveaway,
} from "../../src/server/modules/giveaway/service";
import { newId } from "../../src/server/lib/ids";
import { z } from "zod";
it("P-30 unavailable incomplete source crossing cutoff retains unresolved timing without a prior validation block", async () => {
  const f = await giveawayFixture(),
    db = await f.pool.connect();
  try {
    const sale = await historicalSale(f.pool, { state: "photo_pending" });
    const facts = (
      await db.query(
        "SELECT (extract(epoch FROM c.signed_in_at)*1000000)::bigint::text lo,(extract(epoch FROM least(c.offline_expires_at,p.server_received_at))*1000000)::bigint::text hi FROM purchase p JOIN capture_context c ON c.id=p.capture_context_id WHERE p.id=$1",
        [sale.id],
      )
    ).rows[0];
    const bounds = {
      id: f.campaignId,
      settingsVersionId: newId(),
      launch: facts.lo,
      start: facts.lo,
      cutoff: (BigInt(facts.hi) - 1n).toString(),
      deadline: facts.hi,
    };
    const exclusions = [{ purchaseId: sale.id, phoneExclusionId: newId() }];
    const source = (
      await contributions(db, fixtureId(8), bounds, exclusions)
    ).find((s) => s.purchaseId === sale.id)!;
    expect(source.reasons).toContain("timing_unresolved");
    expect(source.reasons).toContain("phone_unavailable");
    expect(source.included).toBe(false);
    const inside = (
      await contributions(
        db,
        fixtureId(8),
        { ...bounds, cutoff: facts.hi },
        exclusions,
      )
    ).find((s) => s.purchaseId === sale.id)!;
    expect(inside.reasons).not.toContain("evidence_deadline_unresolved");
    await f.check();
    const actor = await f.actor(["sales", "leaderboards", "giveawayFinalize"]),
      person = newId();
    await db.query(
      "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
      [person, fixtureId(8)],
    );
    await db.query(
      "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,1,true)",
      [newId(), fixtureId(8), actor.userId, person],
    );
    const census = (
      await db.query(
        "SELECT version,content FROM giveaway_phone_census WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1",
        [f.campaignId],
      )
    ).rows[0];
    const purchase = (
      await db.query("SELECT version FROM purchase WHERE id=$1", [sale.id])
    ).rows[0];
    const proposed = await f.phones.propose(
      f.token,
      f.campaignId,
      census.content.phones[0].id,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional cutoff review",
        ...(await f.guard()),
        expectedCensusVersion: census.version,
        expectedPhoneVersion: 1,
        partialSources: [
          { purchaseId: sale.id, expectedPurchaseVersion: purchase.version },
        ],
      },
    );
    await f.phones.decide(
      actor.token,
      f.campaignId,
      String(proposed.exclusion.id),
      {
        operationId: newId(),
        expectedVersion: 1,
        decision: "approve",
        reason: "Independent fictional review",
      },
    );
    await f.phones.check(f.token, f.campaignId, {
      operationId: newId(),
      kind: "initial",
      reason: "Fictional unavailable phone",
      ...(await f.guard()),
      expectedCensusVersion: census.version,
      entries: [
        {
          phoneId: census.content.phones[0].id,
          expectedPhoneVersion: 1,
          result: "unavailable",
          exclusionId: proposed.exclusion.id,
        },
      ],
    });
    const campaign = (await campaignData(db, fixtureId(8), f.campaignId))!;
    // Feed the real evaluator the same exact boundary facts; phone approval and source facts remain real database records.
    const ready = await readiness(
      db,
      {
        ...campaign,
        launch_us: bounds.launch,
        start_us: bounds.start,
        cutoff_us: bounds.cutoff,
        deadline_us: bounds.deadline,
      },
      fixtureId(5),
    );
    expect(ready.view.counts.uploads).toBe("0");
    expect(ready.view.blockers).toContain("eligibility_unresolved");
    expect(ready.view.canPrepare).toBe(false);
  } finally {
    db.release();
    await f.close();
  }
}, 30000);
it("M4 frozen source included filter is strict, precedes paging and binds cursors", async () => {
  const f = await giveawayFixture();
  try {
    await historicalSale(f.pool, {});
    await historicalSale(f.pool, {});
    await f.check();
    const prepared = await prepareGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional filter review",
        ...(await f.guard()),
      },
      config,
    );
    const preview = z
      .object({ id: z.string(), contentDigest: z.string() })
      .parse(prepared.data);
    const saved = await confirmGiveaway(
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
    const id = z.object({ id: z.string() }).parse(saved.data).id;
    const read = (input: unknown) =>
      readGiveawayHistory(
        f.pool,
        config,
        f.token,
        f.campaignId,
        "snapshots",
        id,
        "sources",
        input,
      );
    const pageSchema = z.object({
      items: z.array(
        z.object({ purchaseId: z.string(), included: z.boolean() }),
      ),
      nextCursor: z.string().nullable(),
    });
    const first = pageSchema.parse(await read({ included: "false", limit: 1 }));
    expect(first.items).toHaveLength(1);
    expect(first.items[0]!.included).toBe(false);
    expect(first.nextCursor).not.toBeNull();
    const second = pageSchema.parse(
      await read({ included: "false", limit: 1, cursor: first.nextCursor }),
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.purchaseId).not.toBe(first.items[0]!.purchaseId);
    expect(pageSchema.parse(await read({ included: "true" })).items).toEqual(
      [],
    );
    await expect(
      read({ included: "true", cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(read({ included: "0" })).rejects.toThrow();
    await expect(
      readGiveawayHistory(
        f.pool,
        config,
        f.token,
        f.campaignId,
        "snapshots",
        id,
        "rows",
        { included: "false" },
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  } finally {
    await f.close();
  }
}, 30000);
