import { withOperationalTelemetry } from "../../../../server/modules/monitoring/telemetry";
import { handleAuth } from "../../../../server/modules/auth/http";
export const runtime = "nodejs";
function handleGET(request: Request) {
  return handleAuth(request, "session");
}

export const GET = withOperationalTelemetry(handleGET);
