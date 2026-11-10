import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import { createCardArtifactStorage } from "./card-artifacts";

it("WHR-97 bounds a real HTTP storage response that sends headers then never completes its body", async () => {
  let closed = false;
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": "2",
    });
    response.write(Buffer.from([1]));
    response.on("close", () => {
      closed = true;
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No local listener");
  const storage = createCardArtifactStorage({
    endpoint: `http://127.0.0.1:${address.port}`,
    region: "test",
    bucket: "fictional",
    accessKeyId: "fixture",
    secretAccessKey: "fixture",
  });
  try {
    await expect(
      storage.read("final/card-exports/abc123", 10),
    ).rejects.toMatchObject({ code: "temporarily_unavailable" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(true);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}, 10000);
