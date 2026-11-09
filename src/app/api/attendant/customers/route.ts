import { handleCardsCustomers } from "../../../../server/modules/cards/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleCardsCustomers(request, "customers", "register");
}
