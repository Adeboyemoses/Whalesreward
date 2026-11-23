import { withOperationalTelemetry } from "../../../../server/modules/monitoring/telemetry";
import { handleCardsCustomers } from "../../../../server/modules/cards/http";
export const runtime = "nodejs";
async function handleGET(request: Request) {
  return handleCardsCustomers(request, "cards", "list");
}
async function handlePOST(request: Request) {
  return handleCardsCustomers(request, "cards", "create");
}

export const GET = withOperationalTelemetry(handleGET);
export const POST = withOperationalTelemetry(handlePOST);
