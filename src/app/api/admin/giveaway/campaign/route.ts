import { handleGiveaway } from "@/server/modules/giveaway/http";
export const GET = (request: Request) => handleGiveaway(request, "campaign");
