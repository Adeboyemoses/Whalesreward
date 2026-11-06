import { handleStation } from "@/server/modules/station/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ attendantId: string }> },
) {
  return handleStation(
    request,
    "attendants-assignment",
    (await context.params).attendantId,
  );
}
