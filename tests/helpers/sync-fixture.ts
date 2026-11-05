import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { newId } from "../../src/server/lib/ids";
import { digest } from "../../src/server/modules/auth/crypto";
import type { OriginalSale } from "../../src/shared/contracts/sync";

export const fixtureId = (n: number) =>
  `019a5000-0000-7000-8000-${String(n).padStart(12, "0")}`;
export const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export async function syncFixture(
  pool: pg.Pool,
  bytes: Buffer,
  ageMs = 60_000,
) {
  const userId = newId(),
    attendantId = newId(),
    stationId = newId(),
    pumpId = newId(),
    assignmentId = newId(),
    priceId = newId();
  const start = new Date(Date.now() - ageMs);
  const historyStart = new Date(start.getTime() - 60_000);
  const username = `sync.${userId}`;
  await pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'attendant',$2,$2,'Grace Okon',true,1,false,now())",
    [userId, username],
  );
  await pool.query(
    "INSERT INTO attendant(id,user_id,staff_code,version) VALUES($1,$2,$3,1)",
    [attendantId, userId, `SYNC-${attendantId}`],
  );
  await pool.query(
    "INSERT INTO station(id,code,name,timezone,version) VALUES($1,$2,'Sync test station','Africa/Lagos',1)",
    [stationId, `SYNC-${stationId}`],
  );
  await pool.query(
    "INSERT INTO pump(id,station_id,code,product_id,enabled,version) VALUES($1,$2,'PUMP01',$3,true,1)",
    [pumpId, stationId, fixtureId(9)],
  );
  await pool.query(
    "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,1,$4,$5,'Fictional sync test')",
    [assignmentId, attendantId, pumpId, historyStart, fixtureId(5)],
  );
  await pool.query(
    "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) VALUES($1,$2,$3,1,100000,'NGN',2,$4,$5,'Fictional sync price')",
    [priceId, stationId, fixtureId(9), historyStart, fixtureId(5)],
  );
  const session = await newSession(
    pool,
    { userId, attendantId, assignmentId, username },
    start,
  );
  const original: OriginalSale = {
    operationId: newId(),
    captureContextId: session.contextId,
    assignmentId,
    cardCode: "A7K3M9Q",
    appCapturedAt: start.toISOString(),
    priceVersionId: priceId,
    rateKobo: "100000",
    currency: "NGN",
    quantityPrecision: 2,
    unit: "litre",
    medium: "vehicle",
    entry: {
      basis: "amount",
      enteredAmountKobo: "2000000",
      amountKobo: "2000000",
      quantity: "20",
    },
    photo: {
      sha256: sha256(bytes),
      bytes: bytes.length,
      mediaType: "image/jpeg",
    },
  };
  return {
    userId,
    attendantId,
    stationId,
    pumpId,
    assignmentId,
    priceId,
    username,
    start,
    ...session,
    original,
  };
}
export async function newSession(
  pool: pg.Pool,
  f: {
    userId: string;
    attendantId: string;
    assignmentId: string;
    username: string;
  },
  start = new Date(),
) {
  const contextId = newId(),
    sessionId = newId(),
    token = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO capture_context(id,attendant_id,assignment_id,signed_in_at,offline_expires_at,seller_name,seller_username,device_binding_digest) VALUES($1,$2,$3,$4,$5,'Grace Okon',$6,'fictional-sync-device')",
    [
      contextId,
      f.attendantId,
      f.assignmentId,
      start,
      new Date(start.getTime() + 86400000),
      f.username,
    ],
  );
  await pool.query(
    "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,assignment_id,capture_context_id,created_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$5)",
    [
      sessionId,
      f.userId,
      digest(token),
      new Date(Date.now() + 86400000),
      start,
      f.assignmentId,
      contextId,
    ],
  );
  return { contextId, sessionId, token };
}
export async function changePrice(
  pool: pg.Pool,
  f: { stationId: string; start: Date },
  rate = "110000",
  precision = 2,
) {
  const id = newId();
  await pool.query(
    "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) VALUES($1,$2,$3,2,$4,'NGN',$5,$6,$7,'Fictional price change')",
    [
      id,
      f.stationId,
      fixtureId(9),
      rate,
      precision,
      new Date(f.start.getTime() + 1000),
      fixtureId(5),
    ],
  );
  return id;
}
export async function campaign(
  pool: pg.Pool,
  f: { stationId: string; start: Date },
  crossing: boolean,
) {
  const campaignId = newId();
  await pool.query(
    "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional campaign',1,false)",
    [campaignId, f.stationId],
  );
  await pool.query(
    "INSERT INTO settings_version(id,station_id,campaign_id,version,purchase_start,purchase_cutoff,upload_deadline,timezone,effective_from,actor_id,reason) VALUES($1,$2,$3,1,$4,$5,$6,'Africa/Lagos',$7,$8,'Fictional timing')",
    [
      newId(),
      f.stationId,
      campaignId,
      new Date(f.start.getTime() + (crossing ? 1000 : -1000)),
      new Date(Date.now() + 86400000),
      new Date(Date.now() + 172800000),
      new Date(f.start.getTime() - 1000),
      fixtureId(5),
    ],
  );
}
