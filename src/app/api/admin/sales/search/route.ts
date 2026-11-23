import { withOperationalTelemetry } from "../../../../../server/modules/monitoring/telemetry";
import { handleSalesRead } from "../../../../../server/modules/sales/http";
export const runtime = "nodejs";
async function handlePOST(request: Request) {
  return handleSalesRead(request, "admin", "search");
}

export const POST = withOperationalTelemetry(handlePOST);
