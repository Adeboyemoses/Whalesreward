import { withOperationalTelemetry } from "../../../../../server/modules/monitoring/telemetry";
import { handleReleaseDiscovery } from "../../../../../server/modules/reviews/release-discovery-http";
export const runtime = "nodejs";
async function handleGET(request: Request) {
  return handleReleaseDiscovery(request);
}

export const GET = withOperationalTelemetry(handleGET);
