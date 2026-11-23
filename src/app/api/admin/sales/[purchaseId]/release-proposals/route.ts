import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleHeldRelease } from "../../../../../../server/modules/reviews/release-http";
export const runtime = "nodejs";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  const p = await context.params;
  return handleHeldRelease(request, "propose", p.purchaseId);
}
async function handleGET(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  const p = await context.params;
  return handleHeldRelease(request, "list", p.purchaseId);
}

export const POST = withOperationalTelemetry(handlePOST);
export const GET = withOperationalTelemetry(handleGET);
