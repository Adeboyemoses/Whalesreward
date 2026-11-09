import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  sign: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = mocks.send;
  },
  GetObjectCommand: class {
    constructor(readonly input: unknown) {}
  },
  HeadObjectCommand: class {
    constructor(readonly input: unknown) {}
  },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));
vi.mock("./storage", () => ({
  createStorage: mocks.create,
  storageConfig: vi.fn(),
}));
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
describe("private read-only sale evidence adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockReturnValue({ read: mocks.read });
    mocks.sign.mockResolvedValue("https://storage.example.test/signed");
  });
  it("has no upload/final-write capability and rejects non-final paths", async () => {
    const reader = createSaleEvidenceReader(config);
    expect(Object.keys(reader).sort()).toEqual([
      "available",
      "read",
      "signGet",
    ]);
    await expect(
      reader.signGet("staging/foreign", new Date(Date.now() + 60000)),
    ).rejects.toThrow("Invalid evidence path");
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("checks actual object existence and exact length before allowing issuance", async () => {
    const reader = createSaleEvidenceReader(config);
    mocks.send.mockResolvedValueOnce({ ContentLength: 400 });
    expect(await reader.available("final/asset", 400n)).toBe(true);
    mocks.send.mockResolvedValueOnce({ ContentLength: 399 });
    expect(await reader.available("final/asset", 400n)).toBe(false);
    mocks.send.mockRejectedValueOnce(
      Object.assign(new Error(), { name: "NotFound" }),
    );
    expect(await reader.available("final/asset", 400n)).toBe(false);
  });
  it("signs only GET with no-store and a server-enforced five-minute ceiling", async () => {
    const reader = createSaleEvidenceReader(config);
    await reader.signGet("final/asset", new Date(Date.now() + 60000));
    const [client, command, options] = mocks.sign.mock.calls[0]!;
    expect(client).toBeTruthy();
    expect(command.input).toMatchObject({
      Key: "final/asset",
      ResponseContentType: "image/jpeg",
      ResponseCacheControl: "no-store",
    });
    expect(options.expiresIn).toBeLessThanOrEqual(60);
    await expect(
      reader.signGet("final/asset", new Date(Date.now() + 301000)),
    ).rejects.toThrow("Invalid evidence expiry");
    await expect(
      reader.signGet("final/asset", new Date(Date.now() - 1000)),
    ).rejects.toThrow("Invalid evidence expiry");
  });
  it("preserves bounded read and exposes a safe missing-object error", async () => {
    const reader = createSaleEvidenceReader(config);
    mocks.read.mockResolvedValueOnce(Buffer.from("jpeg"));
    expect(await reader.read("final/asset", 1024)).toEqual(Buffer.from("jpeg"));
    expect(mocks.read).toHaveBeenCalledWith("final/asset", 1024);
    mocks.read.mockRejectedValueOnce(
      Object.assign(new Error(), { name: "NoSuchKey" }),
    );
    await expect(reader.read("final/asset", 1024)).rejects.toBeInstanceOf(
      EvidenceObjectMissing,
    );
  });
});
