import { withOperationalTelemetry } from "../../../../../server/modules/monitoring/telemetry";
import { handleReports } from "@/server/modules/reports/http";
export const runtime = "nodejs";
async function handlePOST(request: Request) {
  return handleReports(request, "query");
}

export const POST = withOperationalTelemetry(handlePOST);
