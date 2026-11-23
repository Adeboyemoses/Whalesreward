import { withOperationalTelemetry } from "../../../../server/modules/monitoring/telemetry";
import { handleStation } from "@/server/modules/station/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function handleGET(request: Request) {
  return handleStation(request, "configured-assignment");
}

export const GET = withOperationalTelemetry(handleGET);
