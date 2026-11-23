import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleStation } from "@/server/modules/station/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ attendantId: string }> },
) {
  return handleStation(
    request,
    "attendants-assignment",
    (await context.params).attendantId,
  );
}

export const POST = withOperationalTelemetry(handlePOST);
