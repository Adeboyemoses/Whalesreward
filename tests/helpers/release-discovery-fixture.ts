import type pg from "pg";
import { newId } from "../../src/server/lib/ids";
import { heldReleaseRuntimeFixture } from "./giveaway-release-fixture";
import type { evidenceDatabase, Kind } from "./review-evidence-fixture";
import { createReleaseDiscoveryService } from "../../src/server/modules/reviews/release-discovery";
export async function discoveryFixture(
  db: Awaited<ReturnType<typeof evidenceDatabase>>,
  kind: Kind = "card",
) {
  const x = await heldReleaseRuntimeFixture(db, kind);
  const env = {
    ...process.env,
    WHR_ENV: "test",
    WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.policy),
  };
  return {
    ...x,
    discovery: createReleaseDiscoveryService({ pool: db.pool, env }),
    env,
  };
}
export type DiscoveryFixture = Awaited<ReturnType<typeof discoveryFixture>>;
/** Additional immutable discovery records in a disposable schema, with real FK/transition guards enabled. */
export async function clonePending(
  db: pg.PoolClient,
  x: DiscoveryFixture,
  source: string,
  kind: Kind,
  at: string,
) {
  const purchase = newId(),
    proposal = newId(),
    sheet = newId();
  await db.query(
    `INSERT INTO purchase SELECT (jsonb_populate_record(NULL::purchase,to_jsonb(p)||jsonb_build_object('id',$2::text,'operation_id',$3::text,'sale_code',$4::text,'current_revision_id',NULL,'resolution_candidate_revision_id',NULL))).* FROM purchase p WHERE id=$1`,
    [x.sale.purchaseId, purchase, newId(), `S-${purchase}`],
  );
  await db.query(
    `INSERT INTO held_release_sheet SELECT (jsonb_populate_record(NULL::held_release_sheet,to_jsonb(s)||jsonb_build_object('id',$2::text,'purchase_id',$3::text,'staging_key',$4::text))).* FROM held_release_sheet s WHERE id=$1`,
    [x.body.sheetAssetId, sheet, purchase, `staging/${sheet}`],
  );
  await db.query(
    `INSERT INTO held_release_proposal SELECT (jsonb_populate_record(NULL::held_release_proposal,to_jsonb(p)||jsonb_build_object('id',$2::text,'purchase_id',$3::text,'sheet_asset_id',$4::text,'target_kind',$5::text,'proposed_at',$6::text,'content',p.content||jsonb_build_object('id',$2::text,'purchaseId',$3::text,'proposedAt',$6::text)))).* FROM held_release_proposal p WHERE id=$1`,
    [source, proposal, purchase, sheet, kind, at],
  );
  await db.query(
    "INSERT INTO held_release_state(proposal_id,purchase_id) VALUES($1,$2)",
    [proposal, purchase],
  );
  await db.query(
    "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,1,'pending',$3,'{}')",
    [newId(), proposal, x.actors[0]],
  );
  return { proposal, purchase };
}
export async function addPending(
  x: DiscoveryFixture,
  source: string,
  count: number,
  kinds: Kind[] = ["card"],
) {
  const db = await x.pool.connect();
  const rows = [];
  try {
    await db.query("BEGIN");
    for (let n = 0; n < count; n++)
      rows.push(
        await clonePending(
          db,
          x,
          source,
          kinds[n % kinds.length]!,
          `2026-11-16T12:00:00.${String(100000 + (n % 3)).padStart(6, "0")}Z`,
        ),
      );
    await db.query("COMMIT");
    return rows;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function closePending(x: DiscoveryFixture, proposal: string) {
  const db = await x.pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "UPDATE held_release_state SET state='rejected',version=version+1 WHERE proposal_id=$1",
      [proposal],
    );
    await db.query(
      "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,2,'rejected',$3,'{}')",
      [newId(), proposal, x.actors[0]],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
