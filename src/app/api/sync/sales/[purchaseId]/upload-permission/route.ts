import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleSync } from "../../../../../../server/modules/sync/http";
export const runtime = "nodejs";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  return handleSync(
    request,
    "upload-permission",
    (await context.params).purchaseId,
  );
}

export const POST = withOperationalTelemetry(handlePOST);
