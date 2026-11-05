import {
  precacheAndRoute,
  matchPrecache,
  cleanupOutdatedCaches,
} from "workbox-precaching";
import { registerRoute } from "workbox-routing";
const NAVIGATION_TIMEOUT_MS = 1200;
// Replaced at build time from fixed generic attendant routes and their asset manifests only.
precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [] });
cleanupOutdatedCaches();
registerRoute(
  ({ request, url }) =>
    request.mode === "navigate" &&
    url.origin === self.location.origin &&
    url.pathname.startsWith("/attendant/") &&
    !url.pathname.startsWith("/attendant/register"),
  async ({ request, url }) => {
    const controller = new AbortController();
    let timer;
    try {
      const network = (async () => {
        const response = await fetch(request, {
          signal: AbortSignal.any([request.signal, controller.signal]),
        });
        // A half-delivered HTML body can hang just as long as its headers.
        await response.clone().arrayBuffer();
        return response;
      })();
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Navigation deadline reached"));
        }, NAVIGATION_TIMEOUT_MS);
      });
      return await Promise.race([network, deadline]);
    } catch {
      const exact = await matchPrecache(url.pathname);
      if (exact) return exact;
      const shell = await matchPrecache("/attendant/sale");
      return shell ?? Response.error();
    } finally {
      clearTimeout(timer);
    }
  },
);
// No runtime asset/API caching, background sync, personal responses or IndexedDB deletion.
