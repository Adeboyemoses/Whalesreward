import {
  precacheAndRoute,
  matchPrecache,
  cleanupOutdatedCaches,
} from "workbox-precaching";
import { registerRoute } from "workbox-routing";
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
    try {
      return await fetch(request);
    } catch {
      const exact = await matchPrecache(url.pathname);
      if (exact) return exact;
      const shell = await matchPrecache("/attendant/sale");
      return shell ?? Response.error();
    }
  },
);
// No runtime asset/API caching, background sync, personal responses or IndexedDB deletion.
