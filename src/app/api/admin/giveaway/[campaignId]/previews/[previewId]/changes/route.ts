import { handleGiveaway } from "@/server/modules/giveaway/http";
export async function GET(
  request: Request,
  context: { params: Promise<{ campaignId: string; previewId: string }> },
) {
  const p = await context.params;
  return handleGiveaway(
    request,
    "history",
    p.campaignId,
    "previews",
    p.previewId,
    "changes",
  );
}
