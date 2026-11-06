import { handleStation } from "@/server/modules/station/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ pumpId: string }> },
) {
  return handleStation(request, "pumps-get", (await context.params).pumpId);
}
