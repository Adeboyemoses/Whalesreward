import { handleCorrections } from "../../../../../../../../server/modules/corrections/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ purchaseId: string; correctionId: string }> },
) {
  const p = await context.params;
  return handleCorrections(request, "decide", p.purchaseId, p.correctionId);
}
