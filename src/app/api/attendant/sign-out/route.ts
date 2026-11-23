import { withOperationalTelemetry } from "../../../../server/modules/monitoring/telemetry";
import { handleAuth } from "../../../../server/modules/auth/http";
export const runtime = "nodejs";
function handlePOST(request: Request) {
  return handleAuth(request, "sign-out");
}

export const POST = withOperationalTelemetry(handlePOST);
