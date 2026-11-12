import sharp from "sharp";
import { createSyncService } from "../../src/server/modules/sync/service";
import { sha256, campaign } from "../helpers/sync-fixture";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { newId } from "../../src/server/lib/ids";
import { digest } from "../../src/server/modules/auth/crypto";
import { issueSession } from "../../src/server/modules/admin-access/sessions";
import {
  recoveryRead,
  recoveryWrite,
} from "../../src/server/modules/customers/recovery";
import {
  phoneChallengeSchema,
  identityChangeSchema,
} from "../../src/shared/contracts/customer-recovery";
import {
  registerCustomer,
  customerRead,
} from "../../src/server/modules/customers/service";
import { config, fixtureId } from "../helpers/cards-adversarial-fixture";
import { newSession } from "../helpers/sync-fixture";
import {
  ephemeralVerification,
  recoveryAdversarialFixture,
} from "../helpers/customer-recovery-adversarial-fixture";

vi.setConfig({ testTimeout: 15000 });
let f: Awaited<ReturnType<typeof recoveryAdversarialFixture>>;
type Customer =
  Awaited<ReturnType<typeof recoveryAdversarialFixture>> extends {
    customer(): Promise<infer C>;
  }
    ? C
    : never;
beforeAll(async () => {
  f = await recoveryAdversarialFixture();
});
afterAll(async () => {
  await f?.close();
});
async function setup(maxAttempts = 5) {
  const c = await f.customer(),
    actor = await f.actor(["customers", "recovery"]);
  const h = ephemeralVerification(f.pool, maxAttempts);
  return {
    c,
    actor,
    h,
    options: { adapter: h.adapter, ip: `test-${newId()}` },
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const phoneBody = (c: Customer, phone: string) => ({
  operationId: newId(),
  expectedVersion: c.version,
  newPhone: phone,
  activeCardCode: c.card.code,
  expectedCardVersion: c.card.version,
  cardInspectedInPerson: true,
  reason: "Customer presented their card",
});
async function issue(s: Setup) {
  const pending = phoneChallengeSchema.parse(
    await recoveryWrite(
      f.pool,
      config,
      s.actor.token,
      "issue",
      s.c.id,
      { operationId: newId(), expectedVersion: s.c.version },
      s.options,
    ),
  );
  return phoneChallengeSchema.parse(
    await recoveryRead(
      f.pool,
      config,
      s.actor.token,
      "challenge",
      s.c.id,
      {},
      pending.id,
    ),
  );
}
function verifyBody(
  s: Setup,
  ch: { id: string; version: number },
  code = s.h.code(ch.id),
) {
  return {
    operationId: newId(),
    expectedVersion: s.c.version,
    expectedChallengeVersion: ch.version,
    code,
  };
}
async function verify(
  s: Setup,
  ch: { id: string; version: number },
  body = verifyBody(s, ch),
) {
  return phoneChallengeSchema.parse(
    await recoveryWrite(
      f.pool,
      config,
      s.actor.token,
      "verify",
      s.c.id,
      body,
      s.options,
      ch.id,
    ),
  );
}
function replaceBody(
  s: Setup,
  ch: { id: string; version: number },
  code: string,
) {
  return {
    operationId: newId(),
    expectedVersion: s.c.version,
    expectedOldCardVersion: s.c.card.version,
    challengeId: ch.id,
    expectedChallengeVersion: ch.version,
    newCardCode: code,
    reason: "Customer verified registered phone",
  };
}
async function rawChallenge(id: string) {
  return (
    await f.pool.query(
      "SELECT to_jsonb(v) AS value FROM verification_challenge v WHERE id=$1",
      [id],
    )
  ).rows[0].value;
}

async function recoveryPersistence(s: Setup) {
  const rows = await f.pool.query(
    `SELECT
    (SELECT jsonb_agg(to_jsonb(v)) FROM verification_challenge v WHERE customer_id=$1) AS challenges,
    (SELECT jsonb_agg(to_jsonb(d)) FROM phone_verification_delivery d WHERE customer_id=$1) AS deliveries,
    (SELECT jsonb_agg(to_jsonb(r)) FROM mutation_receipt r WHERE actor_user_id=$2) AS receipts,
    (SELECT jsonb_agg(to_jsonb(a)) FROM audit_event a WHERE actor_user_id=$2) AS audit`,
    [s.c.id, s.actor.userId],
  );
  return JSON.stringify(rows.rows);
}

describe("customer recovery adversarial invariants", () => {
  it("I-15 concurrent canonical phone changes assign one customer and preserve the losing identity", async () => {
    const a = await setup(),
      b = await setup(),
      target = f.phone();
    const beforeA = await f.identity(a.c.id),
      beforeB = await f.identity(b.c.id);
    const results = await f.race(
      () =>
        recoveryWrite(
          f.pool,
          config,
          a.actor.token,
          "phone-change",
          a.c.id,
          phoneBody(a.c, target),
        ),
      () =>
        recoveryWrite(
          f.pool,
          config,
          b.actor.token,
          "phone-change",
          b.c.id,
          phoneBody(b.c, `+234 ${target.slice(1)}`),
        ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "phone_in_use", status: 409 },
    });
    const loser = results[0]!.status === "rejected" ? a : b;
    expect(await f.identity(loser.c.id)).toEqual(
      loser === a ? beforeA : beforeB,
    );
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM customer WHERE phone_normalized=$1",
          [`+234${target.slice(1)}`],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("I-19 replacement and registration cannot claim the same candidate card", async () => {
    const s = await setup(),
      ch = await verify(s, await issue(s)),
      candidate = await f.card();
    const seller = await newSession(f.pool, {
      userId: fixtureId(3),
      attendantId: fixtureId(6),
      assignmentId: fixtureId(18),
      username: "grace.okon",
    });
    const before = await f.identity(s.c.id);
    const results = await f.race(
      () =>
        recoveryWrite(
          f.pool,
          config,
          s.actor.token,
          "replace",
          s.c.id,
          replaceBody(s, ch, candidate.code),
          s.options,
        ),
      () =>
        registerCustomer(f.pool, config, seller.token, {
          operationId: newId(),
          name: "Tunde Adebayo",
          phone: f.phone(),
          category: "car_owner",
          card: { source: "code", code: candidate.code },
        }),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "card_unavailable", status: 409 },
    });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM card_customer_link WHERE card_id=$1 AND ended_at IS NULL",
          [candidate.id],
        )
      ).rows[0].n,
    ).toBe(1);
    if (results[0]!.status === "rejected") {
      expect(await f.identity(s.c.id)).toEqual(before);
      expect((await rawChallenge(ch.id)).consumed_at).toBeNull();
      const alternate = await f.card();
      await recoveryWrite(
        f.pool,
        config,
        s.actor.token,
        "replace",
        s.c.id,
        replaceBody(s, ch, alternate.code),
        s.options,
      );
    } else expect((await rawChallenge(ch.id)).consumed_at).not.toBeNull();
  });
  it.each(["replacement-first", "receipt-first"])(
    "I-33 %s race preserves historical identity and credits only cards valid at receipt",
    async (order) => {
      const s = await setup(),
        ch = await verify(s, await issue(s)),
        candidate = await f.card();
      const bytes = await sharp({
        create: { width: 2, height: 2, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer();
      const start = new Date(Date.now() - 60000);
      const session = await newSession(
        f.pool,
        {
          userId: fixtureId(3),
          attendantId: fixtureId(6),
          assignmentId: fixtureId(18),
          username: "grace.okon",
        },
        start,
      );
      const seller = {
        ...session,
        start,
        stationId: fixtureId(8),
        original: {
          operationId: newId(),
          captureContextId: session.contextId,
          assignmentId: fixtureId(18),
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
        },
      };
      if (
        !(
          await f.pool.query(
            "SELECT 1 FROM settings_version WHERE station_id=$1",
            [seller.stationId],
          )
        ).rowCount
      )
        await campaign(f.pool, seller, false);
      const service = createSyncService({
        pool: f.pool,
        storage: {
          async signPut() {
            return {
              url: "https://storage.example.test/fictional",
              headers: {},
            };
          },
          async read() {
            return bytes;
          },
          async writeFinal() {},
        },
      });
      const gate = await f.pool.connect();
      let replacing: Promise<unknown> | undefined;
      let submitting: ReturnType<typeof service.submit> | undefined;
      try {
        await gate.query("BEGIN");
        if (order === "replacement-first") {
          await gate.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`original:${fixtureId(6)}:${seller.original.operationId}`],
          );
          submitting = service.submit(seller.token, seller.original);
          await f.waitForLock("pg_advisory_xact_lock");
        } else
          await gate.query("SELECT id FROM card_batch WHERE id=$1 FOR UPDATE", [
            fixtureId(28),
          ]);
        replacing = recoveryWrite(
          f.pool,
          config,
          s.actor.token,
          "replace",
          s.c.id,
          replaceBody(s, ch, candidate.code),
          s.options,
        );
        if (order === "replacement-first") await replacing;
        else {
          await f.waitForLock("card_batch");
          submitting = service.submit(seller.token, seller.original);
          // A correct non-key customer lock lets receipt resolution finish;
          // the previous UPDATE lock waits here after taking the card FK lock.
          let completed = false,
            observed = false;
          void submitting.then(
            () => {
              completed = true;
            },
            () => {
              completed = true;
            },
          );
          for (let attempt = 0; attempt < 200; attempt++) {
            const wait = (
              await f.pool.query(
                "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND position('UPDATE purchase SET card_id' in query)>0",
                [f.schema],
              )
            ).rowCount;
            if (completed || wait) {
              observed = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(observed).toBe(true);
        }
        await gate.query("COMMIT");
        const [, uploaded] = await Promise.all([replacing, submitting!]);
        const permission = await service.uploadPermission(
          seller.token,
          uploaded.status.purchaseId,
          { operationId: newId(), ...seller.original.photo },
        );
        const finalizing = service.finalize(
          seller.token,
          uploaded.status.purchaseId,
          {
            operationId: newId(),
            uploadId: permission.uploadId,
            expectedVersion: uploaded.status.version,
          },
        );
        await finalizing;
        const row = (
          await f.pool.query(
            "SELECT p.status,p.customer_id,p.card_code,p.server_received_at,c.retired_at FROM purchase p JOIN card c ON c.id=p.card_id WHERE p.id=$1",
            [uploaded.status.purchaseId],
          )
        ).rows[0];
        expect(row.customer_id).toBe(s.c.id);
        expect(row.card_code).toBe(s.c.card.code);
        expect(
          await customerRead(
            f.pool,
            config,
            s.actor.token,
            "profile",
            {},
            s.c.id,
          ),
        ).toMatchObject({
          recordedSpendKobo: order === "replacement-first" ? "0" : "2000000",
          completedPurchaseCount: order === "replacement-first" ? "0" : "1",
        });
        expect(row.retired_at <= row.server_received_at).toBe(
          order === "replacement-first",
        );
        if (order === "replacement-first") {
          expect(row.status).toBe("held");
          expect(
            (
              await f.pool.query(
                "SELECT count(*)::int AS n FROM purchase_hold WHERE purchase_id=$1 AND kind='card' AND state='open'",
                [uploaded.status.purchaseId],
              )
            ).rows[0].n,
          ).toBe(1);
        } else expect(row.status).toBe("credited");
        expect(
          (
            await f.pool.query("SELECT state FROM card WHERE id=$1", [
              s.c.card.id,
            ])
          ).rows[0].state,
        ).toBe("retired");
      } finally {
        await gate.query("ROLLBACK");
        gate.release();
        await Promise.allSettled([replacing, submitting]);
      }
    },
  );
  it("I-21 audit failure rolls back retirement links customer version and challenge consumption", async () => {
    const s = await setup(),
      ch = await verify(s, await issue(s)),
      candidate = await f.card();
    const before = await f.identity(s.c.id),
      beforeChallenge = await rawChallenge(ch.id),
      body = replaceBody(s, ch, candidate.code);
    await f.pool.query(
      "CREATE FUNCTION fail_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='card_replaced' THEN RAISE EXCEPTION 'Fictional audit failure'; END IF; RETURN NEW; END $$",
    );
    await f.pool.query(
      "CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION fail_recovery_audit()",
    );
    try {
      await expect(
        recoveryWrite(
          f.pool,
          config,
          s.actor.token,
          "replace",
          s.c.id,
          body,
          s.options,
        ),
      ).rejects.toMatchObject({ code: "P0001" });
    } finally {
      await f.pool.query("DROP TRIGGER fail_recovery_audit ON audit_event");
      await f.pool.query("DROP FUNCTION fail_recovery_audit()");
    }
    expect(await f.identity(s.c.id)).toEqual(before);
    expect(await rawChallenge(ch.id)).toEqual(beforeChallenge);
    expect(
      (await f.pool.query("SELECT state FROM card WHERE id=$1", [candidate.id]))
        .rows[0].state,
    ).toBe("unassigned");
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM mutation_receipt WHERE operation_id=$1",
          [body.operationId],
        )
      ).rows[0].n,
    ).toBe(0);
    await recoveryWrite(
      f.pool,
      config,
      s.actor.token,
      "replace",
      s.c.id,
      body,
      s.options,
    );
  });
  it.each(["reject", "throw"] as const)(
    "I-21a delivery %s fails closed durably and same-key retry never resends",
    async (failure) => {
      const s = await setup(),
        providerCanary = randomBytes(24).toString("hex");
      const input = { operationId: newId(), expectedVersion: s.c.version };
      let sends = 0;
      const adapter = {
        ...s.h.adapter,
        async request() {
          sends++;
          if (failure === "throw") throw new Error(providerCanary);
          return {
            outcome: "unavailable" as const,
            providerPayload: providerCanary,
          };
        },
      };
      const options = { ...s.options, adapter };
      const failed = await recoveryWrite(
        f.pool,
        config,
        s.actor.token,
        "issue",
        s.c.id,
        input,
        options,
      ).then(
        () => null,
        (error) => error as Error & { code: string; status: number },
      );
      expect(failed).toMatchObject({
        code: "delivery_unavailable",
        status: 503,
      });
      expect(JSON.stringify(failed).includes(providerCanary)).toBe(false);
      expect(failed?.message.includes(providerCanary)).toBe(false);
      const row = (
        await f.pool.query(
          "SELECT v.id,v.revoked_at,v.consumed_at,d.state,d.failure_code FROM verification_challenge v JOIN phone_verification_delivery d ON d.challenge_id=v.id WHERE v.customer_id=$1",
          [s.c.id],
        )
      ).rows[0];
      expect(row).toMatchObject({
        state: "failed",
        failure_code: "delivery_unavailable",
        consumed_at: null,
      });
      expect(row.revoked_at).not.toBeNull();
      const before = await rawChallenge(row.id);
      const historical = phoneChallengeSchema.parse(
        await recoveryWrite(
          f.pool,
          config,
          s.actor.token,
          "issue",
          s.c.id,
          input,
          options,
        ),
      );
      expect(historical).toMatchObject({
        id: row.id,
        state: "delivery_pending",
        version: 1,
      });
      expect(sends).toBe(1);
      expect(await rawChallenge(row.id)).toEqual(before);
      expect(
        await recoveryRead(
          f.pool,
          config,
          s.actor.token,
          "challenge",
          s.c.id,
          {},
          row.id,
        ),
      ).toMatchObject({ state: "failed" });
      const persisted = await recoveryPersistence(s);
      expect(persisted.includes(providerCanary)).toBe(false);
    },
  );
  it("I-21a an expired abandoned delivery lease is revoked on retry without another dispatch", async () => {
    const s = await setup(),
      input = { operationId: newId(), expectedVersion: s.c.version };
    const providerCanary = randomBytes(24).toString("hex");
    let entered!: () => void,
      release!: () => void,
      sends = 0;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = {
      ...s.h.adapter,
      async request() {
        sends++;
        entered();
        await gate;
        throw new Error(providerCanary);
      },
    };
    // Real connection loss after the intent commit, while dispatch is in flight.
    // The provider promise stays unresolved until a second request reconciles.
    const original = recoveryWrite(
      f.pool,
      config,
      s.actor.token,
      "issue",
      s.c.id,
      input,
      { ...s.options, adapter },
    );
    const settled = Promise.allSettled([original]);
    try {
      await started;
      const active = await f.pool.query(
        "SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND state='idle in transaction'",
        [f.schema],
      );
      expect(active.rows).toHaveLength(1);
      await f.pool.query("SELECT pg_terminate_backend($1)", [
        active.rows[0].pid,
      ]);
      await f.pool.query(
        "UPDATE phone_verification_delivery SET lease_until=clock_timestamp()-interval '1 second' WHERE customer_id=$1 AND state='sending'",
        [s.c.id],
      );
      const pending = phoneChallengeSchema.parse(
        await recoveryWrite(
          f.pool,
          config,
          s.actor.token,
          "issue",
          s.c.id,
          input,
          { ...s.options, adapter },
        ),
      );
      expect(pending.state).toBe("delivery_pending");
      const current = phoneChallengeSchema.parse(
        await recoveryRead(
          f.pool,
          config,
          s.actor.token,
          "challenge",
          s.c.id,
          {},
          pending.id,
        ),
      );
      expect(current.state).toBe("failed");
      expect(current.expiresAt).toBe(pending.expiresAt);
      const row = (
        await f.pool.query(
          "SELECT v.revoked_at,v.consumed_at,d.state,d.failure_code,d.lease_nonce,d.lease_until FROM verification_challenge v JOIN phone_verification_delivery d ON d.challenge_id=v.id WHERE v.id=$1",
          [pending.id],
        )
      ).rows[0];
      expect(row).toMatchObject({
        state: "failed",
        failure_code: "delivery_uncertain",
        consumed_at: null,
        lease_nonce: null,
        lease_until: null,
      });
      expect(row.revoked_at).not.toBeNull();
      expect(sends).toBe(1);
      release();
      expect((await settled)[0]!.status).toBe("rejected");
      expect((await recoveryPersistence(s)).includes(providerCanary)).toBe(
        false,
      );
    } finally {
      release();
      await settled;
    }
  });
  it("I-21a lost issuance response replays the original nonsecret receipt without a second send", async () => {
    const s = await setup(),
      input = { operationId: newId(), expectedVersion: s.c.version };
    const first = phoneChallengeSchema.parse(
      await recoveryWrite(
        f.pool,
        config,
        s.actor.token,
        "issue",
        s.c.id,
        input,
        s.options,
      ),
    );
    const before = await rawChallenge(first.id),
      code = s.h.code(first.id);
    const replay = await recoveryWrite(
      f.pool,
      config,
      s.actor.token,
      "issue",
      s.c.id,
      input,
      s.options,
    );
    expect(replay).toEqual(first);
    expect(s.h.sends()).toBe(1);
    expect(await rawChallenge(first.id)).toEqual(before);
    expect(
      await recoveryRead(
        f.pool,
        config,
        s.actor.token,
        "challenge",
        s.c.id,
        {},
        first.id,
      ),
    ).toMatchObject({ state: "sent", expiresAt: first.expiresAt });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM phone_verification_delivery WHERE customer_id=$1",
          [s.c.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect((await recoveryPersistence(s)).includes(code)).toBe(false);
    expect(JSON.stringify(replay).includes(code)).toBe(false);
  });
  it("I-21a verification and consumed replacement replay preserve historical results without renewing authority", async () => {
    const s = await setup(),
      sent = await issue(s),
      body = verifyBody(s, sent),
      ch = await verify(s, sent, body),
      candidate = await f.card();
    const before = await rawChallenge(ch.id);
    expect(await verify(s, sent, body)).toEqual(ch);
    expect(await rawChallenge(ch.id)).toEqual(before);
    const replace = replaceBody(s, ch, candidate.code),
      change = identityChangeSchema.parse(
        await recoveryWrite(
          f.pool,
          config,
          s.actor.token,
          "replace",
          s.c.id,
          replace,
          s.options,
        ),
      );
    const after = await f.identity(s.c.id),
      used = await rawChallenge(ch.id);
    expect(
      await recoveryWrite(
        f.pool,
        config,
        s.actor.token,
        "replace",
        s.c.id,
        replace,
        s.options,
      ),
    ).toEqual(change);
    expect(await verify(s, sent, body)).toEqual(ch);
    expect(await f.identity(s.c.id)).toEqual(after);
    expect(await rawChallenge(ch.id)).toEqual(used);
    const next = await f.card();
    await expect(
      recoveryWrite(
        f.pool,
        config,
        s.actor.token,
        "replace",
        s.c.id,
        {
          ...replaceBody(s, ch, next.code),
          expectedVersion: 2,
          expectedOldCardVersion: 2,
        },
        s.options,
      ),
    ).rejects.toMatchObject({ code: "verification_unavailable", status: 422 });
  });
  it("I-21a a second session of the same admin cannot replay or consume verification", async () => {
    const s = await setup(),
      sent = await issue(s),
      body = verifyBody(s, sent),
      ch = await verify(s, sent, body);
    const db = await f.pool.connect();
    let token: string;
    try {
      token = (await issueSession(db, config, s.actor.userId)).token;
    } finally {
      db.release();
    }
    await expect(
      recoveryWrite(
        f.pool,
        config,
        token,
        "verify",
        s.c.id,
        body,
        s.options,
        ch.id,
      ),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    const candidate = await f.card();
    await expect(
      recoveryWrite(
        f.pool,
        config,
        token,
        "replace",
        s.c.id,
        replaceBody(s, ch, candidate.code),
        s.options,
      ),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect((await rawChallenge(ch.id)).consumed_at).toBeNull();
  });
  it("I-21a consumed replacement replay remains scoped to the issuing session", async () => {
    const s = await setup(),
      ch = await verify(s, await issue(s)),
      candidate = await f.card(),
      body = replaceBody(s, ch, candidate.code);
    await recoveryWrite(
      f.pool,
      config,
      s.actor.token,
      "replace",
      s.c.id,
      body,
      s.options,
    );
    const db = await f.pool.connect();
    let token: string;
    try {
      token = (await issueSession(db, config, s.actor.userId)).token;
    } finally {
      db.release();
    }
    await expect(
      recoveryWrite(f.pool, config, token, "replace", s.c.id, body, s.options),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
  it("I-21a a challenge for another customer is unavailable and cannot consume attempts", async () => {
    const s = await setup(),
      other = await f.customer(),
      ch = await issue(s),
      before = await rawChallenge(ch.id);
    await expect(
      recoveryWrite(
        f.pool,
        config,
        s.actor.token,
        "verify",
        other.id,
        verifyBody(s, ch),
        s.options,
        ch.id,
      ),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(await rawChallenge(ch.id)).toEqual(before);
  });
  it("I-41 recovery audit and receipts contain no raw verification code phone or private intake narrative", async () => {
    const s = await setup(),
      ch = await issue(s),
      code = s.h.code(ch.id);
    await verify(s, ch);
    const newPhone = f.phone(),
      body = phoneBody(s.c, newPhone);
    const response = await recoveryWrite(
      f.pool,
      config,
      s.actor.token,
      "phone-change",
      s.c.id,
      body,
    );
    const history = await recoveryRead(
      f.pool,
      config,
      s.actor.token,
      "changes",
      s.c.id,
    );
    const audit = JSON.stringify(
      (
        await f.pool.query("SELECT * FROM audit_event WHERE target_id=$1", [
          s.c.id,
        ])
      ).rows,
    );
    const receipts = JSON.stringify(
      (
        await f.pool.query(
          "SELECT * FROM mutation_receipt WHERE actor_user_id=$1",
          [s.actor.userId],
        )
      ).rows,
    );
    const attempts = JSON.stringify(
      (
        await f.pool.query(
          "SELECT * FROM phone_verification_attempt WHERE actor_user_id=$1",
          [s.actor.userId],
        )
      ).rows,
    );
    const visible = JSON.stringify([response, history]);
    for (const value of [
      code,
      s.c.phone,
      newPhone,
      `+234${s.c.phone.slice(1)}`,
      `+234${newPhone.slice(1)}`,
    ]) {
      expect(audit.includes(value)).toBe(false);
      expect(receipts.includes(value)).toBe(false);
      expect(attempts.includes(value)).toBe(false);
      expect(visible.includes(value)).toBe(false);
    }
    expect(audit.includes("••••")).toBe(false);
  });
  it("I-21a failed attempts commit once and a correct final permitted attempt can replace", async () => {
    const s = await setup(2),
      sent = await issue(s),
      bad = verifyBody(s, sent, randomBytes(16).toString("hex"));
    await expect(verify(s, sent, bad)).rejects.toMatchObject({
      code: "verification_unavailable",
    });
    expect((await rawChallenge(sent.id)).attempts).toBe(1);
    await expect(verify(s, sent, bad)).rejects.toMatchObject({
      code: "verification_unavailable",
    });
    expect((await rawChallenge(sent.id)).attempts).toBe(1);
    await expect(
      verify(s, sent, { ...bad, code: randomBytes(16).toString("hex") }),
    ).rejects.toMatchObject({ code: "operation_conflict", status: 409 });
    const current = phoneChallengeSchema.parse(
      await recoveryRead(
        f.pool,
        config,
        s.actor.token,
        "challenge",
        s.c.id,
        {},
        sent.id,
      ),
    );
    const ch = await verify(s, current),
      candidate = await f.card();
    expect((await rawChallenge(ch.id)).attempts).toBe(2);
    await recoveryWrite(
      f.pool,
      config,
      s.actor.token,
      "replace",
      s.c.id,
      replaceBody(s, ch, candidate.code),
      s.options,
    );
  });
  it("I-21a resend revokes verified unused authority and preserves cumulative customer send limits", async () => {
    const s = await setup(),
      ch = await verify(s, await issue(s));
    await issue(s);
    expect((await rawChallenge(ch.id)).revoked_at).not.toBeNull();
    const candidate = await f.card();
    await expect(
      recoveryWrite(
        f.pool,
        config,
        s.actor.token,
        "replace",
        s.c.id,
        replaceBody(s, ch, candidate.code),
        s.options,
      ),
    ).rejects.toMatchObject({ code: "verification_unavailable" });
    await issue(s);
    await expect(issue(s)).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
    expect(s.h.sends()).toBe(3);
  });
  it("I-21a attempts across generations cannot evade the cumulative verification limit", async () => {
    const s = await setup(10);
    for (let generation = 0; generation < 2; generation++) {
      s.actor = await f.actor(["customers", "recovery"]);
      s.options.ip = `test-${newId()}`;
      let ch = await issue(s);
      for (let attempt = 0; attempt < 5; attempt++) {
        await expect(
          verify(s, ch, verifyBody(s, ch, randomBytes(16).toString("hex"))),
        ).rejects.toMatchObject({ code: "verification_unavailable" });
        ch = phoneChallengeSchema.parse(
          await recoveryRead(
            f.pool,
            config,
            s.actor.token,
            "challenge",
            s.c.id,
            {},
            ch.id,
          ),
        );
      }
    }
    const ch = await issue(s);
    await expect(verify(s, ch)).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
    expect((await rawChallenge(ch.id)).attempts).toBe(0);
  });
  it.each(["phone", "card", "generation", "expiry"] as const)(
    "I-21a changed %s binding denies verification with no identity change",
    async (binding) => {
      const s = await setup();
      if (binding === "expiry") s.h.adapter.policy.lifetimeMs = 2000;
      const ch = await issue(s);
      if (binding === "phone")
        await f.pool.query(
          "UPDATE customer SET phone_normalized=$2,version=version+1 WHERE id=$1",
          [s.c.id, `+234${f.phone().slice(1)}`],
        );
      if (binding === "card")
        await f.pool.query("UPDATE card SET version=version+1 WHERE id=$1", [
          s.c.card.id,
        ]);
      if (binding === "generation")
        await f.pool.query(
          "UPDATE customer SET phone_verification_generation=phone_verification_generation+1 WHERE id=$1",
          [s.c.id],
        );
      if (binding === "expiry")
        await new Promise((resolve) => setTimeout(resolve, 2020));
      const before = await f.identity(s.c.id);
      await expect(verify(s, ch)).rejects.toMatchObject({
        code: "verification_unavailable",
        status: 422,
      });
      expect(await f.identity(s.c.id)).toEqual(before);
      expect((await rawChallenge(ch.id)).verified_at).toBeNull();
    },
  );
  it("I-09 permission removal while confirmation waits prevents consumption", async () => {
    const s = await setup(),
      ch = await verify(s, await issue(s)),
      candidate = await f.card(),
      gate = await f.pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query(
        "SELECT id FROM security_state WHERE id=true FOR UPDATE",
      );
      pending = recoveryWrite(
        f.pool,
        config,
        s.actor.token,
        "replace",
        s.c.id,
        replaceBody(s, ch, candidate.code),
        s.options,
      );
      const denial = expect(pending).rejects.toMatchObject({
        code: "permission_denied",
        status: 403,
      });
      await f.waitForLock("security_state");
      await gate.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='recovery'",
        [s.actor.roleId],
      );
      await gate.query("COMMIT");
      await denial;
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await Promise.allSettled([pending]);
    }
    expect((await rawChallenge(ch.id)).consumed_at).toBeNull();
  });
  it("I-21a session revocation and phone change invalidate unused verified authority", async () => {
    for (const change of ["session", "phone"]) {
      const s = await setup(),
        ch = await verify(s, await issue(s)),
        candidate = await f.card();
      if (change === "session")
        await f.pool.query(
          "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE secret_verifier=$1",
          [digest(s.actor.token)],
        );
      else
        await recoveryWrite(
          f.pool,
          config,
          s.actor.token,
          "phone-change",
          s.c.id,
          phoneBody(s.c, f.phone()),
        );
      await expect(
        recoveryWrite(
          f.pool,
          config,
          s.actor.token,
          "replace",
          s.c.id,
          {
            ...replaceBody(s, ch, candidate.code),
            expectedVersion: change === "phone" ? 2 : 1,
          },
          s.options,
        ),
      ).rejects.toMatchObject({
        code:
          change === "session" ? "unauthenticated" : "verification_unavailable",
      });
      expect((await rawChallenge(ch.id)).consumed_at).toBeNull();
    }
  });
  it.each(["staging", "production"])(
    "I-21a %s rejects the test adapter before delivery",
    async (environment) => {
      const s = await setup();
      vi.stubEnv("WHR_ENV", environment);
      try {
        await expect(issue(s)).rejects.toMatchObject({
          code: "phone_verification_unconfigured",
          status: 409,
        });
        expect(s.h.sends()).toBe(0);
      } finally {
        vi.stubEnv("WHR_ENV", "local");
      }
    },
  );
  it("I-21a concurrent manager intakes create one protected case without changing identity or verification authority", async () => {
    const s = await setup(),
      before = await f.identity(s.c.id),
      input = {
        operationId: newId(),
        expectedVersion: 1,
        customerPresent: true,
        reason: "Registered phone unavailable",
        verificationNotes: "Customer attended station and history was checked",
      };
    const result = await f.race(
      () =>
        recoveryWrite(
          f.pool,
          config,
          s.actor.token,
          "case-create",
          s.c.id,
          input,
        ),
      () =>
        recoveryWrite(f.pool, config, s.actor.token, "case-create", s.c.id, {
          ...input,
          operationId: newId(),
        }),
    );
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(result.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "case_already_open" },
    });
    expect(await f.identity(s.c.id)).toEqual(before);
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM verification_challenge WHERE customer_id=$1",
          [s.c.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const audit = JSON.stringify(
      (
        await f.pool.query(
          "SELECT * FROM audit_event WHERE action='manager_case_recorded' AND target_id IN (SELECT id FROM customer_recovery_case WHERE customer_id=$1)",
          [s.c.id],
        )
      ).rows,
    );
    expect(audit.includes(input.verificationNotes)).toBe(false);
    expect(audit.includes(input.reason)).toBe(false);
  });
});
