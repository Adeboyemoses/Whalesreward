import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleSalesRead } from "../../../../../../server/modules/sales/http";
export const runtime = "nodejs";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  const { purchaseId } = await context.params;
  return handleSalesRead(request, "admin", "photo-access", purchaseId);
}

export const POST = withOperationalTelemetry(handlePOST);
