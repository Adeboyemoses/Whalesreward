import { withOperationalTelemetry } from "../../../../../../../../server/modules/monitoring/telemetry";
import { handleReviews } from "../../../../../../../../server/modules/reviews/http";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ purchaseId: string; holdId: string }> },
) {
  const p = await context.params;
  return handleReviews(request, "date", p.purchaseId, p.holdId);
}

export const POST = withOperationalTelemetry(handlePOST);
