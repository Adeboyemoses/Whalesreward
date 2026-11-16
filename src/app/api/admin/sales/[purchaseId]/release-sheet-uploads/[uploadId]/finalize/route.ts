import { handleReleaseUpload } from "@/server/modules/reviews/release-upload-http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ purchaseId: string; uploadId?: string }> },
) {
  const { purchaseId, uploadId } = await context.params;
  return handleReleaseUpload(request, purchaseId, "finalize", uploadId);
}
