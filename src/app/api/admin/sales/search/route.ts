import { handleSalesRead } from "../../../../../server/modules/sales/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleSalesRead(request, "admin", "search");
}
