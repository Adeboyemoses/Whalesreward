import pg from "pg";
import { v7 as newId } from "uuid";
import { seedId as fixtureId } from "../station/helpers";
/** Durable sale history constructed through the real schema's state guards. */
export async function historicalSale(
  db: pg.Client,
  options: {
    customerId?: string;
    cardId?: string;
    cardCode?: string;
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
  let rate = 1000000n;
  const quantity = (value: string) =>
    `${(BigInt(value) * 1000000n) / rate / 1000000n}.${(((BigInt(value) * 1000000n) / rate) % 1000000n).toString().padStart(6, "0")}`;
  const id = newId(),
    revisionId = newId(),
    photoId = newId();
  let priceId = "",
    precision = 2;
  const customerId = options.customerId ?? fixtureId(26);
  let sellerId = fixtureId(gas ? 7 : 6),
    contextId = fixtureId(gas ? 25 : 24),
    assignmentId = fixtureId(gas ? 19 : 18);
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
    const price = (
      await db.query(
        "SELECT id,rate_kobo,quantity_precision FROM product_price_version WHERE station_id=$1 AND product_id=$2 ORDER BY effective_from DESC,version DESC LIMIT 1",
        [fixtureId(8), fixtureId(gas ? 12 : diesel ? 10 : 9)],
      )
    ).rows[0];
    priceId = price.id;
    rate = BigInt(price.rate_kobo);
    precision = price.quantity_precision;
    await db.query(
      `INSERT INTO purchase(id,originating_attendant_id,operation_id,payload_digest,sale_code,capture_context_id,assignment_id,station_id,pump_id,product_id,seller_name,seller_username,card_code,app_captured_at,server_received_at,price_version_id,basis,entered_amount_kobo,amount_kobo,quantity,rate_kobo,currency,unit,quantity_precision,medium,expected_photo_digest,expected_photo_bytes,customer_id,card_id,status,version)
      VALUES($1,$2,$3,'fictional aggregate',$4,$5,$6,$7,$8,$9,'Grace Okon','grace.okon',$20,clock_timestamp(),clock_timestamp(),$10,'amount',$11,$11,$12,$18,'NGN',$13,$19,$14,$15,100,$16,$17,'received',1)`,
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
        options.cardId ?? fixtureId(29),
        rate.toString(),
        precision,
        options.cardCode ?? "A7K3M9Q",
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
        SELECT $1,id,$2,$3,$4,'fictional revision',$5,$6,'proposed',$7,clock_timestamp(),$8,$9,currency,unit,quantity_precision,'amount',$8,rate_kobo,price_version_id,medium,$10 FROM purchase WHERE id=$11`,
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
  }
}
