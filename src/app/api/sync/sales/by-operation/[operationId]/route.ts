import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleSync } from "../../../../../../server/modules/sync/http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ operationId: string }> },
) {
  return handleSync(request, "status", (await context.params).operationId);
}

export const GET = withOperationalTelemetry(handleGET);
