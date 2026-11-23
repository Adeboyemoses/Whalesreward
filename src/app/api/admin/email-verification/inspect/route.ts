import { withOperationalTelemetry } from "../../../../../server/modules/monitoring/telemetry";
import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
async function handlePOST(request: Request) {
  return handleAdmin(request, "email-verification-inspect");
}

export const POST = withOperationalTelemetry(handlePOST);
