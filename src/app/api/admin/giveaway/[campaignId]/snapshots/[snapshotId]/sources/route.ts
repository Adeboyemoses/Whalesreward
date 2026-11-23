import { withOperationalTelemetry } from "../../../../../../../../server/modules/monitoring/telemetry";
import { handleGiveaway } from "@/server/modules/giveaway/http";
async function handleGET(
  request: Request,
  context: { params: Promise<{ campaignId: string; snapshotId: string }> },
) {
  const p = await context.params;
  return handleGiveaway(
    request,
    "history",
    p.campaignId,
    "snapshots",
    p.snapshotId,
    "sources",
  );
}

export const GET = withOperationalTelemetry(handleGET);
