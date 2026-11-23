import { withOperationalTelemetry } from "../../../../server/modules/monitoring/telemetry";
import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
async function handleGET(request: Request) {
  return handleAdmin(request, "permissions");
}

export const GET = withOperationalTelemetry(handleGET);
