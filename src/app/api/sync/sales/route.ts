import { withOperationalTelemetry } from "../../../../server/modules/monitoring/telemetry";
import { handleSync } from "../../../../server/modules/sync/http";
export const runtime = "nodejs";
async function handlePOST(request: Request) {
  return handleSync(request, "submit");
}

export const POST = withOperationalTelemetry(handlePOST);
