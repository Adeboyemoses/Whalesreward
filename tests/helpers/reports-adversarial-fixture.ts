import type pg from "pg";
import {
  cardsFixture,
  config,
  fixtureId,
  historicalSale,
} from "./cards-adversarial-fixture";
import { seedHistorical } from "./review-evidence-fixture";
import { newId } from "../../src/server/lib/ids";
import type { CardArtifactStorage } from "../../src/server/adapters/card-artifacts";

export { config, fixtureId, historicalSale, seedHistorical };
export async function reportsFixture() {
  const f = await cardsFixture();
  const actor = await f.actor([
    "reports",
    "reportExport",
    "overview",
    "sales",
    "customers",
    "audit",
  ]);
  const day = (
    await f.pool.query(
      "SELECT (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date::text AS day",
    )
  ).rows[0].day as string;
  return {
    ...f,
    admin: actor,
    filters: { from: day, to: day, product: null, groupBy: "product" as const },
  };
}
export function memoryArtifacts(): CardArtifactStorage & {
  objects: Map<string, Uint8Array>;
} {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async write(key, bytes) {
      objects.set(key, new Uint8Array(bytes));
    },
    async read(key) {
      const value = objects.get(key);
      if (!value) throw new Error("Missing fictional artifact");
      return value;
    },
  };
}
export function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
export async function flagPair(pool: pg.Pool, one: string, two: string) {
  await pool.query(
    "INSERT INTO duplicate_flag(id,purchase_id,other_purchase_id,reason,state,version) VALUES($1,$2,$3,'Fictional suspected pair','open',1)",
    [newId(), ...[one, two].sort()],
  );
}
/** Frozen historical late request for projection testing; service calls run with every guard enabled. */
export async function lateRequest(pool: pg.Pool, purchaseId: string) {
  await seedHistorical(
    pool,
    "correction_request",
    `INSERT INTO correction_request(id,purchase_id,originating_attendant_id,operation_id,payload_digest,frozen_request_digest,based_on_revision_id,expected_purchase_version,proposed_revision_id,first_received_at,cutoff_at_receipt,time_policy_version,timing,state,reason,submitted_by_user_id,verified_author_attendant_id,authorship,authority_session_id,reserved_purchase_version,receipt)
  SELECT $1,p.id,p.originating_attendant_id,$2,'fictional','fictional',p.current_revision_id,p.version,r.id,clock_timestamp(),clock_timestamp()-interval '1 day','fictional','late','awaiting_review','Fictional numeric correction',a.user_id,a.id,'authenticated_attendant',(SELECT id FROM auth_session ORDER BY id LIMIT 1),p.version+1,'{}' FROM purchase p JOIN attendant a ON a.id=p.originating_attendant_id JOIN purchase_revision r ON r.purchase_id=p.id AND r.state='proposed' WHERE p.id=$3`,
    [newId(), newId(), purchaseId],
  );
}
