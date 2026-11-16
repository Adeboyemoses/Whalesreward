import { handlePhones } from "../../../../../../../../server/modules/giveaway/phone-http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ campaignId: string; checkId: string }> },
) {
  const p = await context.params;
  return handlePhones(request, "check", p.campaignId, p.checkId);
}
