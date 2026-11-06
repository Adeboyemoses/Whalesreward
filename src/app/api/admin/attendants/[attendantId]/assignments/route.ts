import { handleStation } from "@/server/modules/station/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ attendantId: string }> },
) {
  return handleStation(
    request,
    "attendants-assignments",
    (await context.params).attendantId,
  );
}
