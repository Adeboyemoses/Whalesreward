import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleCustomerRecovery } from "../../../../../../server/modules/customers/recovery-http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
) {
  const params = await context.params;
  return handleCustomerRecovery(request, "cases", params.customerId);
}
async function handlePOST(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
) {
  const params = await context.params;
  return handleCustomerRecovery(request, "case-create", params.customerId);
}

export const GET = withOperationalTelemetry(handleGET);
export const POST = withOperationalTelemetry(handlePOST);
