import { it, expect } from "vitest";
import { z } from "zod";
import {
  evidenceDatabase,
  seedHistorical,
} from "../helpers/review-evidence-fixture";
import { heldReleaseRuntimeFixture } from "../helpers/giveaway-release-fixture";
import { giveawayAtStation } from "../helpers/giveaway-at-station-fixture";
import {
  prepareGiveaway,
  confirmGiveaway,
  readReadiness,
} from "../../src/server/modules/giveaway/service";
import { createReviewsService } from "../../src/server/modules/reviews/service";
import { newId } from "../../src/server/lib/ids";
import { config } from "../helpers/cards-adversarial-fixture";
it.each(["approve", "reject", "supersede"] as const)(
  "SR-06 real %s transition changes giveaway generation and invalidates prepared results",
  async (outcome) => {
    const db = await evidenceDatabase();
    try {
      const x = await heldReleaseRuntimeFixture(db);
      const f = await giveawayAtStation(db.pool, x.f.stationId, x.token);
      await f.check();
      const prepared = await prepareGiveaway(
        db.pool,
        x.token,
        f.campaignId,
        {
          operationId: newId(),
          kind: "initial",
          reason: "Fictional terminal transition race",
          ...(await f.guard()),
        },
        config,
      );
      const preview = z
          .object({ id: z.string(), contentDigest: z.string() })
          .parse(prepared.data),
        guard = await f.guard();
      const proposed = await x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        ...(await x.h.guard(x.sale.purchaseId)),
      });
      const pending = await readReadiness(db.pool, x.token, f.campaignId);
      expect(pending.blockers).toContain("reviews_unresolved");
      const generationBefore = (await f.guard()).expectedDataVersion;
      const transition = async () => {
        if (outcome === "supersede") {
          for (const [table, sql] of [
            [
              "card",
              "UPDATE card SET retired_at='2026-11-10T11:59:00Z' WHERE id=(SELECT card_id FROM purchase WHERE id=$1)",
            ],
            [
              "card_customer_link",
              "UPDATE card_customer_link SET ended_at='2026-11-10T11:59:00Z' WHERE card_id=(SELECT card_id FROM purchase WHERE id=$1) AND ended_at IS NOT NULL",
            ],
            [
              "audit_event",
              "UPDATE audit_event SET occurred_at='2026-11-10T11:59:00Z' WHERE action='card_replaced' AND target_id=(SELECT card_id FROM purchase WHERE id=$1)",
            ],
          ])
            await seedHistorical(db.pool, table!, sql!, [x.sale.purchaseId]);
          const svc = createReviewsService({
            pool: db.pool,
            storage: x.h.storage,
            env: {
              WHR_ENV: "test",
              WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.policy),
            },
          });
          const result = await svc.decideCard(
            x.token,
            x.sale.purchaseId,
            x.holdId,
            {
              ...(await x.h.guard(x.sale.purchaseId)),
              expectedHoldVersion: 1,
              outcome: "cancel",
              evidence: x.evidence,
            },
          );
          const event = (
            await db.pool.query(
              "SELECT related_event_ids FROM audit_event WHERE action='held_release_superseded' AND target_id=$1",
              [x.sale.purchaseId],
            )
          ).rows[0];
          expect(event.related_event_ids).toContain(result.auditEventId);
        } else
          await x.svc.decide(
            x.reviewerToken,
            x.sale.purchaseId,
            proposed.proposal.id,
            {
              ...(await x.h.guard(x.sale.purchaseId)),
              expectedProposalVersion: 1,
              outcome,
            },
          );
      };
      const raced = await Promise.allSettled([
        transition(),
        confirmGiveaway(
          db.pool,
          x.token,
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
      ]);
      expect(raced[0]!.status).toBe("fulfilled");
      expect(raced[1]!.status).toBe("rejected");
      expect(BigInt((await f.guard()).expectedDataVersion)).toBeGreaterThan(
        BigInt(generationBefore),
      );
      expect(
        (
          await db.pool.query(
            "SELECT state FROM held_release_state WHERE proposal_id=$1",
            [proposed.proposal.id],
          )
        ).rows[0].state,
      ).toBe(
        outcome === "approve"
          ? "approved"
          : outcome === "reject"
            ? "rejected"
            : "superseded",
      );
      await expect(
        confirmGiveaway(
          db.pool,
          x.token,
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
          await db.pool.query(
            "SELECT count(*)::text n FROM giveaway_snapshot WHERE campaign_id=$1",
            [f.campaignId],
          )
        ).rows[0].n,
      ).toBe("0");
    } finally {
      await db.close();
    }
  },
  30000,
);
