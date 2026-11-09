import { handleCardsCustomers } from "../../../../server/modules/cards/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleCardsCustomers(request, "cards", "list");
}
export async function POST(request: Request) {
  return handleCardsCustomers(request, "cards", "create");
}
