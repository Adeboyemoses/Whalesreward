import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { newId } from "../../src/server/lib/ids";
import { digest } from "../../src/server/modules/auth/crypto";
import { issueSession } from "../../src/server/modules/admin-access/sessions";
import type { AdminConfig } from "../../src/server/modules/admin-access/config";

export const fixtureId = (n: number) =>
  `019a5000-0000-7000-8000-${String(n).padStart(12, "0")}`;
export const config: AdminConfig = {
  secret: randomBytes(32).toString("hex"),
  origin: "https://cards.example.test",
};

/** Each adversarial suite owns a real PostgreSQL schema, not a transaction mock. */
export async function cardsFixture() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `cards_adversarial_${randomBytes(8).toString("hex")}`;
  await root.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  url.searchParams.set("application_name", schema);
  process.env.DATABASE_URL = url.toString();
  process.env.BETTER_AUTH_SECRET = config.secret;
  process.env.BETTER_AUTH_URL = config.origin;
  process.env.WHR_ENV = "local";
  process.env.WHR_TRUSTED_IP_HEADER = "x-test-ip";
  const pool = new pg.Pool({ connectionString: url.toString(), max: 16 });
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
  async function actor(permissions: string[], restricted = false) {
    const roleId = newId(),
      userId = newId(),
      adminId = newId();
    await pool.query(
      "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,false,true,1)",
      [roleId, `Fictional cards ${roleId}`],
    );
    for (const permission of permissions)
      await pool.query(
        "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
        [roleId, permission],
      );
    await pool.query(
      "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Ada Williams',true,1,$3,now())",
      [userId, `cards.${userId}`, restricted],
    );
    await pool.query(
      "INSERT INTO admin(id,user_id,admin_code,role_id,version) VALUES($1,$2,$3,$4,1)",
      [adminId, userId, `TEST-${adminId}`, roleId],
    );
    const db = await pool.connect();
    try {
      const session = await issueSession(db, config, userId);
      return { roleId, userId, adminId, token: session.token };
    } finally {
      db.release();
    }
  }
  async function owner() {
    const db = await pool.connect();
    try {
      return (await issueSession(db, config, fixtureId(2))).token;
    } finally {
      db.release();
    }
  }
  async function waitForLock(fragment: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND position($2 in query)>0",
        [schema, fragment],
      );
      if (result.rowCount) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(
      `Competing transaction never reached PostgreSQL lock: ${fragment}`,
    );
  }
  async function restrictAttendant(token: string) {
    const restricted = randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,access_scope) SELECT $1,user_id,$2,clock_timestamp()+interval '15 minutes',auth_version,clock_timestamp(),'first_password' FROM auth_session WHERE secret_verifier=$3",
      [newId(), digest(restricted), digest(token)],
    );
    return restricted;
  }
  return {
    pool,
    schema,
    actor,
    owner,
    waitForLock,
    restrictAttendant,
    async close() {
      await pool.end();
      await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await root.end();
    },
  };
}

/** Durable sale history constructed through the real schema's state guards. */
export async function historicalSale(
  pool: pg.Pool,
  options: {
    customerId?: string;
    currency?: "NGN" | "USD";
    product?: "pms" | "diesel" | "cooking_gas";
    state?:
      | "received"
      | "photo_pending"
      | "finalizing"
      | "credited"
      | "held"
      | "cancelled";
    amount?: string;
    acceptedAmount?: string;
    lateProposal?: boolean;
  },
) {
  const product = options.product ?? "pms",
    state = options.state ?? "credited";
  const gas = product === "cooking_gas",
    diesel = product === "diesel";
  const amount = options.amount ?? "1234567";
  const currency = options.currency ?? "NGN";
  const quantity = (value: string) =>
    `${BigInt(value) / 1000000n}.${(BigInt(value) % 1000000n).toString().padStart(6, "0")}`;
  const id = newId(),
    revisionId = newId(),
    photoId = newId(),
    priceId = newId();
  const customerId = options.customerId ?? fixtureId(26);
  let sellerId = fixtureId(gas ? 7 : 6),
    contextId = fixtureId(gas ? 25 : 24),
    assignmentId = fixtureId(gas ? 19 : 18);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    if (diesel) {
      const userId = newId();
      sellerId = newId();
      contextId = newId();
      assignmentId = newId();
      await db.query(
        "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'attendant',$2,$2,'Favour James',true,1,false,now())",
        [userId, `diesel.${userId}`],
      );
      await db.query(
        "INSERT INTO attendant(id,user_id,staff_code,version) VALUES($1,$2,$3,1)",
        [sellerId, userId, `TEST-${sellerId}`],
      );
      await db.query(
        "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,1,clock_timestamp()-interval '1 hour',$4,'Fictional diesel fixture')",
        [assignmentId, sellerId, fixtureId(15), fixtureId(5)],
      );
      await db.query(
        "INSERT INTO capture_context(id,attendant_id,assignment_id,signed_in_at,offline_expires_at,seller_name,seller_username,device_binding_digest) VALUES($1,$2,$3,now(),now()+interval '24 hours','Favour James','fictional.diesel','fictional-device')",
        [contextId, sellerId, assignmentId],
      );
    }
    await db.query(
      "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) SELECT $1,$2,$3,coalesce(max(version),0)+1,1000000,$5,6,clock_timestamp(),$4,'Fictional exact aggregate fixture' FROM product_price_version WHERE station_id=$2 AND product_id=$3",
      [
        priceId,
        fixtureId(8),
        fixtureId(gas ? 12 : diesel ? 10 : 9),
        fixtureId(5),
        currency,
      ],
    );
    await db.query(
      `INSERT INTO purchase(id,originating_attendant_id,operation_id,payload_digest,sale_code,capture_context_id,assignment_id,station_id,pump_id,product_id,seller_name,seller_username,card_code,app_captured_at,server_received_at,price_version_id,basis,entered_amount_kobo,amount_kobo,quantity,rate_kobo,currency,unit,quantity_precision,medium,expected_photo_digest,expected_photo_bytes,customer_id,card_id,status,version)
      VALUES($1,$2,$3,'fictional aggregate',$4,$5,$6,$7,$8,$9,'Grace Okon','grace.okon','A7K3M9Q',clock_timestamp(),clock_timestamp(),$10,'amount',$11,$11,$12,1000000,$18,$13,6,$14,$15,100,$16,$17,'received',1)`,
      [
        id,
        sellerId,
        newId(),
        `ADV-${id}`,
        contextId,
        assignmentId,
        fixtureId(8),
        fixtureId(gas ? 17 : diesel ? 15 : 14),
        fixtureId(gas ? 12 : diesel ? 10 : 9),
        priceId,
        amount,
        quantity(amount),
        gas ? "kilogram" : "litre",
        gas ? "cylinder" : "vehicle",
        "a".repeat(64),
        customerId,
        fixtureId(29),
        currency,
      ],
    );
    if (state !== "received")
      await db.query(
        "UPDATE purchase SET status='photo_pending',version=version+1 WHERE id=$1",
        [id],
      );
    if (!["received", "photo_pending", "cancelled"].includes(state))
      await db.query(
        "UPDATE purchase SET status='finalizing',version=version+1 WHERE id=$1",
        [id],
      );
    if (["credited", "held"].includes(state)) {
      await db.query(
        "INSERT INTO photo_asset(id,purchase_id,upload_operation_id,state,staging_key,staging_expires_at,expected_digest,expected_bytes) VALUES($1,$2,$3,'staged',$4,clock_timestamp()+interval '1 hour',$5,100)",
        [photoId, id, newId(), `fictional/${photoId}`, "a".repeat(64)],
      );
      await db.query(
        "UPDATE photo_asset SET state='validated',final_key=$2,validated_digest=expected_digest,validated_bytes=100,width=10,height=10,media_type='image/jpeg',validated_at=clock_timestamp() WHERE id=$1",
        [photoId, `fictional/final/${photoId}`],
      );
      const revision = async (
        rid: string,
        number: number,
        value: string,
        base: string | null,
      ) =>
        db.query(
          `INSERT INTO purchase_revision(id,purchase_id,revision_number,operation_id,actor_user_id,payload_digest,based_on_revision_id,kind,state,reason,server_received_at,amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,rate_kobo,price_version_id,medium,evidence_asset_id)
        SELECT $1,id,$2,$3,$4,'fictional revision',$5,$6,'proposed',$7,clock_timestamp(),$8,$9,currency,unit,6,'amount',$8,rate_kobo,price_version_id,medium,$10 FROM purchase WHERE id=$11`,
          [
            rid,
            number,
            newId(),
            fixtureId(3),
            base,
            base ? "attendant_correction" : "original",
            base ? "Fictional correction" : null,
            value,
            quantity(value),
            photoId,
            id,
          ],
        );
      await revision(revisionId, 1, amount, null);
      await db.query(
        "UPDATE purchase_revision SET state='accepted',decision_actor_id='019a5000-0000-7000-8000-000000000003',decision_reason='Fictional acceptance',decided_at=clock_timestamp() WHERE id=$1",
        [revisionId],
      );
      let acceptedId = revisionId;
      if (options.acceptedAmount) {
        acceptedId = newId();
        await db.query(
          "UPDATE purchase_revision SET state='superseded' WHERE id=$1",
          [revisionId],
        );
        await revision(acceptedId, 2, options.acceptedAmount, revisionId);
        await db.query(
          "UPDATE purchase_revision SET state='accepted',decision_actor_id='019a5000-0000-7000-8000-000000000003',decision_reason='Fictional acceptance',decided_at=clock_timestamp() WHERE id=$1",
          [acceptedId],
        );
      }
      if (options.lateProposal)
        await revision(
          newId(),
          options.acceptedAmount ? 3 : 2,
          "9999999999999999",
          acceptedId,
        );
      if (state === "held")
        await db.query(
          "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,'price','open',$3,'fictional_price_hold',1)",
          [newId(), id, acceptedId],
        );
      await db.query(
        "UPDATE purchase SET status=$2,current_revision_id=$3,version=version+1 WHERE id=$1",
        [id, state, acceptedId],
      );
      // Campaign exclusion does not remove an otherwise valid all-time contribution.
      await db.query(
        "INSERT INTO sync_validation(purchase_id,policy_version,reasons,campaign_eligible) VALUES($1,2,'[]',false)",
        [id],
      );
    }
    if (state === "cancelled")
      await db.query(
        "UPDATE purchase SET status='cancelled',cancellation_reason='Fictional cancellation',version=version+1 WHERE id=$1",
        [id],
      );
    await db.query("COMMIT");
    return {
      id,
      revisionId,
      quantity: quantity(options.acceptedAmount ?? amount),
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
