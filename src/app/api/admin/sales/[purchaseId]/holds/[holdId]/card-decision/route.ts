import { handleReviews } from "../../../../../../../../server/modules/reviews/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ purchaseId: string; holdId: string }> },
) {
  const p = await context.params;
  return handleReviews(request, "card", p.purchaseId, p.holdId);
}
