import { withOperationalTelemetry } from "../../../../../server/modules/monitoring/telemetry";
import { handleCardsCustomers } from "../../../../../server/modules/cards/http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const params = await context.params;
  return handleCardsCustomers(request, "cards", "detail", params.batchId);
}

export const GET = withOperationalTelemetry(handleGET);
