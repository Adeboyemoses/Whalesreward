import { withOperationalTelemetry } from "../../../../../server/modules/monitoring/telemetry";
import { handleAudit } from "../../../../../server/modules/audit/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function handlePOST(request: Request) {
  return handleAudit(request, "search");
}

export const POST = withOperationalTelemetry(handlePOST);
