import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { newId } from "../../src/server/lib/ids";
import { reviewFixtureHarness } from "./review-fixture";
import { fixtureId } from "./sync-fixture";
import { reviewEvidenceReleaseDigest } from "../../src/server/modules/reviews/config";

export const S = "2026-11-10T12:00:00.000000Z";
export const U = "2026-11-10T13:00:00.000000Z";
export const expiry = "2026-11-11T12:00:00.000000Z";
export type Kind = "price" | "card" | "date" | "capture";
export async function evidenceDatabase() {
  const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `evidence_${randomBytes(6).toString("hex")}`;
  await root.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 10 });
  const migrations = new URL("../../prisma/migrations/", import.meta.url);
  for (const d of (await readdir(migrations, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name)))
    await pool.query(
      await readFile(new URL(`${d.name}/migration.sql`, migrations), "utf8"),
    );
  const fixtures = await readFile(
    new URL("../../prisma/fixtures.sql", import.meta.url),
    "utf8",
  );
  await pool.query(fixtures);
  return {
    pool,
    fixtures,
    async close() {
      await pool.end();
      await root.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.end();
    },
  };
}

/** Historical fixture construction only. Every service call runs with all guards enabled. */
export async function seedHistorical(
  pool: pg.Pool,
  table: string,
  sql: string,
  args: unknown[] = [],
) {
  if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid fixture table");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await db.query(sql, args);
    await db.query("SET CONSTRAINTS ALL IMMEDIATE");
    await db.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function sourceAudit(
  pool: pg.Pool,
  action: string,
  target: string,
  targetId: string,
  after: object,
  at = S,
) {
  const id = newId();
  await pool.query(
    "INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,before,after,reason,occurred_at) VALUES($1,$2,'user',$3,$4,$5,'{}',$6,'Fictional historical evidence',$7)",
    [id, fixtureId(2), action, target, targetId, after, at],
  );
  return id;
}

/** Reset fictional rows only in a disposable suite schema; production guards remain enabled. */
export async function resetReviewFixture(pool: pg.Pool) {
  const schema = (
    await pool.query<{ schema: string }>("SELECT current_schema() AS schema")
  ).rows[0]!.schema;
  if (!/^(?:evidence|reviews|review_adversaries)_[0-9a-f]+$/.test(schema))
    throw new Error("Review fixture reset requires its isolated test schema");
  // The P-28 binding is immutable, including TRUNCATE. Only this explicitly
  // disposable fixture reset suspends its guard, in the same transaction.
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("ALTER TABLE audit_event DISABLE TRIGGER USER");
    await db.query("ALTER TABLE station_timing_policy DISABLE TRIGGER USER");
    await db.query("TRUNCATE station,card CASCADE");
    await db.query("ALTER TABLE station_timing_policy ENABLE TRIGGER USER");
    await db.query("ALTER TABLE audit_event ENABLE TRIGGER USER");
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function activate(
  pool: pg.Pool,
  stationId: string,
  revision = 1,
  active = true,
) {
  const approval = newId();
  const config = {
    release: "review-evidence-v1",
    digest: reviewEvidenceReleaseDigest,
    revision,
    scope: { stationId, environment: "test" },
    activation: active
      ? { state: "active", approvalReference: approval, activatedAt: S }
      : { state: "inactive", approvalReference: null, activatedAt: null },
  };
  if (active)
    await pool.query(
      "INSERT INTO review_evidence_approval(id,release,digest,revision,station_id,environment,activated_at,authorization_reference) VALUES($1,$2,$3,$4,$5,'test',$6,'Fictional local test approval')",
      [approval, config.release, config.digest, revision, stationId, S],
    );
  await pool.query(
    "INSERT INTO review_evidence_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,'test',$3,$4,'Fictional local test approval')",
    [newId(), stationId, revision, config],
  );
  return config;
}
export async function evidenceFixture(
  db: Awaited<ReturnType<typeof evidenceDatabase>>,
  kind: Kind = "price",
) {
  const { pool, fixtures } = db;
  await resetReviewFixture(pool);
  await pool.query(
    fixtures
      .split("\n")
      .filter((line) => /^(INSERT INTO (customer|card)|UPDATE card)/.test(line))
      .join("\n"),
  );
  await pool.query(
    "UPDATE auth_user SET enabled=true,must_change_password=false WHERE id=$1",
    [fixtureId(2)],
  );
  await pool.query(
    "UPDATE role SET enabled=true,version=version+1 WHERE id=$1",
    [fixtureId(1)],
  );
  const h = reviewFixtureHarness(pool),
    bytes = await h.image(),
    f = await h.context(bytes),
    sale = await h.settle(f, bytes);
  await seedHistorical(
    pool,
    "capture_context",
    "UPDATE capture_context SET signed_in_at=$2,offline_expires_at=$3 WHERE id=$1",
    [f.contextId, S, expiry],
  );
  await seedHistorical(
    pool,
    "assignment",
    "UPDATE assignment SET effective_from=$2 WHERE id=$1",
    [f.assignmentId, "2026-11-09T00:00:00Z"],
  );
  await seedHistorical(
    pool,
    "product_price_version",
    "UPDATE product_price_version SET effective_from=$2 WHERE id=$1",
    [f.priceId, "2026-11-09T00:00:00Z"],
  );
  await seedHistorical(
    pool,
    "settings_version",
    "UPDATE settings_version SET purchase_start='2026-11-01T00:00:00Z',purchase_cutoff='2026-12-01T00:00:00Z',upload_deadline='2026-12-02T00:00:00Z',effective_from='2026-11-01T00:00:00Z' WHERE station_id=$1",
    [f.stationId],
  );
  await seedHistorical(
    pool,
    "card_customer_link",
    "UPDATE card_customer_link SET linked_at='2026-11-01T00:00:00Z' WHERE card_id=$1",
    [fixtureId(29)],
  );
  await seedHistorical(
    pool,
    "purchase",
    "UPDATE purchase SET server_received_at=$2,app_captured_at=$3,capture_lower_bound=$3,current_revision_id=NULL,status='held' WHERE id=$1",
    [sale.purchaseId, U, S],
  );
  await seedHistorical(
    pool,
    "purchase_revision",
    "UPDATE purchase_revision SET state='proposed' WHERE purchase_id=$1",
    [sale.purchaseId],
  );
  const priceAudit = await sourceAudit(
    pool,
    "price_activated",
    "product",
    fixtureId(9),
    {
      priceVersionId: f.priceId,
      version: 1,
      rateKobo: "100000",
      quantityPrecision: 2,
    },
    "2026-11-09T00:00:00Z",
  );
  const original = (
    await pool.query(
      "SELECT id FROM purchase_revision WHERE purchase_id=$1 AND kind='original'",
      [sale.purchaseId],
    )
  ).rows[0].id as string;
  const holdId = newId();
  if (kind !== "capture")
    await pool.query(
      "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,$3,'open',$4,$5,1)",
      [
        holdId,
        sale.purchaseId,
        kind,
        original,
        kind === "card" ? "replaced_card" : "capture_date_uncertain",
      ],
    );
  else
    await pool.query(
      "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_authorization_unresolved','fixture',clock_timestamp(),1)",
      [holdId, sale.purchaseId],
    );
  const config = await activate(pool, f.stationId);
  const token = await h.adminToken();
  const evidence = {
    assetId: sale.assetId,
    notes: "Inspected retained fictional photo",
    referenceIds: [] as string[],
  };
  const common = { ...(await h.guard(sale.purchaseId)), evidence };
  const body =
    kind === "price"
      ? {
          ...common,
          expectedHoldVersion: 1,
          decision: { outcome: "accept_captured" },
        }
      : kind === "card"
        ? { ...common, expectedHoldVersion: 1, outcome: "confirm_earlier" }
        : kind === "date"
          ? {
              ...common,
              expectedHoldVersion: 1,
              verifiedSaleDate: "2026-11-10",
            }
          : { ...common, outcome: "confirm" };
  return {
    pool,
    h,
    f,
    sale,
    original,
    holdId,
    token,
    config,
    body,
    evidence,
    bytes,
    priceAudit,
    kind,
  };
}
export type Fixture = Awaited<ReturnType<typeof evidenceFixture>>;
export async function replacement(x: Fixture, at: string) {
  const next = newId();
  await x.pool.query(
    "INSERT INTO card(id,batch_id,code,qr_payload,state,version) VALUES($1,$2,'C7K3M9Q','C7K3M9Q','unassigned',1)",
    [next, fixtureId(28)],
  );
  await x.pool.query(
    "UPDATE card_customer_link SET ended_at=$2 WHERE card_id=$1 AND ended_at IS NULL",
    [fixtureId(29), at],
  );
  await x.pool.query(
    "UPDATE card SET state='retired',retired_at=$2,retirement_reason='replaced',replaced_by_card_id=$3,version=version+1 WHERE id=$1",
    [fixtureId(29), at, next],
  );
  return sourceAudit(
    x.pool,
    "card_replaced",
    "card",
    fixtureId(29),
    {
      oldCardId: fixtureId(29),
      replacementCardId: next,
      customerId: fixtureId(26),
    },
    at,
  );
}
export async function state(x: Fixture) {
  const p = x.sale.purchaseId;
  const queries = [
    "SELECT * FROM purchase WHERE id=$1",
    "SELECT * FROM purchase_revision WHERE purchase_id=$1 ORDER BY id",
    "SELECT * FROM sync_validation WHERE purchase_id=$1",
    "SELECT * FROM correction_request WHERE purchase_id=$1 ORDER BY id",
    "SELECT * FROM purchase_hold WHERE purchase_id=$1 ORDER BY id",
    "SELECT * FROM purchase_validation_block WHERE purchase_id=$1 ORDER BY id",
    "SELECT * FROM sale_decision WHERE purchase_id=$1 ORDER BY id",
    "SELECT * FROM review_evaluation WHERE purchase_id=$1 ORDER BY decision_id",
    "SELECT * FROM audit_event WHERE target_id=$1 ORDER BY id",
  ];
  return Promise.all(
    queries.map(async (sql) => (await x.pool.query(sql, [p])).rows),
  );
}
