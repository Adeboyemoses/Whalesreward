import { priceAuditMatches } from "../../src/server/modules/reviews/evidence-resolvers";
import type { Fact } from "../../src/server/modules/reviews/evidence-types";
import { beforeAll, afterAll, expect, it } from "vitest";
import {
  cardsFixture,
  config,
  fixtureId,
} from "../helpers/cards-adversarial-fixture";
import { phoneTestAdapter } from "../helpers/customer-recovery-fixture";
import { newId } from "../../src/server/lib/ids";
import { cardsWrite } from "../../src/server/modules/cards/service";
import { prepareCardExport } from "../../src/server/modules/cards/exports";
import {
  recoveryRead,
  recoveryWrite,
} from "../../src/server/modules/customers/recovery";
import {
  recoveryContextSchema,
  phoneChallengeSchema,
} from "../../src/shared/contracts/customer-recovery";
import { stationWrite } from "../../src/server/modules/station/service";
let f: Awaited<ReturnType<typeof cardsFixture>>, token: string;
beforeAll(async () => {
  f = await cardsFixture();
  token = await f.owner();
});
afterAll(async () => f?.close());
const rows = async (operation: string) =>
  (
    await f.pool.query(
      "SELECT * FROM audit_event WHERE operation_id=$1 ORDER BY occurred_at,id",
      [operation],
    )
  ).rows;
const storage = {
  async write() {},
  async read() {
    return new Uint8Array([1]);
  },
};
async function batchAndExport() {
  const batch = (
    await cardsWrite(f.pool, config, token, "create", {
      operationId: newId(),
      name: "Audit fixture",
      count: 1,
    })
  ).data as { id: string; version: number };
  const operationId = newId();
  const exported = (
    await cardsWrite(
      f.pool,
      config,
      token,
      "export",
      { operationId, expectedVersion: batch.version, format: "xlsx" },
      batch.id,
    )
  ).data as { id: string };
  return { batch, exported, operationId };
}
it("AU-07 export workers record one system terminal event per fenced completion, failure and exhausted lease", async () => {
  for (const mode of ["ready", "render", "exhausted"] as const) {
    const { exported, operationId } = await batchAndExport();
    if (mode !== "ready")
      await f.pool.query(
        "UPDATE card_export SET attempts=$2,lease_nonce='fictional-expired-lease',lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [exported.id, mode === "render" ? 2 : 3],
      );
    const options = {
      storage,
      render: async () => {
        if (mode === "render") throw new Error("fictional render failure");
        return {
          bytes: new Uint8Array([1]),
          contentType: "application/octet-stream",
          extension: "xlsx" as const,
        };
      },
    };
    await prepareCardExport(f.pool, options, exported.id);
    await prepareCardExport(f.pool, options, exported.id);
    const events = await rows(operationId);
    expect(events.map((e) => e.action)).toEqual([
      "export_requested",
      mode === "ready" ? "export_prepared" : "export_failed",
    ]);
    expect(events[1].actor_snapshot).toMatchObject({
      kind: "system",
      service: "export",
    });
    expect(events[1].after).toEqual({
      exportId: exported.id,
      exportFormat: "xlsx",
    });
    expect(events[1].target_type).toBe("card_batch");
    expect(JSON.stringify(events)).not.toMatch(
      /object_key|sha256|final\/card-exports/,
    );
  }
});
it("AU-07 a failed audit insert rolls back terminal export publication and a retry records one event", async () => {
  const { exported, operationId } = await batchAndExport();
  await f.pool.query(
    "CREATE FUNCTION reject_export_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='export_prepared' THEN RAISE EXCEPTION 'fixture rejection'; END IF; RETURN NEW; END $$",
  );
  await f.pool.query(
    "CREATE TRIGGER reject_export_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_export_audit()",
  );
  try {
    await prepareCardExport(
      f.pool,
      {
        storage,
        render: async () => ({
          bytes: new Uint8Array([1]),
          contentType: "application/octet-stream",
          extension: "xlsx" as const,
        }),
      },
      exported.id,
    );
    expect(
      (
        await f.pool.query(
          "SELECT status,object_key FROM card_export WHERE id=$1",
          [exported.id],
        )
      ).rows[0],
    ).toEqual({ status: "pending", object_key: null });
    expect((await rows(operationId)).map((e) => e.action)).toEqual([
      "export_requested",
    ]);
  } finally {
    await f.pool.query("DROP TRIGGER reject_export_audit ON audit_event");
  }
  await f.pool.query(
    "UPDATE card_export SET next_attempt_at=NULL WHERE id=$1",
    [exported.id],
  );
  await prepareCardExport(
    f.pool,
    {
      storage,
      render: async () => ({
        bytes: new Uint8Array([1]),
        contentType: "application/octet-stream",
        extension: "xlsx" as const,
      }),
    },
    exported.id,
  );
  expect((await rows(operationId)).map((e) => e.action)).toEqual([
    "export_requested",
    "export_prepared",
  ]);
});
it("AU-04 verification records durable intent and successful transition once without phone OTP or verifier", async () => {
  const customerId = fixtureId(26),
    h = phoneTestAdapter(f.pool);
  const context = recoveryContextSchema.parse(
    await recoveryRead(f.pool, config, token, "context", customerId),
  );
  const issue = {
    operationId: newId(),
    expectedVersion: context.customerVersion,
  };
  const pending = phoneChallengeSchema.parse(
    await recoveryWrite(f.pool, config, token, "issue", customerId, issue, {
      adapter: h.adapter,
    }),
  );
  await recoveryWrite(f.pool, config, token, "issue", customerId, issue, {
    adapter: h.adapter,
  });
  const sent = phoneChallengeSchema.parse(
    await recoveryRead(
      f.pool,
      config,
      token,
      "challenge",
      customerId,
      {},
      pending.id,
    ),
  );
  const verify = {
    operationId: newId(),
    expectedVersion: context.customerVersion,
    expectedChallengeVersion: sent.version,
    code: h.code(sent.id),
  };
  await recoveryWrite(
    f.pool,
    config,
    token,
    "verify",
    customerId,
    verify,
    { adapter: h.adapter },
    sent.id,
  );
  await recoveryWrite(
    f.pool,
    config,
    token,
    "verify",
    customerId,
    verify,
    { adapter: h.adapter },
    sent.id,
  );
  const issued = await rows(issue.operationId),
    verified = await rows(verify.operationId);
  expect(issued).toHaveLength(1);
  expect(verified).toHaveLength(1);
  expect(issued[0].action).toBe("card_verification_issued");
  expect(verified[0].action).toBe("card_verification_verified");
  expect(verified[0].before.verificationState).toBe("issued");
  expect(verified[0].after.verificationState).toBe("verified");
  const sensitive = (
    await f.pool.query(
      "SELECT v.secret_hash,v.target_digest,c.phone_normalized FROM verification_challenge v JOIN customer c ON c.id=v.customer_id WHERE v.id=$1",
      [sent.id],
    )
  ).rows[0];
  const serialized = JSON.stringify([...issued, ...verified]);
  for (const value of [
    verify.code,
    sensitive.secret_hash,
    sensitive.target_digest,
    sensitive.phone_normalized,
  ])
    expect(serialized).not.toContain(value);
});
it("AU-06 precision activation snapshots exact committed time and replay preserves one event", async () => {
  const old = (
    await f.pool.query(
      "SELECT * FROM product_price_version WHERE product_id=$1 ORDER BY version DESC LIMIT 1",
      [fixtureId(9)],
    )
  ).rows[0];
  const input = {
    operationId: newId(),
    expectedVersion: old.version,
    rateKobo: String(old.rate_kobo),
    currency: "NGN",
    quantityPrecision: old.quantity_precision === 3 ? 2 : 3,
    reason: "Precision review",
  };
  await stationWrite(f.pool, config, token, "prices-activate", input, "pms");
  await stationWrite(f.pool, config, token, "prices-activate", input, "pms");
  const events = await rows(input.operationId);
  expect(events).toHaveLength(1);
  expect(events[0].before.rateKobo).toBe(events[0].after.rateKobo);
  expect(events[0].after.priceVersion).toBe(String(old.version + 1));
  const retained = (
    await f.pool.query(
      `SELECT jsonb_build_object('id',p.id,'version',p.version,'rate_kobo',p.rate_kobo::text,'currency',p.currency,'quantity_precision',p.quantity_precision,'effective_from',p.effective_from) AS price, jsonb_build_object('id',a.id,'after',a.after,'occurred_at',a.occurred_at) AS event FROM audit_event a JOIN product_price_version p ON p.id=(a.after->>'priceVersionId')::uuid WHERE a.id=$1`,
      [events[0].id],
    )
  ).rows[0];
  expect(
    priceAuditMatches(retained.event as Fact, retained.price as Fact),
  ).toBe(true);
  expect(
    priceAuditMatches(
      {
        ...retained.event,
        after: { ...retained.event.after, priceVersion: "999" },
      },
      retained.price,
    ),
  ).toBe(false);
  expect(
    priceAuditMatches(
      { ...retained.event, occurred_at: "2000-01-01T00:00:00Z" },
      retained.price,
    ),
  ).toBe(false);
  expect(
    (
      await f.pool.query(
        "SELECT a.occurred_at=p.effective_from AND (a.after->>'effectiveFrom')::timestamptz=p.effective_from AS exact FROM audit_event a JOIN product_price_version p ON p.id=(a.after->>'priceVersionId')::uuid WHERE a.id=$1",
        [events[0].id],
      )
    ).rows[0].exact,
  ).toBe(true);
});
