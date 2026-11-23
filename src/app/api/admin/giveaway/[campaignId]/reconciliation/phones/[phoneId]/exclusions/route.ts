import { withOperationalTelemetry } from "../../../../../../../../../server/modules/monitoring/telemetry";
import { handlePhones } from "../../../../../../../../../server/modules/giveaway/phone-http";
export const runtime = "nodejs";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ campaignId: string; phoneId: string }> },
) {
  const p = await context.params;
  return handlePhones(request, "propose", p.campaignId, p.phoneId);
}

export const POST = withOperationalTelemetry(handlePOST);
