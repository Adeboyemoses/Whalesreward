import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleCardsCustomers } from "../../../../../../server/modules/cards/http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const params = await context.params;
  return handleCardsCustomers(request, "cards", "exports", params.batchId);
}
async function handlePOST(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const params = await context.params;
  return handleCardsCustomers(request, "cards", "export", params.batchId);
}

export const GET = withOperationalTelemetry(handleGET);
export const POST = withOperationalTelemetry(handlePOST);
