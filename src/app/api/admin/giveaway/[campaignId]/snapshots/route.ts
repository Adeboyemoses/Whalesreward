import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleGiveaway } from "@/server/modules/giveaway/http";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const p = await context.params;
  return handleGiveaway(request, "confirm", p.campaignId, undefined, undefined);
}
async function handleGET(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const p = await context.params;
  return handleGiveaway(request, "history", p.campaignId, "snapshots");
}

export const POST = withOperationalTelemetry(handlePOST);
export const GET = withOperationalTelemetry(handleGET);
