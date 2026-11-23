import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleReviews } from "../../../../../../server/modules/reviews/http";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ flagId: string }> },
) {
  const p = await context.params;
  return handleReviews(request, "duplicate", p.flagId);
}

export const POST = withOperationalTelemetry(handlePOST);
