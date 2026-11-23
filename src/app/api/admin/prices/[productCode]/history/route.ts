import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleStation } from "@/server/modules/station/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(
  request: Request,
  context: { params: Promise<{ productCode: string }> },
) {
  return handleStation(
    request,
    "prices-history",
    (await context.params).productCode,
  );
}

export const GET = withOperationalTelemetry(handleGET);
