import { handleGiveaway } from "@/server/modules/giveaway/http";
export async function GET(
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
