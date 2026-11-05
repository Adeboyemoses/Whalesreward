import { createServer as httpServer } from "node:http";
import { createServer as tcpServer, connect } from "node:net";
import { test, expect } from "@playwright/test";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { createStorage } from "../../src/server/adapters/storage";
import { newId } from "../../src/server/lib/ids";

test("browser Blob PUT supplies signed length automatically with Content-Type-only CORS", async ({
  page,
}) => {
  // Docker Desktop's Linux browser reaches the local-only fixture through this
  // optional test TCP forwarder, never through a production endpoint override.
  const forwardHost = process.env.WHR_TEST_STORAGE_FORWARD_HOST;
  const proxy = forwardHost
    ? tcpServer((socket) => {
        const upstream = connect(9000, forwardHost);
        socket.pipe(upstream);
        upstream.pipe(socket);
        socket.on("error", () => upstream.destroy());
        upstream.on("error", () => socket.destroy());
      })
    : null;
  if (proxy)
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const proxyAddress = proxy?.address();
  const endpoint =
    proxyAddress && typeof proxyAddress !== "string"
      ? `http://127.0.0.1:${proxyAddress.port}`
      : "http://127.0.0.1:9000";
  const bucket = `browser-${newId()}`;
  const config = {
    endpoint,
    region: "us-east-1",
    bucket,
    accessKeyId: "whr-local",
    secretAccessKey: "local-development-only",
    forcePathStyle: true,
  };
  const client = new S3Client({
    endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
  const site = httpServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><title>Fictional storage test</title>");
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    const storage = createStorage(config),
      bytes = Buffer.from("fictional exact-length browser upload");
    const permission = await storage.signPut(
      `staging/${newId()}/${newId()}`,
      new Date(Date.now() + 300000),
      bytes.length,
    );
    expect(Object.keys(permission.headers).map((x) => x.toLowerCase())).toEqual(
      ["content-type"],
    );
    const address = site.address();
    if (!address || typeof address === "string")
      throw new Error("Test listener unavailable");
    await page.goto(`http://127.0.0.1:${address.port}`);
    const result = await page.evaluate(
      async (input) => {
        const send = async (length: number) => {
          const blob = new Blob([new Uint8Array(length)], {
            type: "image/jpeg",
          });
          const response = await fetch(input.url, {
            method: "PUT",
            headers: input.headers,
            body: blob,
          });
          return response.status;
        };
        return {
          exact: await send(input.bytes),
          wrong: await send(input.bytes + 1),
        };
      },
      { ...permission, bytes: bytes.length },
    );
    expect(result).toEqual({ exact: 200, wrong: 403 });
  } finally {
    client.destroy();
    site.closeAllConnections();
    await new Promise<void>((resolve) => site.close(() => resolve()));
    proxy?.close();
  }
});
