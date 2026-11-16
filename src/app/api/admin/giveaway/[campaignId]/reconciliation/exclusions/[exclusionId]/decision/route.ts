import { handlePhones } from "../../../../../../../../../server/modules/giveaway/phone-http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ campaignId: string; exclusionId: string }> },
) {
  const p = await context.params;
  return handlePhones(request, "decide", p.campaignId, p.exclusionId);
}
