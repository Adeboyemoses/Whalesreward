import { handleStation } from "@/server/modules/station/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ productCode: string }> },
) {
  return handleStation(
    request,
    "prices-history",
    (await context.params).productCode,
  );
}
