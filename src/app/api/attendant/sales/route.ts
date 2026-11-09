import { handleSalesRead } from "../../../../server/modules/sales/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleSalesRead(request, "attendant", "list");
}
