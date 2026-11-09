import { handleCardsCustomers } from "../../../../../../server/modules/cards/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const params = await context.params;
  return handleCardsCustomers(request, "cards", "cards", params.batchId);
}
