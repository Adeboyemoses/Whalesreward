import { handleStation } from "@/server/modules/station/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return handleStation(request, "attendants-create");
}
