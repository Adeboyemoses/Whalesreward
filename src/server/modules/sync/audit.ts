import type pg from "pg";
import {
  saleValuesSchema,
  type SaleValues,
} from "../../../shared/contracts/sales";
import { values } from "../sales/projections";

/** Capture under the domain aggregate lock, before mutation for a before-image. */
export async function saleAuditGates(db: pg.PoolClient, purchaseId: string) {
  const row = (
    await db.query<{
      state: string;
      holdKinds: string[];
      policyBlocks: string[];
      creditedSpendKobo: string;
    }>(
      `SELECT p.status AS state,
    ARRAY(SELECT DISTINCT h.kind FROM purchase_hold h WHERE h.purchase_id=p.id AND h.state='open' ORDER BY h.kind) AS "holdKinds",
    ARRAY(SELECT DISTINCT b.code FROM purchase_validation_block b WHERE b.purchase_id=p.id AND b.resolved_at IS NULL ORDER BY b.code) AS "policyBlocks",
    CASE WHEN p.status='credited' AND r.id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM purchase_hold h WHERE h.purchase_id=p.id AND h.state='open')
      AND NOT EXISTS(SELECT 1 FROM purchase_validation_block b WHERE b.purchase_id=p.id AND b.resolved_at IS NULL)
      THEN r.amount_kobo::text ELSE '0' END AS "creditedSpendKobo"
    FROM purchase p LEFT JOIN purchase_revision r ON r.id=p.current_revision_id AND r.purchase_id=p.id WHERE p.id=$1`,
      [purchaseId],
    )
  ).rows[0];
  if (!row) throw new Error("Audit purchase unavailable");
  return row;
}

/** Exact effective V snapshot. Candidate values never imply an accepted pointer. */
export function saleAuditValues(
  value: SaleValues,
  revisionId: string | null,
  credited: boolean,
) {
  return {
    amountKobo: value.amountKobo,
    quantity: value.quantity,
    currency: value.currency,
    unit: value.unit,
    basis: value.basis,
    medium: value.medium,
    rateKobo: value.rateKobo,
    priceVersionId: value.priceVersionId,
    revisionId,
    credited,
    calculation: value.calculation,
  };
}

export async function settlementAuditValues(
  db: pg.PoolClient,
  purchaseId: string,
  candidateId: string | null,
) {
  const row = (
    await db.query<{ value: unknown; current_revision_id: string | null }>(
      `SELECT CASE WHEN r.id IS NULL THEN ${values("p", true)} ELSE ${values("r")} END AS value,p.current_revision_id
     FROM purchase p LEFT JOIN purchase_revision r ON r.id=coalesce(p.current_revision_id,$2::uuid) AND r.purchase_id=p.id WHERE p.id=$1`,
      [purchaseId, candidateId],
    )
  ).rows[0]!;
  const gates = await saleAuditGates(db, purchaseId);
  return {
    ...saleAuditValues(
      saleValuesSchema.parse(row.value),
      row.current_revision_id,
      gates.creditedSpendKobo !== "0",
    ),
    ...gates,
  };
}
