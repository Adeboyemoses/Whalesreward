import { handleHeldRelease } from "../../../../../../../server/modules/reviews/release-http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ purchaseId: string; proposalId: string }> },
) {
  const p = await context.params;
  return handleHeldRelease(request, "get", p.purchaseId, p.proposalId);
}
