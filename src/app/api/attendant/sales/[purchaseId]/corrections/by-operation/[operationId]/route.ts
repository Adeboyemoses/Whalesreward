import { withOperationalTelemetry } from "../../../../../../../../server/modules/monitoring/telemetry";
import { handleCorrections } from "../../../../../../../../server/modules/corrections/http";
async function handleGET(
  request: Request,
  context: { params: Promise<{ purchaseId: string; operationId: string }> },
) {
  const p = await context.params;
  return handleCorrections(request, "lookup", p.purchaseId, p.operationId);
}

export const GET = withOperationalTelemetry(handleGET);
