import { withOperationalTelemetry } from "../../../../../../../server/modules/monitoring/telemetry";
import { handleHeldRelease } from "../../../../../../../server/modules/reviews/release-http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ purchaseId: string; proposalId: string }> },
) {
  const p = await context.params;
  return handleHeldRelease(request, "get", p.purchaseId, p.proposalId);
}

export const GET = withOperationalTelemetry(handleGET);
