import { handleCardsCustomers } from "../../../../../server/modules/cards/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
) {
  const params = await context.params;
  return handleCardsCustomers(
    request,
    "customers",
    "profile",
    params.customerId,
  );
}
