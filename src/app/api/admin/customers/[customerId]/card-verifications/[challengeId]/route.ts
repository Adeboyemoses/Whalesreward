import { withOperationalTelemetry } from "../../../../../../../server/modules/monitoring/telemetry";
import { handleCustomerRecovery } from "../../../../../../../server/modules/customers/recovery-http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ customerId: string; challengeId: string }> },
) {
  const params = await context.params;
  return handleCustomerRecovery(
    request,
    "challenge",
    params.customerId,
    params.challengeId,
  );
}

export const GET = withOperationalTelemetry(handleGET);
