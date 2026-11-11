import { afterEach, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import {
  createSaleEvidenceReader,
  EvidenceObjectMissing,
} from "./sale-evidence";

const config = {
  endpoint: "http://127.0.0.1:9000",
  region: "us-east-1",
  bucket: "fictional",
  accessKeyId: "fictional",
  secretAccessKey: "fictional",
};
afterEach(() => vi.restoreAllMocks());
// Only the provider transport is mocked: both application adapters are real.
it.each(["NoSuchKey", "NotFound"])(
  "preserves missing-object classification through both adapters for %s",
  async (name) => {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValueOnce(
      Object.assign(new Error("Provider object absent"), { name }),
    );
    const reader = createSaleEvidenceReader(config);
    await expect(reader.read("final/fixture", 1024)).rejects.toBeInstanceOf(
      EvidenceObjectMissing,
    );
  },
);
it("preserves transient failures through both adapters for retryable handling", async () => {
  const timeout = Object.assign(new Error("Provider timeout"), {
    name: "TimeoutError",
  });
  vi.spyOn(S3Client.prototype, "send").mockRejectedValueOnce(timeout);
  const reader = createSaleEvidenceReader(config);
  await expect(reader.read("final/fixture", 1024)).rejects.toBe(timeout);
});
