import { withOperationalTelemetry } from "../../../../server/modules/monitoring/telemetry";
import { handleReports } from "@/server/modules/reports/http";
export const runtime = "nodejs";
async function handleGET(request: Request) {
  return handleReports(request, "overview");
}

export const GET = withOperationalTelemetry(handleGET);
