import { withOperationalTelemetry } from "../../../../../../../../server/modules/monitoring/telemetry";
import { handleHeldRelease } from "../../../../../../../../server/modules/reviews/release-http";
export const runtime = "nodejs";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ purchaseId: string; proposalId: string }> },
) {
  const p = await context.params;
  return handleHeldRelease(request, "decide", p.purchaseId, p.proposalId);
}

export const POST = withOperationalTelemetry(handlePOST);
