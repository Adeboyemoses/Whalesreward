import { withOperationalTelemetry } from "../../../../../../../server/modules/monitoring/telemetry";
import { handleCustomerRecovery } from "../../../../../../../server/modules/customers/recovery-http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ customerId: string; caseId: string }> },
) {
  const params = await context.params;
  return handleCustomerRecovery(
    request,
    "case",
    params.customerId,
    params.caseId,
  );
}

export const GET = withOperationalTelemetry(handleGET);
