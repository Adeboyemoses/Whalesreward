import { withOperationalTelemetry } from "../../../../server/modules/monitoring/telemetry";
import { handleStation } from "@/server/modules/station/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function handlePOST(request: Request) {
  return handleStation(request, "attendants-create");
}

export const POST = withOperationalTelemetry(handlePOST);
