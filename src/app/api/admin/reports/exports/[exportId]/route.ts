import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleReports } from "@/server/modules/reports/http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ exportId: string }> },
) {
  return handleReports(request, "status", (await context.params).exportId);
}

export const GET = withOperationalTelemetry(handleGET);
