import { withOperationalTelemetry } from "../../../../../server/modules/monitoring/telemetry";
import { handleCardsCustomers } from "../../../../../server/modules/cards/http";
export const runtime = "nodejs";
async function handlePOST(request: Request) {
  return handleCardsCustomers(request, "customers", "lookup");
}

export const POST = withOperationalTelemetry(handlePOST);
