import { handleReports } from "@/server/modules/reports/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleReports(request, "overview");
}
