import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleReviews } from "../../../../../../server/modules/reviews/http";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  const p = await context.params;
  return handleReviews(request, "capture", p.purchaseId);
}

export const POST = withOperationalTelemetry(handlePOST);
