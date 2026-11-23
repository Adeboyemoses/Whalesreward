import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleCardsCustomers } from "../../../../../../server/modules/cards/http";
export const runtime = "nodejs";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const params = await context.params;
  return handleCardsCustomers(request, "cards", "activate", params.batchId);
}

export const POST = withOperationalTelemetry(handlePOST);
