import { handleReports } from "@/server/modules/reports/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ exportId: string }> },
) {
  return handleReports(request, "status", (await context.params).exportId);
}
