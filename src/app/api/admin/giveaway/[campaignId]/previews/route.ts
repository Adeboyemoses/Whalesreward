import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleGiveaway } from "@/server/modules/giveaway/http";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const p = await context.params;
  return handleGiveaway(request, "prepare", p.campaignId, undefined, undefined);
}

export const POST = withOperationalTelemetry(handlePOST);
