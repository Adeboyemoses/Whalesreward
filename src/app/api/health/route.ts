import { healthResponse } from "@/server/modules/health/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return healthResponse(request);
}
