import { withOperationalTelemetry } from "../../../../../../../../server/modules/monitoring/telemetry";
import { handleCustomerRecovery } from "../../../../../../../../server/modules/customers/recovery-http";
export const runtime = "nodejs";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ customerId: string; challengeId: string }> },
) {
  const params = await context.params;
  return handleCustomerRecovery(
    request,
    "verify",
    params.customerId,
    params.challengeId,
  );
}

export const POST = withOperationalTelemetry(handlePOST);
