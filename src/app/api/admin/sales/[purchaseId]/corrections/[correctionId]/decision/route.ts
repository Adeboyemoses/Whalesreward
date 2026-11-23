import { withOperationalTelemetry } from "../../../../../../../../server/modules/monitoring/telemetry";
import { handleCorrections } from "../../../../../../../../server/modules/corrections/http";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ purchaseId: string; correctionId: string }> },
) {
  const p = await context.params;
  return handleCorrections(request, "decide", p.purchaseId, p.correctionId);
}

export const POST = withOperationalTelemetry(handlePOST);
