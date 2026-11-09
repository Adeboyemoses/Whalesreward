import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import sharp from "sharp";
import { newId } from "../../src/server/lib/ids";
import type { EvidenceStorage } from "../../src/server/adapters/storage";
import { createSyncService } from "../../src/server/modules/sync/service";
import { issueSession } from "../../src/server/modules/admin-access/sessions";
import { digest } from "../../src/server/modules/auth/crypto";
import { syncFixture, newSession } from "./sync-fixture";

/** Actual evidence bytes, with controllable I/O; domain transactions use PostgreSQL. */
export function evidenceStore() {
  const objects = new Map<string, Buffer>();
  let beforeRead: ((key: string) => Promise<void>) | undefined;
  const storage: EvidenceStorage = {
    async signPut(key) {
      return { url: `https://evidence.example.test/${key}`, headers: {} };
    },
    async read(key, maxBytes) {
      await beforeRead?.(key);
      const bytes = objects.get(key);
      if (!bytes || bytes.length > maxBytes)
        throw new Error("Evidence unavailable");
      return Buffer.from(bytes);
    },
    async writeFinal(key, bytes) {
      objects.set(key, Buffer.from(bytes));
    },
  };
  return {
    storage,
    objects,
    onRead(hook?: (key: string) => Promise<void>) {
      beforeRead = hook;
    },
  };
}

export function barrier() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release,
    async pause() {
      enter();
      await released;
    },
  };
}

export async function correctionsFixture() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const url = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Correction tests require local PostgreSQL");
  const root = new pg.Pool({ connectionString });
  const schema = `corrections_adversarial_${randomBytes(8).toString("hex")}`;
  await root.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  url.searchParams.set("application_name", schema);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 20 });
  const migrations = new URL("../../prisma/migrations/", import.meta.url);
  for (const directory of (await readdir(migrations, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name)))
    await pool.query(
      await readFile(
        new URL(`${directory.name}/migration.sql`, migrations),
        "utf8",
      ),
    );
  await pool.query(
    await readFile(
      new URL("../../prisma/fixtures.sql", import.meta.url),
      "utf8",
    ),
  );
  await pool.query("UPDATE auth_user SET must_change_password=false");
  const evidence = evidenceStore();
  const sync = createSyncService({ pool, storage: evidence.storage });
  const jpeg = await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#ffffff" },
  })
    .jpeg()
    .toBuffer();
  const config = {
    secret: randomBytes(32).toString("hex"),
    origin: "https://corrections.example.test",
  };

  async function actor(permissions: string[], restricted = false) {
    const roleId = newId(),
      userId = newId(),
      adminId = newId();
    await pool.query(
      "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,false,true,1)",
      [roleId, `Fictional correction ${roleId}`],
    );
    for (const permission of permissions)
      await pool.query(
        "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
        [roleId, permission],
      );
    await pool.query(
      "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Ada Williams',true,1,$3,clock_timestamp())",
      [userId, `correction.${userId}`, restricted],
    );
    await pool.query(
      "INSERT INTO admin(id,user_id,admin_code,role_id,version) VALUES($1,$2,$3,$4,1)",
      [adminId, userId, `TEST-${adminId}`, roleId],
    );
    const db = await pool.connect();
    try {
      return {
        roleId,
        userId,
        adminId,
        token: (await issueSession(db, config, userId)).token,
      };
    } finally {
      db.release();
    }
  }

  async function sale(
    prepare?: (f: Awaited<ReturnType<typeof syncFixture>>) => Promise<void>,
    options?: { signedInAt: string; receivedAt: string },
  ) {
    const f = await syncFixture(
      pool,
      jpeg,
      options ? Date.now() - new Date(options.signedInAt).getTime() : 60_000,
    );
    if (options) {
      const fresh = await newSession(pool, f);
      f.token = fresh.token;
      f.sessionId = fresh.sessionId;
    }
    await prepare?.(f);
    const submitted = options
      ? await atReceipt("purchase", f.stationId, options.receivedAt, () =>
          sync.submit(f.token, f.original),
        )
      : await sync.submit(f.token, f.original);
    const purchaseId = submitted.status.purchaseId;
    const upload = await sync.uploadPermission(f.token, purchaseId, {
      operationId: newId(),
      ...f.original.photo,
    });
    const asset = (
      await pool.query("SELECT staging_key FROM photo_asset WHERE id=$1", [
        upload.uploadId,
      ])
    ).rows[0];
    evidence.objects.set(asset.staging_key, Buffer.from(jpeg));
    const status = await sync.finalize(f.token, purchaseId, {
      operationId: newId(),
      uploadId: upload.uploadId,
      expectedVersion: submitted.status.version,
    });
    const purchase = (
      await pool.query("SELECT * FROM purchase WHERE id=$1", [purchaseId])
    ).rows[0];
    return {
      ...f,
      purchaseId,
      photoId: upload.uploadId,
      revisionId: purchase.current_revision_id as string,
      version: purchase.version as number,
      status,
    };
  }

  /** Substitute only the database clock at insertion; preserve every domain guard. */
  async function atReceipt<T>(
    table: "purchase" | "correction_request",
    target: string,
    instant: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const name = `test_receipt_${randomBytes(8).toString("hex")}`;
    const targetColumn = table === "purchase" ? "station_id" : "purchase_id";
    const receiptColumn =
      table === "purchase" ? "server_received_at" : "first_received_at";
    await pool.query(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.${targetColumn}::text=TG_ARGV[0] THEN NEW.${receiptColumn}=TG_ARGV[1]::timestamptz; END IF; RETURN NEW; END $$`,
    );
    try {
      await pool.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}('${target}','${instant}')`,
      );
      return await run();
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
      await pool.query(`DROP FUNCTION ${name}()`);
    }
  }

  async function snapshot(purchaseId: string) {
    // Exact numeric columns stay text; to_jsonb(BIGINT) would lose precision in JS.
    return (
      await pool.query(
        `SELECT p.id,p.version,p.status,p.current_revision_id,p.amount_kobo::text AS original_amount,p.quantity::text AS original_quantity,p.price_version_id,p.expected_photo_digest,
      r.id AS revision_id,r.amount_kobo::text AS amount,r.quantity::text AS quantity,r.rate_kobo::text AS rate,r.price_version_id AS revision_price,r.evidence_asset_id,
      (SELECT count(*)::int FROM purchase_revision WHERE purchase_id=p.id AND state='accepted') AS accepted_count,
      (SELECT count(*)::int FROM purchase WHERE id=p.id AND status='credited' AND NOT EXISTS(SELECT 1 FROM purchase_hold WHERE purchase_id=p.id AND state='open')) AS transaction_count
      FROM purchase p LEFT JOIN purchase_revision r ON r.id=p.current_revision_id WHERE p.id=$1`,
        [purchaseId],
      )
    ).rows[0];
  }

  /** Trusted durable recovery provenance only; this does not implement recovery intake. */
  async function recovered(
    source: Awaited<ReturnType<typeof sale>>,
    executor: Awaited<ReturnType<typeof actor>>,
    authorizer: Awaited<ReturnType<typeof actor>>,
  ) {
    const correctionId = newId(),
      revisionId = newId(),
      operationId = newId();
    const sessionId = (
      await pool.query("SELECT id FROM auth_session WHERE secret_verifier=$1", [
        digest(executor.token),
      ])
    ).rows[0].id;
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        `INSERT INTO correction_request(id,purchase_id,originating_attendant_id,operation_id,payload_digest,frozen_request_digest,based_on_revision_id,expected_purchase_version,proposed_revision_id,first_received_at,cutoff_at_receipt,time_policy_version,timing,state,reason,submitted_by_user_id,verified_author_attendant_id,authorship,recovery_executor_id,recovery_authorizing_admin_id,policy_blocks,version,authority_session_id,reserved_purchase_version,receipt)
        VALUES($1,$2,$3,$4,'fictional trusted recovery','fictional trusted recovery',$5,$6,$7,'2026-11-09T22:59:59.999Z','2026-11-09T23:00:00Z','p20-bounded-day-v1','before_midnight','awaiting_review','Fictional recovered numeric proposal',$8,NULL,'unverified_recovery',$9,$10,ARRAY['correction_authorship_unverified'],1,$11,$6+1,'{}')`,
        [
          correctionId,
          source.purchaseId,
          source.attendantId,
          operationId,
          source.revisionId,
          source.version,
          revisionId,
          executor.userId,
          executor.adminId,
          authorizer.adminId,
          sessionId,
        ],
      );
      await db.query(
        `INSERT INTO purchase_revision(id,purchase_id,revision_number,operation_id,actor_user_id,payload_digest,based_on_revision_id,kind,state,reason,server_received_at,amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,rate_kobo,price_version_id,medium,evidence_asset_id,calculation_mode,correction_id)
        SELECT $1,purchase_id,revision_number+1,$2,$3,'fictional trusted recovery',id,'admin_correction','proposed','Fictional recovered numeric proposal','2026-11-09T22:59:59.999Z',3000000,30,currency,unit,quantity_precision,basis,3000000,rate_kobo,price_version_id,medium,evidence_asset_id,'captured_rate',$4 FROM purchase_revision WHERE id=$5`,
        [
          revisionId,
          operationId,
          executor.userId,
          correctionId,
          source.revisionId,
        ],
      );
      await db.query(
        "UPDATE purchase SET version=version+1 WHERE id=$1 AND version=$2",
        [source.purchaseId, source.version],
      );
      await db.query("COMMIT");
      return {
        correctionId,
        revisionId,
        operationId,
        version: 1,
        purchaseVersion: source.version + 1,
      };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  return {
    pool,
    schema,
    config,
    ...evidence,
    sync,
    jpeg,
    actor,
    sale,
    snapshot,
    atReceipt,
    recovered,
    async close() {
      await pool.end();
      await root.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.end();
    },
  };
}
