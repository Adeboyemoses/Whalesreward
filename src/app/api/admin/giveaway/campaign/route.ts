import { withOperationalTelemetry } from "../../../../../server/modules/monitoring/telemetry";
import { handleGiveaway } from "@/server/modules/giveaway/http";
const handleGET = (request: Request) => handleGiveaway(request, "campaign");

export const GET = withOperationalTelemetry(handleGET);
