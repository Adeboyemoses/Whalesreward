import { handleGiveaway } from "@/server/modules/giveaway/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const p = await context.params;
  return handleGiveaway(request, "confirm", p.campaignId, undefined, undefined);
}
export async function GET(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const p = await context.params;
  return handleGiveaway(request, "history", p.campaignId, "snapshots");
}
