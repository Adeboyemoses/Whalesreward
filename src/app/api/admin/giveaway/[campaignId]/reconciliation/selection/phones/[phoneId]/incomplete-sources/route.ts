import { handleProjection } from "../../../../../../../../../../server/modules/giveaway/projection-http";
export async function GET(
  request: Request,
  context: { params: Promise<{ campaignId: string; phoneId: string }> },
) {
  const p = await context.params;
  return handleProjection(
    request,
    "incomplete-sources",
    p.campaignId,
    p.phoneId,
  );
}
