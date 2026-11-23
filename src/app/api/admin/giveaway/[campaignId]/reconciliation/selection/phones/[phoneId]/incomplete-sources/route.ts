import { withOperationalTelemetry } from "../../../../../../../../../../server/modules/monitoring/telemetry";
import { handleProjection } from "../../../../../../../../../../server/modules/giveaway/projection-http";
async function handleGET(
  request: Request,
  context: { params: Promise<{ campaignId: string; phoneId: string }> },
) {
  const p = await context.params;
  return handleProjection(
    request,
    "incomplete-sources",
    p.campaignId,
    p.phoneId,
  );
}

export const GET = withOperationalTelemetry(handleGET);
