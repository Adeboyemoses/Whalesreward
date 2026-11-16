import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../../src/server/lib/ids";
import { assertAppliedReleaseConsistency } from "../../src/server/modules/reviews/release-integrations";
import type { AttestedPredicate } from "../../src/server/modules/reviews/release-consistency";
import { evidenceDatabase } from "../helpers/review-evidence-fixture";
import { heldReleaseFixture } from "../helpers/held-release-fixture";
let db: Awaited<ReturnType<typeof evidenceDatabase>>;
describe("P-29 retained cross-target PostgreSQL consistency", () => {
  beforeAll(async () => {
    db = await evidenceDatabase();
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });
  it.each(["day", "campaign"] as const)(
    "SR-02a overlapping retained %s contradictions deny SQL and later contribution checks",
    async (kind) => {
      const x = await heldReleaseFixture(db);
      const purchase = x.sale.purchaseId;
      const sheet = newId();
      await db.pool.query(
        `INSERT INTO held_release_sheet(id,purchase_id,station_id,uploader_id,uploader_person_id,target,sha256,bytes,staging_key,expires_at) VALUES($1,$2,$3,$4,$5,'{}',$6,10,$7,now()+interval '15 minutes')`,
        [
          sheet,
          purchase,
          x.f.stationId,
          x.actors[0],
          x.people[0],
          "a".repeat(64),
          `fictional/${sheet}`,
        ],
      );
      const campaignId = newId();
      async function retain(
        predicate: AttestedPredicate,
        from: string,
        through: string,
      ) {
        const client = await db.pool.connect();
        try {
          await client.query("BEGIN");
          const proposal = newId();
          await client.query(
            `INSERT INTO held_release_proposal(id,purchase_id,station_id,target_kind,outcome,sheet_asset_id,proposer_id,proposer_person_id,content,provenance) VALUES($1,$2,$3,'date','confirm',$4,$5,$6,'{}',$7)`,
            [
              proposal,
              purchase,
              x.f.stationId,
              sheet,
              x.actors[0],
              x.people[0],
              { evaluation: { originalInterval: { L: "0", U: "1000" } } },
            ],
          );
          await client.query(
            "INSERT INTO held_release_state(proposal_id,purchase_id) VALUES($1,$2)",
            [proposal, purchase],
          );
          await client.query(
            "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,1,'pending',$3,'{}')",
            [newId(), proposal, x.actors[0]],
          );
          await client.query(
            "UPDATE held_release_state SET state='approved',version=2 WHERE proposal_id=$1 AND state='pending' AND version=1",
            [proposal],
          );
          await client.query(
            "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,2,'approved',$3,$4)",
            [
              newId(),
              proposal,
              x.actors[1],
              {
                attestation: {
                  decisionId: newId(),
                  version: 1,
                  fromMicros: from,
                  throughMicros: through,
                  predicates: [predicate],
                  sourceIds: [purchase, `${purchase}:lookup`],
                },
              },
            ],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
      await retain(
        kind === "day"
          ? { kind, day: "2026-11-10" }
          : { kind, campaignId, inside: true },
        "100",
        "400",
      );
      const client = await db.pool.connect();
      try {
        expect(
          (
            await client.query("SELECT held_release_consistent($1) valid", [
              purchase,
            ])
          ).rows[0].valid,
        ).toBe(true);
        await expect(
          assertAppliedReleaseConsistency(client, purchase),
        ).resolves.toBeUndefined();
        await retain(
          kind === "day"
            ? { kind, day: "2026-11-11" }
            : { kind, campaignId, inside: false },
          "200",
          "300",
        );
        const before = (
          await client.query(
            "SELECT version,status,current_revision_id FROM purchase WHERE id=$1",
            [purchase],
          )
        ).rows[0];
        expect(
          (
            await client.query("SELECT held_release_consistent($1) valid", [
              purchase,
            ])
          ).rows[0].valid,
        ).toBe(false);
        await expect(
          assertAppliedReleaseConsistency(client, purchase),
        ).rejects.toMatchObject({ code: "evidence_insufficient", status: 422 });
        expect(
          (
            await client.query(
              "SELECT version,status,current_revision_id FROM purchase WHERE id=$1",
              [purchase],
            )
          ).rows[0],
        ).toEqual(before);
        expect(before.status).toBe("held");
        expect(
          (
            await client.query(
              "SELECT count(*)::int n FROM held_release_state WHERE purchase_id=$1 AND state='approved'",
              [purchase],
            )
          ).rows[0].n,
        ).toBe(2);
      } finally {
        client.release();
      }
    },
  );
});
