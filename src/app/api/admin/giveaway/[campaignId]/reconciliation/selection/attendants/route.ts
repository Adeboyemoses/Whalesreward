import { withOperationalTelemetry } from "../../../../../../../../server/modules/monitoring/telemetry";
import { handleProjection } from "../../../../../../../../server/modules/giveaway/projection-http";
async function handleGET(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const p = await context.params;
  return handleProjection(request, "attendants", p.campaignId);
}

export const GET = withOperationalTelemetry(handleGET);
