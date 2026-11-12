import { beforeAll, afterAll, expect, it } from "vitest";
import {
  cardsFixture,
  config,
  fixtureId,
} from "../helpers/cards-adversarial-fixture";
import { phoneTestAdapter } from "../helpers/customer-recovery-fixture";
import { newId } from "../../src/server/lib/ids";
import {
  recoveryRead,
  recoveryWrite,
} from "../../src/server/modules/customers/recovery";
import {
  recoveryContextSchema,
  phoneChallengeSchema,
  identityChangeSchema,
  managerCaseViewSchema,
} from "../../src/shared/contracts/customer-recovery";
let f: Awaited<ReturnType<typeof cardsFixture>>, token: string;
beforeAll(async () => {
  f = await cardsFixture();
  token = await f.owner();
});
afterAll(async () => f?.close());
it("card-present phone change preserves identity and historical receipt; intake never changes identity", async () => {
  const id = fixtureId(26),
    ctx = recoveryContextSchema.parse(
      await recoveryRead(f.pool, config, token, "context", id),
    );
  const body = {
    operationId: newId(),
    expectedVersion: ctx.customerVersion,
    newPhone: "08019990001",
    activeCardCode: ctx.activeCard!.code,
    expectedCardVersion: ctx.activeCard!.version,
    cardInspectedInPerson: true,
    reason: "Customer presented their card",
  };
  const change = identityChangeSchema.parse(
    await recoveryWrite(f.pool, config, token, "phone-change", id, body),
  );
  expect(change.customerVersion).toBe(ctx.customerVersion + 1);
  expect(change.verification).toBe("card_present");
  expect(
    await recoveryWrite(f.pool, config, token, "phone-change", id, body),
  ).toEqual(change);
  const intake = managerCaseViewSchema.parse(
    await recoveryWrite(f.pool, config, token, "case-create", id, {
      operationId: newId(),
      expectedVersion: change.customerVersion,
      customerPresent: true,
      reason: "Registered phone unavailable",
      verificationNotes: "Checked customer card history",
    }),
  );
  expect(intake.customerVersionAtIntake).toBe(change.customerVersion);
  expect(
    recoveryContextSchema.parse(
      await recoveryRead(f.pool, config, token, "context", id),
    ).customerVersion,
  ).toBe(change.customerVersion);
});
it("durable delivery and verification use generated code and retain the original expiry", async () => {
  const id = fixtureId(26),
    ctx = recoveryContextSchema.parse(
      await recoveryRead(f.pool, config, token, "context", id),
    ),
    h = phoneTestAdapter(f.pool);
  const input = { operationId: newId(), expectedVersion: ctx.customerVersion };
  const pending = phoneChallengeSchema.parse(
    await recoveryWrite(f.pool, config, token, "issue", id, input, {
      adapter: h.adapter,
    }),
  );
  expect(pending.state).toBe("delivery_pending");
  const sent = phoneChallengeSchema.parse(
    await recoveryRead(f.pool, config, token, "challenge", id, {}, pending.id),
  );
  expect(sent.state).toBe("sent");
  const verified = phoneChallengeSchema.parse(
    await recoveryWrite(
      f.pool,
      config,
      token,
      "verify",
      id,
      {
        operationId: newId(),
        expectedVersion: ctx.customerVersion,
        expectedChallengeVersion: sent.version,
        code: h.code(sent.id),
      },
      { adapter: h.adapter },
      sent.id,
    ),
  );
  expect(verified.state).toBe("verified");
  expect(verified.expiresAt).toBe(sent.expiresAt);
  expect(
    await recoveryWrite(f.pool, config, token, "issue", id, input, {
      adapter: h.adapter,
    }),
  ).toEqual(pending);
  expect(h.sends()).toBe(1);
});

it("purpose-bound phone verification cannot consume an email challenge", async () => {
  const id = newId(),
    code = (await import("node:crypto")).randomBytes(24).toString("hex");
  await f.pool.query(
    "INSERT INTO verification_challenge(id,user_id,purpose,target_digest,secret_hash,expires_at,attempts,max_attempts,operation_id,version) VALUES($1,$2,'verify_email',$3,$3,clock_timestamp()+interval '1 minute',0,3,$4,1)",
    [id, fixtureId(2), code, newId()],
  );
  const ctx = recoveryContextSchema.parse(
      await recoveryRead(f.pool, config, token, "context", fixtureId(26)),
    ),
    h = phoneTestAdapter(f.pool);
  await expect(
    recoveryWrite(
      f.pool,
      config,
      token,
      "verify",
      fixtureId(26),
      {
        operationId: newId(),
        expectedVersion: ctx.customerVersion,
        expectedChallengeVersion: 1,
        code,
      },
      { adapter: h.adapter },
      id,
    ),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    recoveryWrite(
      f.pool,
      config,
      token,
      "replace",
      fixtureId(26),
      {
        operationId: newId(),
        expectedVersion: ctx.customerVersion,
        expectedOldCardVersion: ctx.activeCard!.version,
        challengeId: id,
        expectedChallengeVersion: 1,
        newCardCode: "BCDEFGH",
        reason: "Replace lost card",
      },
      { adapter: h.adapter },
    ),
  ).rejects.toMatchObject({ code: "not_found" });
  expect(
    (
      await f.pool.query(
        "SELECT consumed_at,attempts FROM verification_challenge WHERE id=$1",
        [id],
      )
    ).rows[0],
  ).toEqual({ consumed_at: null, attempts: 0 });
});
it("database rejects absent phone bindings and immutable delivery/identity/intake edits", async () => {
  const row = (
    await f.pool.query(
      "SELECT id FROM verification_challenge WHERE purpose='replace_card' LIMIT 1",
    )
  ).rows[0];
  await expect(
    f.pool.query(
      `INSERT INTO verification_challenge SELECT (jsonb_populate_record(NULL::verification_challenge,to_jsonb(v)||jsonb_build_object('id',$2::text,'operation_id',$3::text,'secret_hash',$4::text,'customer_version',NULL))).* FROM verification_challenge v WHERE id=$1`,
      [row.id, newId(), newId(), newId()],
    ),
  ).rejects.toMatchObject({
    code: "23514",
    constraint: "ck_phone_challenge_binding",
  });
  await expect(
    f.pool.query(
      "UPDATE phone_verification_delivery SET destination_phone='forbidden' WHERE challenge_id=$1",
      [row.id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    f.pool.query(
      "UPDATE customer_identity_change SET reason='Changed history' WHERE customer_id=$1",
      [fixtureId(26)],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    f.pool.query(
      "UPDATE customer_recovery_case SET verification_notes='Changed history' WHERE customer_id=$1",
      [fixtureId(26)],
    ),
  ).rejects.toMatchObject({ code: "23514" });
});
it("rechecks live issuer permission between durable intent and dispatch, before adapter invocation", async () => {
  const a = await f.actor(["customers", "recovery"]),
    h = phoneTestAdapter(f.pool),
    id = fixtureId(26);
  const ctx = recoveryContextSchema.parse(
    await recoveryRead(f.pool, config, a.token, "context", id),
  );
  // Intercept transaction acquisition only: after intent commit, revoke before
  // the dispatch transaction obtains its connection. No service hook is exposed.
  const connect = f.pool.connect.bind(f.pool);
  let connections = 0;
  const proxy = new Proxy(f.pool, {
    get(target, key, receiver) {
      if (key === "connect")
        return async () => {
          connections++;
          if (connections === 4)
            await f.pool.query(
              "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='recovery'",
              [a.roleId],
            );
          return connect();
        };
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    recoveryWrite(
      proxy,
      config,
      a.token,
      "issue",
      id,
      { operationId: newId(), expectedVersion: ctx.customerVersion },
      { adapter: h.adapter },
    ),
  ).rejects.toMatchObject({ code: "permission_denied" });
  expect(h.sends()).toBe(0);
  const last = (
    await f.pool.query(
      "SELECT d.state,v.revoked_at IS NOT NULL AS revoked FROM phone_verification_delivery d JOIN verification_challenge v ON v.id=d.challenge_id WHERE v.issuer_admin_id=$1",
      [a.adminId],
    )
  ).rows[0];
  expect(last).toEqual({ state: "failed", revoked: true });
});
