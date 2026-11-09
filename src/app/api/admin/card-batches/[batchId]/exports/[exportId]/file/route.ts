import { handleCardsCustomers } from "../../../../../../../../server/modules/cards/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ batchId: string; exportId: string }> },
) {
  const params = await context.params;
  return handleCardsCustomers(
    request,
    "cards",
    "file",
    params.batchId,
    params.exportId,
  );
}
