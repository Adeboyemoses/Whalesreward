import { handleGiveaway } from "@/server/modules/giveaway/http";
export async function POST(
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
