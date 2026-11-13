import { beforeAll, afterAll, it, expect } from "vitest";
import {
  cardsFixture,
  config,
  fixtureId as id,
} from "../helpers/cards-adversarial-fixture";
import { phoneTestAdapter } from "../helpers/customer-recovery-fixture";
import { newId } from "../../src/server/lib/ids";
import { readAudit } from "../../src/server/modules/audit/service";
import {
  eventStation,
  type AuditRow,
} from "../../src/server/modules/audit/project";
import {
  auditEventSchema,
  auditPageSchema,
} from "../../src/shared/contracts/audit";
import {
  recoveryRead,
  recoveryWrite,
} from "../../src/server/modules/customers/recovery";
import { phoneChallengeSchema } from "../../src/shared/contracts/customer-recovery";
let f: Awaited<ReturnType<typeof cardsFixture>>, token: string;
beforeAll(async () => {
  f = await cardsFixture();
  token = await f.owner();
}, 30000);
afterAll(async () => f?.close());
async function legacy(
  action: string,
  kind: string,
  target: string,
  before: unknown,
  after: unknown,
) {
  const eventId = newId();
  await f.pool.query(
    `INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,"before","after",reason,occurred_at) VALUES($1,$2,'user',$3,$4,$5,$6,$7,'Historical fixture',clock_timestamp())`,
    [
      eventId,
      id(2),
      action,
      kind,
      target,
      JSON.stringify(before),
      JSON.stringify(after),
    ],
  );
  return eventId;
}
const detail = async (eventId: string) =>
  auditEventSchema.parse(
    await readAudit(f.pool, config, token, "detail", {}, eventId),
  );
it("I-41 pre-envelope price and assignment references prove their own immutable target station without reconstructing snapshots", async () => {
  const price = await legacy("price_activated", "product", id(9), null, {
    priceVersionId: id(20),
    version: 1,
    rateKobo: "100000",
    quantityPrecision: 2,
  });
  const assignment = await legacy(
    "assignment_changed",
    "attendant",
    id(6),
    null,
    { assignmentId: id(18), pumpId: id(14), version: 1 },
  );
  const ending = await legacy(
    "assignment_ended",
    "attendant",
    id(6),
    {
      assignmentId: id(18),
      pumpId: id(14),
      effectiveUntil: null,
      attendantVersion: "1",
      authVersion: "1",
    },
    {
      assignmentId: null,
      pumpId: null,
      effectiveUntil: "2026-11-13T00:00:00Z",
      attendantVersion: "2",
      authVersion: "2",
    },
  );
  for (const eventId of [price, assignment, ending]) {
    const bytes = JSON.stringify(
      (
        await f.pool.query(
          "SELECT row_to_json(a) row FROM audit_event a WHERE id=$1",
          [eventId],
        )
      ).rows,
    );
    const event = await detail(eventId);
    expect(event).toMatchObject({
      schemaVersion: 0,
      stationId: id(8),
      actor: null,
      target: { code: null, subjectAtEvent: null },
    });
    expect(
      auditPageSchema
        .parse(
          await readAudit(f.pool, config, token, "search", {
            targetId: event.target.id,
          }),
        )
        .items.map((e) => e.id),
    ).toContain(eventId);
    expect(
      JSON.stringify(
        (
          await f.pool.query(
            "SELECT row_to_json(a) row FROM audit_event a WHERE id=$1",
            [eventId],
          )
        ).rows,
      ),
    ).toBe(bytes);
    expect(
      (
        await f.pool.query(
          "SELECT schema_version,station_id,target_snapshot FROM audit_event WHERE id=$1",
          [eventId],
        )
      ).rows[0],
    ).toEqual({
      schema_version: null,
      station_id: null,
      target_snapshot: null,
    });
  }
  const invalid = [
    await legacy("price_activated", "product", id(10), null, {
      priceVersionId: id(20),
    }),
    await legacy(
      "price_activated",
      "product",
      id(9),
      { priceVersionId: id(21) },
      { priceVersionId: id(20) },
    ),
    await legacy("assignment_changed", "attendant", id(7), null, {
      assignmentId: id(18),
      pumpId: id(14),
    }),
    await legacy("assignment_changed", "attendant", id(6), null, {
      assignmentId: id(18),
      pumpId: id(17),
    }),
    await legacy(
      "assignment_changed",
      "attendant",
      id(6),
      { assignmentId: id(19), pumpId: id(17) },
      { assignmentId: id(18), pumpId: id(14) },
    ),
  ];
  for (const eventId of invalid)
    await expect(detail(eventId)).rejects.toMatchObject({ code: "not_found" });
});
it("I-41 contradictory and foreign station references do not establish legacy membership", async () => {
  const db = await f.pool.connect();
  await db.query("BEGIN");
  try {
    const station = newId(),
      price = newId();
    await db.query(
      "INSERT INTO station(id,code,name,timezone,version) VALUES($1,'OTHER','Other fictional station','Africa/Lagos',1)",
      [station],
    );
    await db.query(
      "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) VALUES($1,$2,$3,1,100000,'NGN',2,clock_timestamp(),$4,'Fictional price')",
      [price, station, id(9), id(5)],
    );
    const row = {
      station_id: null,
      target_type: "product",
      target_id: id(9),
      action: "price_activated",
      before: { priceVersionId: id(20) },
      after: { priceVersionId: price },
    } as AuditRow;
    expect(await eventStation(db, row)).toBeNull();
    expect(await eventStation(db, { ...row, before: null })).toBe(station);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
it("I-41 legacy card replacement scope comes from its exact identity-change link and rejects contradictory IDs", async () => {
  const customer = newId(),
    oldCard = newId(),
    newCard = newId();
  await f.pool.query(
    "INSERT INTO customer(id,customer_code,name,phone_normalized,category,version,registered_station_id,registered_by_user_id) VALUES($1,'CUST812','Amina Bello','+2348000000812','car_owner',1,$2,$3)",
    [customer, id(8), id(2)],
  );
  await f.pool.query(
    "INSERT INTO card(id,batch_id,code,qr_payload,state,version) VALUES($1,$3,'P7H3K8M','P7H3K8M','unassigned',1),($2,$3,'R7H3K8M','R7H3K8M','unassigned',1)",
    [oldCard, newCard, id(28)],
  );
  await f.pool.query(
    "INSERT INTO card_customer_link(id,card_id,customer_id,linked_at,actor_user_id,reason) VALUES($1,$2,$3,clock_timestamp(),$4,'Fictional registration')",
    [newId(), oldCard, customer, id(2)],
  );
  await f.pool.query("UPDATE card SET state='linked',version=2 WHERE id=$1", [
    oldCard,
  ]);
  const h = phoneTestAdapter(f.pool);
  const issued = phoneChallengeSchema.parse(
    await recoveryWrite(
      f.pool,
      config,
      token,
      "issue",
      customer,
      { operationId: newId(), expectedVersion: 1 },
      { adapter: h.adapter },
    ),
  );
  const challenge = phoneChallengeSchema.parse(
    await recoveryRead(
      f.pool,
      config,
      token,
      "challenge",
      customer,
      {},
      issued.id,
    ),
  );
  await recoveryWrite(
    f.pool,
    config,
    token,
    "verify",
    customer,
    {
      operationId: newId(),
      expectedVersion: 1,
      expectedChallengeVersion: challenge.version,
      code: h.code(issued.id),
    },
    { adapter: h.adapter },
    issued.id,
  );
  async function linked(payload: Record<string, unknown>, target = oldCard) {
    const eventId = await legacy(
        "card_replaced",
        "card",
        target,
        null,
        payload,
      ),
      changeId = newId();
    await f.pool.query(
      `INSERT INTO customer_identity_change(id,customer_id,actor_id,operation_id,kind,challenge_id,verification_evidence,reason,customer_version,verification_method,old_card_id,new_card_id,applied_at,audit_event_id,actor_snapshot) VALUES($1,$2,$3,$4,'card_replacement',$5,'registered_phone_code','Historical replacement',2,'registered_phone_code',$6,$7,clock_timestamp(),$8,'{}')`,
      [
        changeId,
        customer,
        id(5),
        newId(),
        issued.id,
        oldCard,
        newCard,
        eventId,
      ],
    );
    return eventId;
  }
  const good = await linked({
    customerId: customer,
    replacementCardId: newCard,
    oldCardCode: "P7H3K8M",
    newCardCode: "R7H3K8M",
    verificationMethod: "registered_phone_code",
  });
  expect(await detail(good)).toMatchObject({
    schemaVersion: 0,
    action: "card_replaced",
    stationId: id(8),
    target: { kind: "card", id: oldCard, code: null },
    actor: null,
  });
  expect(JSON.stringify(await detail(good))).not.toMatch(/P7H3K8M|R7H3K8M/);
  for (const eventId of [
    await linked({ customerId: id(26), replacementCardId: newCard }),
    await linked({ customerId: customer, replacementCardId: id(29) }),
    await linked({ customerId: customer, replacementCardId: newCard }, newCard),
  ])
    await expect(detail(eventId)).rejects.toMatchObject({ code: "not_found" });
});
it("I-41 inherited object action names return empty legacy events instead of failing the audit page", async () => {
  for (const action of [
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
  ]) {
    const eventId = await legacy(action, "pump", id(13), {}, {});
    expect(await detail(eventId)).toMatchObject({
      schemaVersion: 0,
      action: "legacy_event",
      changes: [],
      reason: "Historical event",
    });
  }
  for (const kind of [
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
  ]) {
    const eventId = await legacy("unknown_action", kind, id(13), {}, {});
    await expect(detail(eventId)).rejects.toMatchObject({ code: "not_found" });
  }
  expect(
    auditPageSchema.parse(await readAudit(f.pool, config, token, "search", {}))
      .items.length,
  ).toBeGreaterThan(0);
});
