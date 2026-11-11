import { handleReviews } from "../../../../../../server/modules/reviews/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ flagId: string }> },
) {
  const p = await context.params;
  return handleReviews(request, "duplicate", p.flagId);
}
