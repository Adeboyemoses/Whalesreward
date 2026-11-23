import { withOperationalTelemetry } from "../../../../../../../../server/modules/monitoring/telemetry";
import { handleGiveaway } from "@/server/modules/giveaway/http";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ campaignId: string; snapshotId: string }> },
) {
  const p = await context.params;
  return handleGiveaway(
    request,
    "confirm",
    p.campaignId,
    undefined,
    p.snapshotId,
  );
}

export const POST = withOperationalTelemetry(handlePOST);
