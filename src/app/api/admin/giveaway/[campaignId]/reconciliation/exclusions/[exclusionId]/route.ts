import { withOperationalTelemetry } from "../../../../../../../../server/modules/monitoring/telemetry";
import { handlePhones } from "../../../../../../../../server/modules/giveaway/phone-http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ campaignId: string; exclusionId: string }> },
) {
  const p = await context.params;
  return handlePhones(request, "exclusion", p.campaignId, p.exclusionId);
}

export const GET = withOperationalTelemetry(handleGET);
