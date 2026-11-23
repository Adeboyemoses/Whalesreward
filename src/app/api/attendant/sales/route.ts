import { withOperationalTelemetry } from "../../../../server/modules/monitoring/telemetry";
import { handleSalesRead } from "../../../../server/modules/sales/http";
export const runtime = "nodejs";
async function handleGET(request: Request) {
  return handleSalesRead(request, "attendant", "list");
}

export const GET = withOperationalTelemetry(handleGET);
