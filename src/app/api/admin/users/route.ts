import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleAdmin(request, "users-create");
}
