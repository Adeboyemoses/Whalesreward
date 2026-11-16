import { handleHeldRelease } from "../../../../../../../../server/modules/reviews/release-http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ purchaseId: string; proposalId: string }> },
) {
  const p = await context.params;
  return handleHeldRelease(request, "decide", p.purchaseId, p.proposalId);
}
