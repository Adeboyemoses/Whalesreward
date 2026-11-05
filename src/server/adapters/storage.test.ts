import { it, expect } from "vitest";
import { createStorage } from "./storage";
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
  );
  const url = new URL(result.url);
  expect(url.hostname).toBe("fictional-evidence.fra1.digitaloceanspaces.com");
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
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
    ),
  ).toEqual(result);
  await expect(
    storage.signPut("final/fictional/object", new Date()),
  ).rejects.toThrow("Only staging");
});
it("MinIO uses local path style and remote storage requires HTTPS", async () => {
  const storage = createStorage({
    ...config,
    endpoint: "http://127.0.0.1:9000",
  });
  const { url } = await storage.signPut("staging/fictional/object", new Date());
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
