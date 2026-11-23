import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleCardsCustomers } from "../../../../../../server/modules/cards/http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
) {
  const params = await context.params;
  return handleCardsCustomers(
    request,
    "customers",
    "purchases",
    params.customerId,
  );
}

export const GET = withOperationalTelemetry(handleGET);
