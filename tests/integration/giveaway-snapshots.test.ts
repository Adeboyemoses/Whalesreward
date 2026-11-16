import { seedHistorical } from "../helpers/review-evidence-fixture";
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
    expect(r.canPrepare).toBe(true);
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
it("I-46 distinct simultaneous confirmations save one numbered snapshot", async () => {
  const f = await giveawayFixture();
  try {
    await f.check();
    const p = await prepareGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional concurrent results",
        ...(await f.guard()),
      },
      config,
    );
    const preview = z
        .object({ id: z.string(), contentDigest: z.string() })
        .parse(p.data),
      guard = await f.guard();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
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
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
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
it("I-46 changed source lineage saves a linked revision without rewriting its predecessor", async () => {
  const f = await giveawayFixture();
  try {
    async function save(kind: "initial" | "revision") {
      await f.check(kind);
      const p = await prepareGiveaway(
        f.pool,
        f.token,
        f.campaignId,
        {
          operationId: newId(),
          kind,
          reason: "Fictional source reconciliation",
          ...(await f.guard()),
        },
        config,
      );
      const preview = z
          .object({ id: z.string(), contentDigest: z.string() })
          .parse(p.data),
        guard = await f.guard();
      return confirmGiveaway(
        f.pool,
        f.token,
        f.campaignId,
        {
          operationId: newId(),
          previewId: preview.id,
          contentDigest: preview.contentDigest,
          ...guard,
        },
        guard.expectedPreviousSnapshotId ?? undefined,
        config,
      );
    }
    await save("initial");
    const before = (
      await f.pool.query(
        "SELECT id,to_jsonb(s) content FROM giveaway_snapshot s WHERE campaign_id=$1",
        [f.campaignId],
      )
    ).rows[0];
    await historicalSale(f.pool, {});
    await save("revision");
    const rows = (
      await f.pool.query(
        "SELECT id,snapshot_number,previous_snapshot_id FROM giveaway_snapshot WHERE campaign_id=$1 ORDER BY snapshot_number",
        [f.campaignId],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      snapshot_number: 2,
      previous_snapshot_id: before.id,
    });
    expect(
      (
        await f.pool.query(
          "SELECT to_jsonb(s) content FROM giveaway_snapshot s WHERE id=$1",
          [before.id],
        )
      ).rows[0].content,
    ).toEqual(before.content);
  } finally {
    await f.close();
  }
}, 30000);
it("SR-06 a new pending proposal invalidates an already reviewed initial preview", async () => {
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
        reason: "Fictional pending race",
        ...(await f.guard()),
      },
      config,
    );
    const p = z
        .object({ id: z.string(), contentDigest: z.string() })
        .parse(prepared.data),
      guard = await f.guard();
    await pendingGiveawayProposal(f, sale.id);
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
}, 30000);
it("I-46 phantom purchase intake and confirmation serialize without silently losing source history", async () => {
  const f = await giveawayFixture();
  try {
    await f.check();
    const prepared = await prepareGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional intake race",
        ...(await f.guard()),
      },
      config,
    );
    const p = z
        .object({ id: z.string(), contentDigest: z.string() })
        .parse(prepared.data),
      guard = await f.guard();
    const [confirm, intake] = await Promise.allSettled([
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
      historicalSale(f.pool, { state: "received" }),
    ]);
    expect(intake.status).toBe("fulfilled");
    const c = (
      await f.pool.query(
        "SELECT reconciliation_required FROM campaign WHERE id=$1",
        [f.campaignId],
      )
    ).rows[0];
    expect(c.reconciliation_required).toBe(true);
    const count = (
      await f.pool.query(
        "SELECT count(*)::text n FROM giveaway_snapshot WHERE campaign_id=$1",
        [f.campaignId],
      )
    ).rows[0].n;
    expect(count).toBe(confirm.status === "fulfilled" ? "1" : "0");
    const r = await readReadiness(f.pool, f.token, f.campaignId);
    expect(r.canConfirm).toBe(false);
  } finally {
    await f.close();
  }
}, 30000);
it("SR-06 pending proposal blocks unchanged reconciliation of identical snapshot sources", async () => {
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
        reason: "Fictional baseline",
        ...(await f.guard()),
      },
      config,
    );
    const p = z
      .object({ id: z.string(), contentDigest: z.string() })
      .parse(prepared.data);
    await confirmGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      {
        operationId: newId(),
        previewId: p.id,
        contentDigest: p.contentDigest,
        ...(await f.guard()),
      },
      undefined,
      config,
    );
    const before = (
      await f.pool.query(
        "SELECT to_jsonb(s) content FROM giveaway_snapshot s WHERE campaign_id=$1",
        [f.campaignId],
      )
    ).rows;
    await pendingGiveawayProposal(f, sale.id);
    await f.check("revision");
    await expect(
      prepareGiveaway(
        f.pool,
        f.token,
        f.campaignId,
        {
          operationId: newId(),
          kind: "revision",
          reason: "Fictional unchanged attempt",
          ...(await f.guard()),
        },
        config,
      ),
    ).rejects.toMatchObject({ code: "finalization_blocked" });
    expect(
      (
        await f.pool.query(
          "SELECT to_jsonb(s) content FROM giveaway_snapshot s WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows,
    ).toEqual(before);
  } finally {
    await f.close();
  }
}, 30000);
it("I-46 non-superuser cannot update delete or truncate frozen snapshots", async () => {
  const f = await giveawayFixture();
  const role = `snapshot_${newId().replaceAll("-", "")}`;
  let made = false;
  const db = await f.pool.connect();
  try {
    await f.check();
    const prepared = await prepareGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional immutable result",
        ...(await f.guard()),
      },
      config,
    );
    const p = z
      .object({ id: z.string(), contentDigest: z.string() })
      .parse(prepared.data);
    await confirmGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      {
        operationId: newId(),
        previewId: p.id,
        contentDigest: p.contentDigest,
        ...(await f.guard()),
      },
      undefined,
      config,
    );
    const schema = (await db.query("SELECT current_schema() name")).rows[0]
      .name;
    await db.query(`CREATE ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    made = true;
    await db.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await db.query(
      `GRANT SELECT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`,
    );
    await db.query(`SET ROLE ${role}`);
    await expect(
      db.query("UPDATE giveaway_snapshot SET reason=$1 WHERE campaign_id=$2", [
        "Changed",
        f.campaignId,
      ]),
    ).rejects.toThrow();
    await expect(
      db.query("DELETE FROM giveaway_snapshot WHERE campaign_id=$1", [
        f.campaignId,
      ]),
    ).rejects.toThrow();
    await expect(
      db.query("TRUNCATE giveaway_snapshot CASCADE"),
    ).rejects.toThrow();
  } finally {
    await db.query("RESET ROLE");
    if (made) {
      await db.query(`DROP OWNED BY ${role}`);
      await db.query(`DROP ROLE ${role}`);
    }
    db.release();
    await f.close();
  }
}, 30000);
it("I-11 snapshot confirmation checks owner actor and live grant before replay or mutation", async () => {
  const f = await giveawayFixture();
  try {
    await f.check();
    const prepared = await prepareGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional authority checks",
        ...(await f.guard()),
      },
      config,
    );
    const p = z
        .object({ id: z.string(), contentDigest: z.string() })
        .parse(prepared.data),
      body = {
        operationId: newId(),
        previewId: p.id,
        contentDigest: p.contentDigest,
        ...(await f.guard()),
      };
    const other = await f.actor(["leaderboards", "giveawayFinalize"]);
    await expect(
      confirmGiveaway(
        f.pool,
        other.token,
        f.campaignId,
        body,
        undefined,
        config,
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    const saved = await confirmGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      body,
      undefined,
      config,
    );
    await expect(
      confirmGiveaway(
        f.pool,
        f.token,
        f.campaignId,
        { ...body, contentDigest: "b".repeat(64) },
        undefined,
        config,
      ),
    ).rejects.toMatchObject({ code: "operation_conflict" });
    expect(saved.replayed).toBe(false);
    await f.pool.query(
      "DELETE FROM role_permission WHERE permission_code='giveawayFinalize'",
    );
    await expect(
      confirmGiveaway(f.pool, f.token, f.campaignId, body, undefined, config),
    ).rejects.toMatchObject({ code: "permission_denied" });
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
it("I-11 revoked finalization grant after review leaves no snapshot or confirmation audit", async () => {
  const f = await giveawayFixture();
  try {
    await f.check();
    const prepared = await prepareGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional revoked authority",
        ...(await f.guard()),
      },
      config,
    );
    const p = z
        .object({ id: z.string(), contentDigest: z.string() })
        .parse(prepared.data),
      body = {
        operationId: newId(),
        previewId: p.id,
        contentDigest: p.contentDigest,
        ...(await f.guard()),
      };
    await f.pool.query(
      "DELETE FROM role_permission WHERE permission_code='giveawayFinalize'",
    );
    await expect(
      confirmGiveaway(f.pool, f.token, f.campaignId, body, undefined, config),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::text n FROM giveaway_snapshot WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe("0");
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::text n FROM audit_event WHERE action='giveaway_finalized' AND target_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe("0");
  } finally {
    await f.close();
  }
}, 30000);
it("I-46 stale settings predecessor digest and expired review cannot confirm a snapshot", async () => {
  const f = await giveawayFixture();
  try {
    await f.check();
    const prepared = await prepareGiveaway(
      f.pool,
      f.token,
      f.campaignId,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional stale guards",
        ...(await f.guard()),
      },
      config,
    );
    const p = z
        .object({ id: z.string(), contentDigest: z.string() })
        .parse(prepared.data),
      body = {
        previewId: p.id,
        contentDigest: p.contentDigest,
        ...(await f.guard()),
      };
    for (const [patch, code] of [
      [{ expectedSettingsVersionId: newId() }, "version_conflict"],
      [{ expectedPreviousSnapshotId: newId() }, "snapshot_superseded"],
      [{ contentDigest: "b".repeat(64) }, "preview_mismatch"],
    ] as const) {
      await expect(
        confirmGiveaway(
          f.pool,
          f.token,
          f.campaignId,
          { operationId: newId(), ...body, ...patch },
          undefined,
          config,
        ),
      ).rejects.toMatchObject({ code });
    }
    await seedHistorical(
      f.pool,
      "giveaway_preview",
      "UPDATE giveaway_preview SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [p.id],
    );
    await expect(
      confirmGiveaway(
        f.pool,
        f.token,
        f.campaignId,
        { operationId: newId(), ...body },
        undefined,
        config,
      ),
    ).rejects.toMatchObject({ code: "preview_expired" });
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
}, 30000);
