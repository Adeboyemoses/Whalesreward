import { newId } from "../../src/server/lib/ids";
import { fixtureId } from "./sync-fixture";
import {
  evidenceFixture,
  replacement,
  sourceAudit,
  type evidenceDatabase,
  type Kind,
} from "./review-evidence-fixture";

/** Disposable test history only; never grants production identity or activation. */
export async function heldReleaseFixture(
  db: Awaited<ReturnType<typeof evidenceDatabase>>,
  kind: Kind = "card",
) {
  const x = await evidenceFixture(db, kind);
  const secondUser = newId();
  await db.pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Amina Bello',true,1,false,now())",
    [secondUser, `reviewer.${secondUser}`],
  );
  await db.pool.query(
    "INSERT INTO admin(id,user_id,admin_code,email_normalized,role_id,version) VALUES($1,$2,$3,$4,$5,1)",
    [
      newId(),
      secondUser,
      `ADMIN-${secondUser}`,
      `${secondUser}@example.com`,
      fixtureId(1),
    ],
  );
  const actors = [fixtureId(2), secondUser, x.f.userId];
  const people = [] as string[];
  for (const user of actors) {
    const person = newId();
    people.push(person);
    await db.pool.query(
      "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
      [person, x.f.stationId],
    );
    await db.pool.query(
      "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,1,true)",
      [newId(), x.f.stationId, user, person],
    );
  }
  if (kind === "card") await replacement(x, "2026-11-10T12:30:00.000000Z");
  if (kind === "price") {
    const price = newId();
    await db.pool.query(
      "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) VALUES($1,$2,$3,2,110000,'NGN',2,'2026-11-10T12:30:00Z',$4,'Fictional boundary')",
      [price, x.f.stationId, fixtureId(9), fixtureId(5)],
    );
    await sourceAudit(
      db.pool,
      "price_activated",
      "product",
      fixtureId(9),
      {
        priceVersionId: price,
        version: 2,
        rateKobo: "110000",
        quantityPrecision: 2,
      },
      "2026-11-10T12:30:00Z",
    );
  }
  const target =
    kind === "capture"
      ? {
          kind,
          blocks: [
            {
              id: x.holdId,
              version: 1,
              code: "capture_authorization_unresolved" as const,
            },
          ],
        }
      : { kind, holdId: x.holdId, expectedHoldVersion: 1 };
  const facts = {
    source: "shift_sheet" as const,
    entryReference: "Shift A entry 7",
    stationId: x.f.stationId,
    accountId: x.f.userId,
    pumpId: x.f.pumpId,
    product: "pms" as const,
    customerId: fixtureId(26),
    cardId: fixtureId(29),
    recordedAmountKobo: "2000000",
    recordedQuantity: "20",
    recordedRateKobo: "100000",
    observedCapture: {
      from: "2026-11-10T12:10:00.000Z",
      through: "2026-11-10T12:20:00.000Z",
      timezone: "Africa/Lagos" as const,
    },
    finding: "sale_recorded" as const,
  };
  return { ...x, actors, people, target, facts };
}
