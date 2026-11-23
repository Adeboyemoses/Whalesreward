import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleStation } from "@/server/modules/station/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(
  request: Request,
  context: { params: Promise<{ pumpId: string }> },
) {
  return handleStation(
    request,
    "pumps-assignments",
    (await context.params).pumpId,
  );
}

export const GET = withOperationalTelemetry(handleGET);
