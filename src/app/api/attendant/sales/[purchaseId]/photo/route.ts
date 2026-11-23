import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleSalesRead } from "../../../../../../server/modules/sales/http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  const { purchaseId } = await context.params;
  return handleSalesRead(request, "attendant", "photo", purchaseId);
}

export const GET = withOperationalTelemetry(handleGET);
