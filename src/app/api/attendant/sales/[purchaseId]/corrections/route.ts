import { handleCorrections } from "../../../../../../server/modules/corrections/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  const p = await context.params;
  return handleCorrections(request, "submit", p.purchaseId);
}
