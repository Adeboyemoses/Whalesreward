import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleCorrections } from "../../../../../../server/modules/corrections/http";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  const p = await context.params;
  return handleCorrections(request, "submit", p.purchaseId);
}

export const POST = withOperationalTelemetry(handlePOST);
