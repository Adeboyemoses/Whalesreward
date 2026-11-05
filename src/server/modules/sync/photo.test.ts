import { createHash } from "node:crypto";
import sharp from "sharp";
import { it, expect } from "vitest";
import { validatePhoto } from "./photo";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
it("I-25 requires a fully decodable JPEG and exact digest and length", async () => {
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  expect(await validatePhoto(bytes, sha(bytes), bytes.length)).toMatchObject({
    width: 2,
    height: 2,
    digest: sha(bytes),
    bytes: bytes.length,
  });
  await expect(
    validatePhoto(bytes, "a".repeat(64), bytes.length),
  ).rejects.toMatchObject({ code: "photo_invalid", reason: "digest_mismatch" });
  await expect(
    validatePhoto(bytes, sha(bytes), bytes.length + 1),
  ).rejects.toMatchObject({ reason: "size_exceeded" });
  const bad = Buffer.from("not a photo");
  await expect(validatePhoto(bad, sha(bad), bad.length)).rejects.toMatchObject({
    reason: "decode_failed",
  });
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await expect(validatePhoto(png, sha(png), png.length)).rejects.toMatchObject({
    reason: "type_invalid",
  });
  const truncated = bytes.subarray(0, bytes.length - 20);
  await expect(
    validatePhoto(truncated, sha(truncated), truncated.length),
  ).rejects.toMatchObject({ reason: "decode_failed" });
});
it("I-25 rejects a decoded dimension above 6000 pixels", async () => {
  const b = await sharp({
    create: { width: 6001, height: 1, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  await expect(validatePhoto(b, sha(b), b.length)).rejects.toMatchObject({
    reason: "size_exceeded",
  });
});
