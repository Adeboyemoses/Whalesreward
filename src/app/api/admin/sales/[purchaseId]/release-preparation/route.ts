import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleReleaseDiscovery } from "../../../../../../server/modules/reviews/release-discovery-http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  return handleReleaseDiscovery(request, (await context.params).purchaseId);
}

export const GET = withOperationalTelemetry(handleGET);
