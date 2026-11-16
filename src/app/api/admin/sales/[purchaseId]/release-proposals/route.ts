import { handleHeldRelease } from "../../../../../../server/modules/reviews/release-http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  const p = await context.params;
  return handleHeldRelease(request, "propose", p.purchaseId);
}
export async function GET(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  const p = await context.params;
  return handleHeldRelease(request, "list", p.purchaseId);
}
