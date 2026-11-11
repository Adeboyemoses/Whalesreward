import { it, expect, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { createStorage, StorageNotFoundError } from "./storage";
const config = {
  region: "fra1",
  bucket: "fictional-evidence",
  accessKeyId: "fictional-key",
  secretAccessKey: "fictional-secret",
};
it("Spaces signs private virtual-hosted JPEG PUT with only Content-Type CORS header", async () => {
  const storage = createStorage({
    ...config,
    endpoint: "https://fra1.digitaloceanspaces.com",
  });
  const result = await storage.signPut(
    "staging/fictional/object",
    new Date("2026-11-05T01:05:00Z"),
    4096,
  );
  const url = new URL(result.url);
  expect(url.hostname).toBe("fictional-evidence.fra1.digitaloceanspaces.com");
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
    "content-length;content-type;host",
  );
  expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  expect(url.searchParams.get("X-Amz-Date")).toBe("20261105T010000Z");
  expect(
    [...url.searchParams.keys()].some((k) =>
      k.toLowerCase().includes("checksum"),
    ),
  ).toBe(false);
  expect(result.headers).toEqual({ "Content-Type": "image/jpeg" });
  expect(
    await storage.signPut(
      "staging/fictional/object",
      new Date("2026-11-05T01:05:00Z"),
      4096,
    ),
  ).toEqual(result);
  await expect(
    storage.signPut("final/fictional/object", new Date(), 4096),
  ).rejects.toThrow("Only staging");
});
it("MinIO uses local path style and remote storage requires HTTPS", async () => {
  const storage = createStorage({
    ...config,
    endpoint: "http://127.0.0.1:9000",
  });
  const { url } = await storage.signPut(
    "staging/fictional/object",
    new Date(),
    4096,
  );
  expect(new URL(url).pathname).toBe(
    "/fictional-evidence/staging/fictional/object",
  );
  expect(() =>
    createStorage({
      ...config,
      endpoint: "http://fra1.digitaloceanspaces.com",
    }),
  ).toThrow();
});

it.each(["NoSuchKey", "NotFound"])(
  "maps definitive provider %s to a typed missing object",
  async (name) => {
    const failure = Object.assign(new Error("provider detail"), { name });
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockRejectedValueOnce(failure);
    try {
      const storage = createStorage({
        ...config,
        endpoint: "http://127.0.0.1:9000",
      });
      await expect(
        storage.read("final/fictional/object", 4096),
      ).rejects.toBeInstanceOf(StorageNotFoundError);
    } finally {
      send.mockRestore();
    }
  },
);
it("preserves timeout failures for retryable service classification", async () => {
  const failure = Object.assign(new Error("provider timeout"), {
    name: "TimeoutError",
  });
  const send = vi
    .spyOn(S3Client.prototype, "send")
    .mockRejectedValueOnce(failure);
  try {
    const storage = createStorage({
      ...config,
      endpoint: "http://127.0.0.1:9000",
    });
    await expect(storage.read("final/fictional/object", 4096)).rejects.toBe(
      failure,
    );
  } finally {
    send.mockRestore();
  }
});
