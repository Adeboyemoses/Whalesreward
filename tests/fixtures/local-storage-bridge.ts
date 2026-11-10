import type { Page } from "@playwright/test";

/**
 * Compose MinIO serves HTTP; production upload permissions must remain HTTPS.
 * This browser-test-only bridge rewrites only the known loopback transport and
 * forwards the real signed PUT bytes to the real MinIO service. Issuance,
 * evidence validation and purchase finalization still run in the real server.
 * The calling test must disable traces, screenshots and video.
 */
export async function installLocalStorageBridge(page: Page) {
  await page.route(
    /\/api\/sync\/sales\/[^/]+\/upload-permission$/,
    async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      if (response.status() !== 200) return route.fulfill({ response });
      const json = await response.json();
      const url = new URL(json.data.url);
      if (
        url.protocol !== "http:" ||
        url.hostname !== "127.0.0.1" ||
        url.port !== "9000" ||
        url.username ||
        url.password
      )
        throw new Error("Local storage bridge received an unexpected endpoint");
      url.protocol = "https:";
      json.data.url = url.href;
      await route.fulfill({ response, json });
    },
  );
  await page.route("https://127.0.0.1:9000/**", async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": "http://127.0.0.1:3000",
      "access-control-allow-methods": "PUT, OPTIONS",
      "access-control-allow-headers": "content-type",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (request.method() !== "PUT") return route.abort("blockedbyclient");
    const url = new URL(request.url());
    url.protocol = "http:";
    const response = await route.fetch({ url: url.href, maxRedirects: 0 });
    await route.fulfill({
      response,
      headers: { ...response.headers(), ...headers },
    });
  });
}
