import { handleSalesRead } from "../../../../../../server/modules/sales/http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  const { purchaseId } = await context.params;
  return handleSalesRead(request, "admin", "photo-access", purchaseId);
}
