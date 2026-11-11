import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectPrecacheManifest } from "./manifest.mjs";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots.length = 0;
});
async function write(root: string, name: string, text: string) {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}
describe("attendant precache build inputs", () => {
  it("collects dynamic generic shell dependencies without requiring static HTML or adding admin chunks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "whales-precache-"));
    roots.push(root);
    await write(root, ".next/BUILD_ID", "fixture-build\n");
    for (const route of [
      "sign-in",
      "sale",
      "register",
      "history",
      "account",
      "account/hand-over",
      "access-expired",
    ]) {
      const location = ".next/server/app/(attendant)/attendant/" + route;
      await write(
        root,
        location + "/page_client-reference-manifest.js",
        'globalThis.__RSC_MANIFEST={clientModules:{runtime:{chunks:["/_next/static/chunks/attendant.js"]}},entryCSSFiles:{layout:[{path:"static/chunks/shell.css"}]},ssrModuleMapping:{chunks:["server/chunks/private.js"]}};',
      );
      await write(
        root,
        location + "/page/build-manifest.json",
        JSON.stringify({
          rootMainFiles: ["static/chunks/runtime.js"],
          polyfillFiles: ["static/chunks/polyfill.js"],
        }),
      );
    }
    await write(
      root,
      ".next/static/chunks/attendant.js",
      'const dependency="static/chunks/photo.js";',
    );
    await write(
      root,
      ".next/static/chunks/photo.js",
      "/* generic camera code */",
    );
    await write(
      root,
      ".next/static/chunks/runtime.js",
      "/* shared bootstrap */",
    );
    await write(
      root,
      ".next/static/chunks/polyfill.js",
      "/* browser compatibility */",
    );
    await write(
      root,
      ".next/static/chunks/shell.css",
      "@font-face {src:url(../media/shell.woff2)}",
    );
    await write(root, ".next/static/media/shell.woff2", "font");
    await write(
      root,
      ".next/static/chunks/admin.js",
      "/* must not enter attendant cache */",
    );
    await write(
      root,
      ".next/server/app/(admin)/admin/page_client-reference-manifest.js",
      'const privateAsset="static/chunks/admin.js";',
    );
    await write(root, "public/attendant/manifest.webmanifest", "{}");
    await write(root, "public/design-system/mark.svg", "<svg/>");
    const manifest = await collectPrecacheManifest(root);
    expect(
      manifest.filter(
        (entry) =>
          entry.url.startsWith("/attendant/") &&
          !entry.url.endsWith(".webmanifest"),
      ),
    ).toEqual([
      { url: "/attendant/sign-in", revision: "fixture-build" },
      { url: "/attendant/sale", revision: "fixture-build" },
      { url: "/attendant/register", revision: "fixture-build" },
      { url: "/attendant/history", revision: "fixture-build" },
      { url: "/attendant/account", revision: "fixture-build" },
      { url: "/attendant/account/hand-over", revision: "fixture-build" },
      { url: "/attendant/access-expired", revision: "fixture-build" },
    ]);
    const urls = manifest.map((entry) => entry.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        "/_next/static/chunks/attendant.js",
        "/_next/static/chunks/runtime.js",
        "/_next/static/chunks/polyfill.js",
        "/_next/static/chunks/photo.js",
        "/_next/static/chunks/shell.css",
        "/_next/static/media/shell.woff2",
      ]),
    );
    expect(urls).not.toContain("/_next/static/chunks/admin.js");
    expect(urls.some((url) => /^\/(?:api|admin|server)\//.test(url))).toBe(
      false,
    );
    expect(new Set(urls).size).toBe(urls.length);
  });
});
