import { handleAudit } from "../../../../../server/modules/audit/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  return handleAudit(request, "detail", (await params).eventId);
}
