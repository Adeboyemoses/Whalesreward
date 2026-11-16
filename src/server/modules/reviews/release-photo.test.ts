import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareReleaseSheet } from "./release-photo";
import {
  StorageNotFoundError,
  type EvidenceStorage,
} from "../../adapters/storage";
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function fixture() {
  const bytes = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "white" },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Artist: "Fictional private source" } } })
    .toBuffer();
  const objects = new Map([["staging", bytes]]);
  const storage: EvidenceStorage = {
    async signPut(key) {
      return { url: key, headers: {} };
    },
    async read(key) {
      const b = objects.get(key);
      if (!b) throw new StorageNotFoundError();
      return b;
    },
    async writeFinal(key, b) {
      objects.set(key, Buffer.from(b));
    },
  };
  return {
    bytes,
    objects,
    storage,
    reservation: {
      stagingKey: "staging",
      digest: digest(bytes),
      bytes: bytes.length,
    },
  };
}
describe("held sheet private evidence pipeline", () => {
  it("SR-04 retains validated source, strips display metadata and resists later staging overwrite", async () => {
    const f = await fixture();
    const result = await prepareReleaseSheet(f.storage, f.reservation, "test");
    expect(result.finalKey).toMatch(/^final\/test\/held_release_sheet\//);
    expect(result.displayKey).not.toBe(result.finalKey);
    expect(
      await sharp(f.objects.get(result.displayKey)!).metadata(),
    ).not.toHaveProperty("exif");
    f.objects.set("staging", Buffer.from("replaced after validation"));
    expect(digest(f.objects.get(result.finalKey)!)).toBe(f.reservation.digest);
  });
  it("SR-04 digest mismatch and undecodable source never create final evidence", async () => {
    const f = await fixture();
    await expect(
      prepareReleaseSheet(
        f.storage,
        { ...f.reservation, digest: "0".repeat(64) },
        "test",
      ),
    ).rejects.toMatchObject({ code: "photo_invalid", status: 422 });
    const bad = Buffer.from("not a JPEG");
    f.objects.set("staging", bad);
    await expect(
      prepareReleaseSheet(
        f.storage,
        { ...f.reservation, digest: digest(bad), bytes: bad.length },
        "test",
      ),
    ).rejects.toMatchObject({ code: "photo_invalid", status: 422 });
    expect(f.objects.size).toBe(1);
  });
  it("SR-04 missing and transient storage failures stay distinguishable", async () => {
    const f = await fixture();
    f.objects.clear();
    await expect(
      prepareReleaseSheet(f.storage, f.reservation, "test"),
    ).rejects.toMatchObject({ code: "evidence_pending", status: 409 });
    f.storage.read = async () => {
      throw new Error("transient provider failure");
    };
    await expect(
      prepareReleaseSheet(f.storage, f.reservation, "test"),
    ).rejects.toMatchObject({ code: "storage_unavailable", status: 503 });
  });
});
