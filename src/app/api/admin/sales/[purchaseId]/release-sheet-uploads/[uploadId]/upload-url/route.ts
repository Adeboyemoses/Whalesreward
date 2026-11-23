import { withOperationalTelemetry } from "../../../../../../../../server/modules/monitoring/telemetry";
import { handleReleaseUpload } from "@/server/modules/reviews/release-upload-http";
export const runtime = "nodejs";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ purchaseId: string; uploadId?: string }> },
) {
  const { purchaseId, uploadId } = await context.params;
  return handleReleaseUpload(request, purchaseId, "url", uploadId);
}

export const POST = withOperationalTelemetry(handlePOST);
