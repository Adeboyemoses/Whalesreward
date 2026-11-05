import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ adminId: string }> },
) {
  return handleAdmin(
    request,
    "verification-requests",
    (await context.params).adminId,
  );
}
