import { randomBytes } from "node:crypto";
import type pg from "pg";
import {
  phoneCodeVerifier,
  phoneCodeMatches,
  type PhoneVerificationAdapter,
} from "../../src/server/adapters/phone-verification";
/** Test-only delivery double. Ephemeral codes stay in memory, never test output,
 * persistent fixtures, delivery records, audit, or request snapshots. */
export function phoneTestAdapter(pool: pg.Pool) {
  const key = randomBytes(32).toString("hex"),
    codes = new Map<string, string>();
  let sends = 0;
  const adapter: PhoneVerificationAdapter = {
    kind: "TEST",
    policy: { lifetimeMs: 60000, resendMs: 1, maxAttempts: 3 },
    async request(customerId, purpose, generation) {
      const row = (
        await pool.query(
          "SELECT id FROM verification_challenge WHERE customer_id=$1 AND purpose=$2 AND phone_generation=$3",
          [customerId, purpose, generation],
        )
      ).rows[0];
      const code = randomBytes(12).toString("hex");
      codes.set(row.id, code);
      sends++;
      return {
        outcome: "sent",
        verifier: phoneCodeVerifier(key, row.id, code),
        keyVersion: "test-v1",
      };
    },
    async verify(id, code) {
      const row = (
        await pool.query(
          "SELECT secret_hash FROM verification_challenge WHERE id=$1",
          [id],
        )
      ).rows[0];
      return row && phoneCodeMatches(key, id, code, row.secret_hash)
        ? "verified"
        : "unavailable";
    },
  };
  return {
    adapter,
    code: (id: string) => {
      const code = codes.get(id);
      if (!code) throw new Error("No ephemeral code");
      return code;
    },
    sends: () => sends,
  };
}
