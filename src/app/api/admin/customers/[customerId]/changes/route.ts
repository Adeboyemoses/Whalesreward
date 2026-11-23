import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleCustomerRecovery } from "../../../../../../server/modules/customers/recovery-http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
) {
  const params = await context.params;
  return handleCustomerRecovery(request, "changes", params.customerId);
}

export const GET = withOperationalTelemetry(handleGET);
