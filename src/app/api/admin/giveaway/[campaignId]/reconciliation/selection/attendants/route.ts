import { handleProjection } from "@/server/modules/giveaway/projection-http";
export async function GET(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const p = await context.params;
  return handleProjection(request, "attendants", p.campaignId);
}
