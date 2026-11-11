import { newSession, fixtureId } from "./sync-fixture";
import { readFile } from "node:fs/promises";
import type pg from "pg";
import { vi } from "vitest";
import {
  evidenceFixture,
  seedHistorical,
  sourceAudit,
  replacement,
  S,
} from "./review-evidence-fixture";

/** Complete historical sources for legacy guard/atomicity tests; runtime guards stay enabled. */
export async function legacyReviewFixture(pool: pg.Pool) {
  const fixtures = await readFile(
    new URL("../../prisma/fixtures.sql", import.meta.url),
    "utf8",
  );
  const x = await evidenceFixture({ pool, fixtures, async close() {} });
  vi.stubEnv("WHR_REVIEW_EVIDENCE_POLICY", JSON.stringify(x.config));
  const hold = (
    await pool.query("SELECT * FROM purchase_hold WHERE id=$1", [x.holdId])
  ).rows[0];
  const live = await newSession(pool, x.f);
  const body = {
    ...(await x.h.guard(x.sale.purchaseId)),
    expectedHoldVersion: hold.version as number,
    decision: { outcome: "accept_captured" },
    evidence: x.evidence,
  };
  return { ...x, f: { ...x.f, token: live.token }, hold, body, live };
}
export async function earlierReplacement(
  x: Awaited<ReturnType<typeof legacyReviewFixture>>,
) {
  // Offline expiry supplies U before E; the original receipt R remains after E.
  await seedHistorical(
    x.pool,
    "capture_context",
    "UPDATE capture_context SET signed_in_at='2026-11-09T13:00:00Z',offline_expires_at='2026-11-10T13:00:00Z' WHERE id=$1",
    [x.f.contextId],
  );
  await seedHistorical(
    x.pool,
    "purchase",
    "UPDATE purchase SET server_received_at='2026-11-10T14:00:00Z' WHERE id=$1",
    [x.sale.purchaseId],
  );
  const link = (
    await x.pool.query(
      "SELECT id,customer_id FROM card_customer_link WHERE card_id=$1",
      [fixtureId(29)],
    )
  ).rows[0];
  await seedHistorical(
    x.pool,
    "purchase",
    "UPDATE purchase SET lookup_receipt_status='valid',lookup_receipt_claims=$2,capture_lower_bound=$3,capture_policy_version='lookup-v1' WHERE id=$1",
    [
      x.sale.purchaseId,
      {
        version: 1,
        purpose: "capture_lookup",
        cardCode: "A7K3M9Q",
        captureContextId: x.f.contextId,
        originatingAccountId: x.f.attendantId,
        stationId: x.f.stationId,
        cardId: fixtureId(29),
        customerId: link.customer_id,
        cardCustomerLinkId: link.id,
        issuedAt: "2026-11-10T12:00:00.000Z",
        expiresAt: "2026-11-10T13:00:00.000Z",
      },
      S,
    ],
  );
  await replacement(x, "2026-11-10T13:30:00Z");
}
export async function unauthorizedCapture(
  pool: pg.Pool,
  f: { assignmentId: string; attendantId: string },
) {
  await pool.query("UPDATE assignment SET effective_until=$2 WHERE id=$1", [
    f.assignmentId,
    S,
  ]);
  await sourceAudit(
    pool,
    "assignment_ended",
    "attendant",
    f.attendantId,
    { assignmentId: f.assignmentId, effectiveUntil: S },
    S,
  );
}
