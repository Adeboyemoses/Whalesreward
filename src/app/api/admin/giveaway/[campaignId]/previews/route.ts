import { handleGiveaway } from "@/server/modules/giveaway/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const p = await context.params;
  return handleGiveaway(request, "prepare", p.campaignId, undefined, undefined);
}
