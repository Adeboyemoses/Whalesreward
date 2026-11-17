import { handleProjection } from "@/server/modules/giveaway/projection-http";
export async function GET(
  request: Request,
  context: {
    params: Promise<{ campaignId: string; reconciliationId: string }>;
  },
) {
  const p = await context.params;
  return handleProjection(request, "results", p.campaignId, p.reconciliationId);
}
