import { withOperationalTelemetry } from "../../../../../../../server/modules/monitoring/telemetry";
import { handlePhones } from "../../../../../../../server/modules/giveaway/phone-http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const p = await context.params;
  return handlePhones(request, "phones", p.campaignId);
}

export const GET = withOperationalTelemetry(handleGET);
