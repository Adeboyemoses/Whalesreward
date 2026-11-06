import { handleStation } from "@/server/modules/station/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return handleStation(request, "pumps-list");
}
export function POST(request: Request) {
  return handleStation(request, "pumps-create");
}
