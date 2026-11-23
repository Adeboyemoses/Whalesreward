import { withOperationalTelemetry } from "../../../../../../../../server/modules/monitoring/telemetry";
import { handleProjection } from "../../../../../../../../server/modules/giveaway/projection-http";
async function handleGET(
  request: Request,
  context: {
    params: Promise<{ campaignId: string; reconciliationId: string }>;
  },
) {
  const p = await context.params;
  return handleProjection(request, "results", p.campaignId, p.reconciliationId);
}

export const GET = withOperationalTelemetry(handleGET);
