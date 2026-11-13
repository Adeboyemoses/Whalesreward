import { handleReports } from "@/server/modules/reports/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleReports(request, "sources");
}
