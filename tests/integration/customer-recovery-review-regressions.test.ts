import { randomBytes } from "node:crypto";
import type pg from "pg";
import sharp from "sharp";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import {
  recoveryAdversarialFixture,
  ephemeralVerification,
} from "../helpers/customer-recovery-adversarial-fixture";
import { config, fixtureId } from "../helpers/cards-adversarial-fixture";
import { activate, seedHistorical } from "../helpers/review-evidence-fixture";
import { newSession, campaign, sha256 } from "../helpers/sync-fixture";
import {
  recoveryRead,
  recoveryWrite,
} from "../../src/server/modules/customers/recovery";
import {
  phoneChallengeSchema,
  identityChangeSchema,
} from "../../src/shared/contracts/customer-recovery";
import { createSyncService } from "../../src/server/modules/sync/service";
import { createReviewsService } from "../../src/server/modules/reviews/service";
import { newId } from "../../src/server/lib/ids";
import { digest } from "../../src/server/modules/auth/crypto";
import { ADMIN_POLICY } from "../../src/server/modules/admin-access/config";
vi.setConfig({ testTimeout: 15000 });
let f: Awaited<ReturnType<typeof recoveryAdversarialFixture>>;
beforeAll(async () => {
  f = await recoveryAdversarialFixture();
});
afterAll(async () => f?.close());
async function setup() {
  const c = await f.customer(),
    actor = await f.actor([
      "customers",
      "recovery",
      "sales",
      "cardEligibility",
    ]),
    h = ephemeralVerification(f.pool);
  return { c, actor, h };
}
type Setup = Awaited<ReturnType<typeof setup>>;
async function issue(s: Setup, token = s.actor.token) {
  const pending = phoneChallengeSchema.parse(
    await recoveryWrite(
      f.pool,
      config,
      token,
      "issue",
      s.c.id,
      { operationId: newId(), expectedVersion: 1 },
      { adapter: s.h.adapter },
    ),
  );
  return phoneChallengeSchema.parse(
    await recoveryRead(
      f.pool,
      config,
      token,
      "challenge",
      s.c.id,
      {},
      pending.id,
    ),
  );
}
async function verified(s: Setup) {
  const ch = await issue(s);
  return phoneChallengeSchema.parse(
    await recoveryWrite(
      f.pool,
      config,
      s.actor.token,
      "verify",
      s.c.id,
      {
        operationId: newId(),
        expectedVersion: 1,
        expectedChallengeVersion: ch.version,
        code: s.h.code(ch.id),
      },
      { adapter: s.h.adapter },
      ch.id,
    ),
  );
}
async function replace(
  s: Setup,
  pool = f.pool,
  prepared?: Awaited<ReturnType<typeof verified>>,
) {
  const ch = prepared ?? (await verified(s)),
    next = await f.card();
  const result = identityChangeSchema.parse(
    await recoveryWrite(
      pool,
      config,
      s.actor.token,
      "replace",
      s.c.id,
      {
        operationId: newId(),
        expectedVersion: 1,
        expectedOldCardVersion: 2,
        challengeId: ch.id,
        expectedChallengeVersion: ch.version,
        newCardCode: next.code,
        reason: "Customer verified registered phone",
      },
      { adapter: s.h.adapter },
    ),
  );
  return { result, next, ch };
}
async function seller(s: Setup, ageMs: number) {
  const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer(),
    start = new Date(Date.now() - ageMs);
  const identity = {
    userId: fixtureId(3),
    attendantId: fixtureId(6),
    assignmentId: fixtureId(18),
    username: "grace.okon",
  };
  const capture = await newSession(f.pool, identity, start),
    fresh = await newSession(f.pool, identity);
  await seedHistorical(
    f.pool,
    "card_customer_link",
    "UPDATE card_customer_link SET linked_at=$2 WHERE customer_id=$1",
    [s.c.id, new Date(start.getTime() - 1000)],
  );
  if (
    !(
      await f.pool.query("SELECT 1 FROM settings_version WHERE station_id=$1", [
        fixtureId(8),
      ])
    ).rowCount
  )
    await campaign(
      f.pool,
      { stationId: fixtureId(8), start: new Date(Date.now() - 3 * 86400000) },
      false,
    );
  const original = {
    operationId: newId(),
    captureContextId: capture.contextId,
    assignmentId: identity.assignmentId,
    cardCode: s.c.card.code,
    appCapturedAt: start.toISOString(),
    priceVersionId: fixtureId(20),
    rateKobo: "100000",
    currency: "NGN" as const,
    quantityPrecision: 2,
    unit: "litre" as const,
    medium: "vehicle" as const,
    entry: {
      basis: "amount" as const,
      enteredAmountKobo: "2000000",
      amountKobo: "2000000",
      quantity: "20",
    },
    photo: {
      sha256: sha256(bytes),
      bytes: bytes.length,
      mediaType: "image/jpeg" as const,
    },
  };
  const storage = {
    async signPut() {
      return { url: "https://storage.example.test/fictional", headers: {} };
    },
    async read() {
      return bytes;
    },
    async writeFinal() {},
  };
  const sync = createSyncService({ pool: f.pool, storage });
  async function finish(submitted: Awaited<ReturnType<typeof sync.submit>>) {
    const upload = await sync.uploadPermission(
      fresh.token,
      submitted.status.purchaseId,
      { operationId: newId(), ...original.photo },
    );
    await sync.finalize(fresh.token, submitted.status.purchaseId, {
      operationId: newId(),
      uploadId: upload.uploadId,
      expectedVersion: submitted.status.version,
    });
    return upload.uploadId;
  }
  return { original, sync, storage, token: fresh.token, finish };
}
it("replacement produces authoritative evidence that resolves a queued old-card hold and restores credit", async () => {
  const s = await setup(),
    sale = await seller(s, 25 * 60 * 60 * 1000),
    change = await replace(s);
  const submitted = await sale.sync.submit(sale.token, sale.original),
    assetId = await sale.finish(submitted),
    id = submitted.status.purchaseId;
  const before = (
    await f.pool.query(
      "SELECT status,version,current_revision_id FROM purchase WHERE id=$1",
      [id],
    )
  ).rows[0];
  expect(before.status).toBe("held");
  const hold = (
    await f.pool.query(
      "SELECT id,version FROM purchase_hold WHERE purchase_id=$1 AND kind='card' AND state='open'",
      [id],
    )
  ).rows[0];
  expect(hold).toBeTruthy();
  const audit = (
    await f.pool.query(
      'SELECT target_type,target_id,"after" FROM audit_event WHERE id=$1',
      [change.result.auditEventId],
    )
  ).rows[0];
  expect(audit).toMatchObject({
    target_type: "card",
    target_id: s.c.card.id,
    after: { customerId: s.c.id, replacementCardId: change.next.id },
  });
  const policy = await activate(f.pool, fixtureId(8));
  const reviews = createReviewsService({
    pool: f.pool,
    storage: sale.storage,
    env: {
      ...process.env,
      WHR_ENV: "test",
      WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(policy),
    },
  });
  const decision = await reviews.decideCard(s.actor.token, id, hold.id, {
    operationId: newId(),
    expectedVersion: before.version,
    expectedRevisionId: before.current_revision_id,
    expectedHoldVersion: hold.version,
    outcome: "confirm_earlier",
    reason: "Confirmed original capture window preceded replacement",
    evidence: {
      assetId,
      notes: "Checked retained meter evidence and registered card history",
      referenceIds: [change.result.auditEventId],
    },
  });
  expect(decision.creditedAfter).toBe(true);
  expect(
    (await f.pool.query("SELECT status FROM purchase WHERE id=$1", [id]))
      .rows[0].status,
  ).toBe("credited");
  expect(
    (
      await f.pool.query("SELECT state FROM purchase_hold WHERE id=$1", [
        hold.id,
      ])
    ).rows[0].state,
  ).toBe("resolved");
  expect(
    (await f.pool.query("SELECT state FROM card WHERE id=$1", [s.c.card.id]))
      .rows[0].state,
  ).toBe("retired");
});
/** Substitute only the trusted-clock query with a PostgreSQL timestamp value.
 * Every write/constraint/settlement still runs against the real database. */
function fixedReplacementClock(pool: pg.Pool, at: string): pg.Pool {
  const connect = pool.connect.bind(pool);
  return new Proxy(pool, {
    get(target, key, receiver) {
      if (key === "connect")
        return async () => {
          const db = await connect();
          return new Proxy(db, {
            get(client, property) {
              if (property === "query")
                return (sql: unknown, ...args: unknown[]) =>
                  typeof sql === "string" &&
                  /^SELECT clock_timestamp\(\)(?:::text)? AS now$/.test(sql)
                    ? client.query(
                        sql.includes("::text")
                          ? "SELECT $1::timestamptz::text AS now"
                          : "SELECT $1::timestamptz AS now",
                        [at],
                      )
                    : Reflect.apply(client.query, client, [sql, ...args]);
              const value = Reflect.get(client, property);
              return typeof value === "function" ? value.bind(client) : value;
            },
          });
        };
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
it("preserves same-millisecond PostgreSQL receipt-before-replacement ordering without false card hold", async () => {
  const s = await setup(),
    sale = await seller(s, 60000),
    submitted = await sale.sync.submit(sale.token, sale.original),
    ch = await verified(s);
  await f.pool.query("SELECT pg_sleep(2)");
  const times = (
    await f.pool.query(
      "SELECT (date_trunc('second',clock_timestamp())-interval '1 second'+interval '123500 microseconds')::text AS receipt,(date_trunc('second',clock_timestamp())-interval '1 second'+interval '123900 microseconds')::text AS replacement",
    )
  ).rows[0];
  await seedHistorical(
    f.pool,
    "purchase",
    "UPDATE purchase SET server_received_at=$2 WHERE id=$1",
    [submitted.status.purchaseId, times.receipt],
  );
  const change = await replace(
    s,
    fixedReplacementClock(f.pool, times.replacement),
    ch,
  );
  const facts = (
    await f.pool.query(
      `SELECT c.retired_at=$2::timestamptz AS retirement,l.ended_at=$2::timestamptz AS ended,n.linked_at=$2::timestamptz AS linked,i.applied_at=$2::timestamptz AS applied,a.occurred_at=$2::timestamptz AS audited,v.consumed_at=$2::timestamptz AS consumed,p.server_received_at<c.retired_at AS ordered FROM card c JOIN card_customer_link l ON l.card_id=c.id JOIN customer_identity_change i ON i.old_card_id=c.id JOIN audit_event a ON a.id=i.audit_event_id JOIN verification_challenge v ON v.id=i.challenge_id JOIN card_customer_link n ON n.card_id=i.new_card_id JOIN purchase p ON p.id=$3 WHERE c.id=$1`,
      [s.c.card.id, times.replacement, submitted.status.purchaseId],
    )
  ).rows[0];
  expect(facts).toEqual({
    retirement: true,
    ended: true,
    linked: true,
    applied: true,
    audited: true,
    consumed: true,
    ordered: true,
  });
  expect(change.result.kind).toBe("card_replacement");
  await sale.finish(submitted);
  expect(
    (
      await f.pool.query("SELECT status FROM purchase WHERE id=$1", [
        submitted.status.purchaseId,
      ])
    ).rows[0].status,
  ).toBe("credited");
  expect(
    (
      await f.pool.query(
        "SELECT 1 FROM purchase_hold WHERE purchase_id=$1 AND kind='card'",
        [submitted.status.purchaseId],
      )
    ).rowCount,
  ).toBe(0);
});
it.each(["absolute", "idle"] as const)(
  "phone change denies %s expiry while waiting for card lock",
  async (kind) => {
    const s = await setup(),
      token = await expiringSession(s, kind),
      gate = await f.pool.connect(),
      before = await f.identity(s.c.id);
    let pending: Promise<unknown> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query("SELECT id FROM card WHERE id=$1 FOR UPDATE", [
        s.c.card.id,
      ]);
      pending = recoveryWrite(f.pool, config, token, "phone-change", s.c.id, {
        operationId: newId(),
        expectedVersion: 1,
        newPhone: f.phone(),
        activeCardCode: s.c.card.code,
        expectedCardVersion: 2,
        cardInspectedInPerson: true,
        reason: "Customer presented their card",
      });
      const outcome = pending.then(
        () => null,
        (e) => e,
      );
      await f.waitForLock("SELECT id FROM card WHERE id=");
      await waitExpiry(token, kind);
      await gate.query("COMMIT");
      expect(await outcome).toMatchObject({ code: "unauthenticated" });
      expect(await f.identity(s.c.id)).toEqual(before);
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await pending?.catch(() => {});
    }
  },
);
async function expiringSession(s: Setup, kind: "absolute" | "idle") {
  const token = randomBytes(32).toString("hex");
  await f.pool.query(
    `INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,last_activity_at) SELECT $1,user_id,$2,clock_timestamp()+CASE WHEN $3='absolute' THEN interval '1 second' ELSE interval '1 hour' END,auth_version,clock_timestamp(),clock_timestamp()-CASE WHEN $3='idle' THEN ($4::bigint*interval '1 millisecond')-interval '1 second' ELSE interval '0 seconds' END FROM auth_session WHERE secret_verifier=$5`,
    [newId(), digest(token), kind, ADMIN_POLICY.idleMs, digest(s.actor.token)],
  );
  return token;
}
async function waitExpiry(token: string, kind: "absolute" | "idle") {
  await f.pool.query(
    "SELECT pg_sleep(GREATEST(0,extract(epoch FROM (CASE WHEN $2='absolute' THEN expires_at ELSE last_activity_at+($3::bigint*interval '1 millisecond') END-clock_timestamp())))+0.02) FROM auth_session WHERE secret_verifier=$1",
    [digest(token), kind, ADMIN_POLICY.idleMs],
  );
}
it.each(["context", "case-create", "issue", "verify"] as const)(
  "%s rechecks expiry after customer lock waits",
  async (action) => {
    const s = await setup(),
      token = await expiringSession(s, "absolute"),
      ch = action === "verify" ? await issue(s, token) : null,
      gate = await f.pool.connect(),
      before = await f.identity(s.c.id);
    let pending: Promise<unknown> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query("SELECT id FROM customer WHERE id=$1 FOR UPDATE", [
        s.c.id,
      ]);
      pending =
        action === "context"
          ? recoveryRead(f.pool, config, token, "context", s.c.id)
          : recoveryWrite(
              f.pool,
              config,
              token,
              action,
              s.c.id,
              action === "case-create"
                ? {
                    operationId: newId(),
                    expectedVersion: 1,
                    customerPresent: true,
                    reason: "Customer cannot receive OTP",
                    verificationNotes: "Passport inspected in person",
                  }
                : action === "verify"
                  ? {
                      operationId: newId(),
                      expectedVersion: 1,
                      expectedChallengeVersion: ch!.version,
                      code: s.h.code(ch!.id),
                    }
                  : { operationId: newId(), expectedVersion: 1 },
              { adapter: s.h.adapter },
              ch?.id,
            );
      const outcome = pending.then(
        () => null,
        (e) => e,
      );
      await f.waitForLock("SELECT * FROM customer");
      await waitExpiry(token, "absolute");
      await gate.query("COMMIT");
      expect(await outcome).toMatchObject({ code: "unauthenticated" });
      expect(await f.identity(s.c.id)).toEqual(before);
      expect(
        (
          await f.pool.query(
            "SELECT 1 FROM customer_recovery_case WHERE customer_id=$1",
            [s.c.id],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await pending?.catch(() => {});
    }
  },
);
it("verification rechecks issuer expiry after a challenge row lock and writes no attempt", async () => {
  const s = await setup(),
    token = await expiringSession(s, "idle"),
    ch = await issue(s, token),
    gate = await f.pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await gate.query("BEGIN");
    await gate.query(
      "SELECT id FROM verification_challenge WHERE id=$1 FOR UPDATE",
      [ch.id],
    );
    pending = recoveryWrite(
      f.pool,
      config,
      token,
      "verify",
      s.c.id,
      {
        operationId: newId(),
        expectedVersion: 1,
        expectedChallengeVersion: ch.version,
        code: s.h.code(ch.id),
      },
      { adapter: s.h.adapter },
      ch.id,
    );
    const outcome = pending.then(
      () => null,
      (e) => e,
    );
    await f.waitForLock("SELECT v.*");
    await waitExpiry(token, "idle");
    await gate.query("COMMIT");
    expect(await outcome).toMatchObject({ code: "unauthenticated" });
    expect(
      (
        await f.pool.query(
          "SELECT attempts,verified_at FROM verification_challenge WHERE id=$1",
          [ch.id],
        )
      ).rows[0],
    ).toEqual({ attempts: 0, verified_at: null });
    expect(
      (
        await f.pool.query(
          "SELECT 1 FROM phone_verification_attempt WHERE challenge_id=$1",
          [ch.id],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await gate.query("ROLLBACK");
    gate.release();
    await pending?.catch(() => {});
  }
});
