import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleStation } from "@/server/modules/station/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(
  request: Request,
  context: { params: Promise<{ attendantId: string }> },
) {
  return handleStation(
    request,
    "attendants-assignments",
    (await context.params).attendantId,
  );
}

export const GET = withOperationalTelemetry(handleGET);
