import { afterEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ send: vi.fn(), client: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(config: unknown) {
      fake.client(config);
    }
    send(...args: unknown[]) {
      return fake.send(...args);
    }
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));
import { createCardArtifactStorage } from "./card-artifacts";
const config = {
  endpoint: "http://127.0.0.1:9000",
  region: "test",
  bucket: "fictional",
  accessKeyId: "fictional-key",
  secretAccessKey: "fictional-secret",
};
afterEach(() => vi.clearAllMocks());
it("writes private random keys with the renderer content type and no signing API", async () => {
  const storage = createCardArtifactStorage(config),
    bytes = new Uint8Array([1, 2]);
  fake.send.mockResolvedValue({});
  await storage.write("final/card-exports/abc123", bytes, "application/pdf");
  expect(fake.send.mock.calls[0]?.[0].input).toEqual({
    Bucket: "fictional",
    Key: "final/card-exports/abc123",
    Body: bytes,
    ContentType: "application/pdf",
  });
  expect(storage).not.toHaveProperty("signPut");
  await expect(
    storage.write("staging/abc123", bytes, "application/pdf"),
  ).rejects.toThrow();
  await expect(storage.read("final/../../customer", 100)).rejects.toThrow();
  expect(fake.client).toHaveBeenCalledWith(
    expect.objectContaining({ forcePathStyle: true }),
  );
});
it("bounds declared and streamed bytes and destroys streams on both failure and success", async () => {
  const storage = createCardArtifactStorage(config),
    destroy = vi.fn();
  const stream = () => ({
    async *[Symbol.asyncIterator]() {
      yield new Uint8Array([1, 2]);
      yield new Uint8Array([3, 4]);
    },
    destroy,
  });
  fake.send.mockResolvedValueOnce({ Body: stream(), ContentLength: 100 });
  await expect(storage.read("final/card-exports/abc123", 3)).rejects.toThrow(
    "too large",
  );
  expect(destroy).toHaveBeenCalledTimes(1);
  fake.send.mockResolvedValueOnce({ Body: stream() });
  await expect(storage.read("final/card-exports/abc123", 3)).rejects.toThrow(
    "too large",
  );
  expect(destroy).toHaveBeenCalledTimes(2);
  fake.send.mockResolvedValueOnce({ Body: stream() });
  expect(await storage.read("final/card-exports/abc123", 4)).toEqual(
    Buffer.from([1, 2, 3, 4]),
  );
  expect(destroy).toHaveBeenCalledTimes(3);
});
it.each([
  "http://remote.example.test",
  "https://name:pass@remote.example.test",
  "https://remote.example.test/path",
  "https://remote.example.test/?query=1",
  "https://remote.example.test/#fragment",
])("rejects invalid endpoints %s", (endpoint) => {
  expect(() => createCardArtifactStorage({ ...config, endpoint })).toThrow();
});
it("bounds a hung response body even when the stream ignores abort and destroys it", async () => {
  vi.useFakeTimers();
  const destroy = vi.fn();
  fake.send.mockResolvedValue({
    Body: {
      destroy,
      [Symbol.asyncIterator]() {
        return { next: () => new Promise(() => {}) };
      },
    },
  });
  try {
    const outcome = createCardArtifactStorage(config)
      .read("final/card-exports/abc123", 100)
      .catch((error) => error.code);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await outcome).toBe("temporarily_unavailable");
    expect(destroy).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it("bounds a hung write even when transport ignores abort", async () => {
  vi.useFakeTimers();
  fake.send.mockImplementation(() => new Promise(() => {}));
  try {
    const outcome = createCardArtifactStorage(config)
      .write(
        "final/card-exports/abc123",
        new Uint8Array([1]),
        "application/pdf",
      )
      .catch((error) => error.code);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await outcome).toBe("temporarily_unavailable");
  } finally {
    vi.useRealTimers();
  }
});
