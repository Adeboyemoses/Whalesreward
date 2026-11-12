import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { newId } from "../../src/server/lib/ids";
import { cardsFixture, fixtureId } from "./cards-adversarial-fixture";

/** Ephemeral codes exist only in this closure; no fixed/sample code is shipped. */
export function ephemeralVerification(pool: pg.Pool, maxAttempts = 5) {
  const key = randomBytes(32);
  const codes = new Map<string, string>();
  const verifier = (id: string, code: string) =>
    createHmac("sha256", key)
      .update(JSON.stringify([id, code]))
      .digest();
  let sends = 0;
  const adapter = {
    kind: "TEST" as const,
    policy: { lifetimeMs: 60_000, resendMs: 1, maxAttempts },
    async request(
      customerId: string,
      purpose: "replace_card",
      generation: string,
    ) {
      const challenge = (
        await pool.query(
          "SELECT id FROM verification_challenge WHERE customer_id=$1 AND purpose=$2 AND phone_generation=$3",
          [customerId, purpose, generation],
        )
      ).rows[0];
      if (!challenge) throw new Error("Missing durable challenge intent");
      const code = randomBytes(16).toString("hex");
      codes.set(challenge.id, code);
      sends++;
      return {
        outcome: "sent" as const,
        verifier: verifier(challenge.id, code).toString("hex"),
        keyVersion: "test-v1",
      };
    },
    async verify(challengeId: string, code: string) {
      const challenge = (
        await pool.query(
          "SELECT secret_hash FROM verification_challenge WHERE id=$1",
          [challengeId],
        )
      ).rows[0];
      const stored = Buffer.from(challenge.secret_hash, "hex");
      return stored.length === 32 &&
        timingSafeEqual(stored, verifier(challengeId, code))
        ? ("verified" as const)
        : ("unavailable" as const);
    },
  };
  return { adapter, code: (id: string) => codes.get(id)!, sends: () => sends };
}

/** Isolated real PostgreSQL data; no provider destination or response fixtures. */
export async function recoveryAdversarialFixture() {
  const base = await cardsFixture();
  let phoneSequence = 6000;
  const phone = () => `080${String(++phoneSequence).padStart(8, "0")}`;
  async function card() {
    const id = newId();
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from(
      randomBytes(7),
      (n) => alphabet[n % alphabet.length],
    ).join("");
    await base.pool.query(
      "INSERT INTO card(id,batch_id,code,qr_payload,state,version) VALUES($1,$2,$3,$3,'unassigned',1)",
      [id, fixtureId(28), code],
    );
    return { id, code, version: 1 };
  }
  async function customer() {
    const id = newId(),
      activeCard = await card(),
      nationalPhone = phone();
    await base.pool.query(
      "INSERT INTO customer(id,customer_code,name,phone_normalized,category,version) VALUES($1,$2,'Amina Bello',$3,'car_owner',1)",
      [id, `ADV-${id}`, `+234${nationalPhone.slice(1)}`],
    );
    await base.pool.query(
      "INSERT INTO card_customer_link(id,card_id,customer_id,linked_at,actor_user_id,reason) VALUES($1,$2,$3,clock_timestamp()-interval '1 hour',$4,'Fictional registration')",
      [newId(), activeCard.id, id, fixtureId(2)],
    );
    await base.pool.query(
      "UPDATE card SET state='linked',version=2 WHERE id=$1",
      [activeCard.id],
    );
    return {
      id,
      phone: nationalPhone,
      version: 1,
      card: { ...activeCard, version: 2 },
    };
  }
  async function identity(customerId: string) {
    return (
      await base.pool.query(
        `SELECT to_jsonb(c) AS customer,
       (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM card_customer_link l WHERE l.customer_id=c.id) AS links,
       (SELECT jsonb_agg(to_jsonb(k) ORDER BY k.id) FROM card k JOIN card_customer_link l ON l.card_id=k.id WHERE l.customer_id=c.id) AS cards
       FROM customer c WHERE c.id=$1`,
        [customerId],
      )
    ).rows[0];
  }
  /** Both requests must reach a real database lock before either can proceed. */
  async function race<T, U>(first: () => Promise<T>, second: () => Promise<U>) {
    const gate = await base.pool.connect();
    let results: Promise<PromiseSettledResult<T | U>[]> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query(
        "SELECT id FROM security_state WHERE id=true FOR UPDATE",
      );
      results = Promise.allSettled([first(), second()]);
      let waiting = 0;
      for (let attempt = 0; attempt < 200; attempt++) {
        waiting = Number(
          (
            await base.pool.query(
              "SELECT count(*) AS n FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid() AND wait_event_type='Lock'",
              [base.schema],
            )
          ).rows[0].n,
        );
        if (waiting >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (waiting < 2)
        throw new Error("Both competing requests must reach PostgreSQL locks");
      await gate.query("COMMIT");
      return await results;
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await results;
    }
  }
  return { ...base, card, customer, phone, identity, race };
}
