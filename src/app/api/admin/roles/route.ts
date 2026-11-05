import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleAdmin(request, "roles-list");
}
export async function POST(request: Request) {
  return handleAdmin(request, "roles-create");
}
