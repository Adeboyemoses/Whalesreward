import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleAdmin(request, "permissions");
}
