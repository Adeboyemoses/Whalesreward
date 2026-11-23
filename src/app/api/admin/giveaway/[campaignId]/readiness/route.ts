import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleGiveaway } from "@/server/modules/giveaway/http";
async function handleGET(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const p = await context.params;
  return handleGiveaway(
    request,
    "readiness",
    p.campaignId,
    undefined,
    undefined,
  );
}

export const GET = withOperationalTelemetry(handleGET);
