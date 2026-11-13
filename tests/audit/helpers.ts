import { type Page } from "@playwright/test";
import { v7 } from "uuid";
import { stationFixture, seedId } from "../station/helpers";
import { writeAudit, auditSystem } from "../../src/server/modules/audit/write";
import type pg from "pg";

export async function auditFixture(page: Page, permissions = ["audit"]) {
  const f = await stationFixture(page, permissions);
  const targetId = v7(),
    marker = `Audit ${v7()
      .slice(-12)
      .replace(/[0-9]/g, (n) => String.fromCharCode(103 + Number(n)))}`;
  const actor = {
    kind: "admin" as const,
    userId: f.userId,
    code: "ADMIN001",
    nameAtEvent: "Ada Williams",
    usernameAtEvent: "ada.williams",
    roleAtEvent: "Owner at event",
  };
  const seller = {
    attendantId: seedId(4),
    accountId: seedId(3),
    staffCode: "STAFF002",
    name: "Grace Okon",
    username: "grace.okon",
  };
  const db = f.db as unknown as pg.PoolClient;
  const ids: string[] = [];
  for (let i = 0; i < 9; i++)
    ids.push(
      await writeAudit(db, {
        stationId: seedId(8),
        action: "batch_activated",
        actor,
        target: {
          kind: "card_batch",
          id: targetId,
          code: "BATCH002",
          subjectAtEvent: marker,
        },
        before: { batchStatus: "printed", batchVersion: "2" },
        after: { batchStatus: "active", batchVersion: "3" },
        reason: "Printed stock checked and released to the registration desk.",
        occurredAt: `2026-11-02T09:${String(40 + i).padStart(2, "0")}:00.000Z`,
      }),
    );
  const values = {
    amountKobo: "1000000",
    quantity: "10.000",
    currency: "NGN",
    unit: "litre",
    basis: "amount",
    medium: "vehicle",
    rateKobo: "100000",
    priceVersionId: v7(),
    revisionId: v7(),
    credited: true,
    calculation: "captured_rate",
  };
  const correction = await writeAudit(db, {
    stationId: seedId(8),
    action: "correction_approved",
    actor,
    originatingSeller: seller,
    target: {
      kind: "purchase",
      id: targetId,
      code: "S004",
      subjectAtEvent: marker,
    },
    reason:
      "Meter photo checked; amount was entered incorrectly. Late correction reviewed.",
    before: {
      ...values,
      correctionState: "awaiting_review",
      decisionId: null,
      outcome: null,
    },
    after: {
      ...values,
      amountKobo: "1200000",
      quantity: "12.000",
      correctionState: "accepted",
      decisionId: v7(),
      outcome: "approve",
    },
    relatedEventIds: [ids[0]!],
    occurredAt: "2026-11-02T09:10:00.000Z",
  });
  const attendant = await writeAudit(db, {
    stationId: seedId(8),
    action: "correction_received",
    actor: {
      ...actor,
      kind: "attendant",
      code: "STAFF002",
      nameAtEvent: "Grace Okon",
      usernameAtEvent: "grace.okon",
      roleAtEvent: "Attendant",
    },
    originatingSeller: seller,
    target: {
      kind: "purchase",
      id: targetId,
      code: "S011",
      subjectAtEvent: marker,
    },
    reason: "Entry mistake corrected against the meter photo.",
    before: { ...values, correctionState: "pending_validation" },
    after: { ...values, correctionState: "awaiting_review" },
    occurredAt: "2026-11-02T10:05:00.000Z",
  });
  const system = await writeAudit(db, {
    stationId: seedId(8),
    action: "sale_cancelled_unmatched",
    actor: auditSystem("sync"),
    originatingSeller: seller,
    target: {
      kind: "purchase",
      id: targetId,
      code: "S012",
      subjectAtEvent: marker,
    },
    reason: "Online lookup definitively confirmed no matching customer.",
    before: {
      state: "received",
      credited: false,
      creditedSpendKobo: "0",
    },
    after: { state: "cancelled", credited: false, creditedSpendKobo: "0" },
    occurredAt: "2026-11-02T10:10:00.000Z",
  });
  const legacy = v7();
  await f.db.query(
    `INSERT INTO audit_event(id,actor_kind,action,target_type,target_id,"before","after",reason,occurred_at,station_id) VALUES($1,'system','unknown_old_action','pump',$2,'{}',$3,'Historical fixture','2026-11-01T22:59:59Z',$4)`,
    [
      legacy,
      seedId(13),
      JSON.stringify({ phone: "08012345678", token: "token=PrivateCanary" }),
      seedId(8),
    ],
  );
  return { ...f, targetId, marker, ids, correction, attendant, system, legacy };
}
