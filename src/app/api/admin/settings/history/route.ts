import { handleSettings } from "../../../../../server/modules/settings/http";
export const runtime = "nodejs";
export const GET = (request: Request) => handleSettings(request, "history");
