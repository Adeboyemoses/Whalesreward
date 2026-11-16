import { handleGiveaway } from "@/server/modules/giveaway/http";
export async function GET(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const p = await context.params;
  return handleGiveaway(
    request,
    "readiness",
    p.campaignId,
    undefined,
    undefined,
  );
}
