import { saleStatusSchema, type OutboxRow, type SaleStatus } from "../types";
export function authoritativeStatus(row: OutboxRow): SaleStatus | null {
  const result = saleStatusSchema.safeParse(row.serverStatus);
  if (
    !result.success ||
    result.data.operationId !== row.operationId ||
    result.data.purchaseId !== row.purchaseId
  )
    return null;
  return result.data;
}
export function isCredited(row: OutboxRow): boolean {
  return authoritativeStatus(row)?.state === "credited";
}
export function needsUpload(row: OutboxRow): boolean {
  const status = authoritativeStatus(row);
  return !status || !["credited", "held", "cancelled"].includes(status.state);
}
