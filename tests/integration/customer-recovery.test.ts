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
