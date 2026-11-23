import { withOperationalTelemetry } from "../../../../server/modules/monitoring/telemetry";
import { handleStation } from "@/server/modules/station/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function handleGET(request: Request) {
  return handleStation(request, "pumps-list");
}
function handlePOST(request: Request) {
  return handleStation(request, "pumps-create");
}

export const GET = withOperationalTelemetry(handleGET);
export const POST = withOperationalTelemetry(handlePOST);
