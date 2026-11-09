import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
export async function collectPrecacheManifest(root) {
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return (
      await Promise.all(
        entries.map(async (entry) =>
          entry.isDirectory()
            ? walk(path.join(dir, entry.name))
            : path.join(dir, entry.name),
        ),
      )
    ).flat();
  }
  const manifest = [];
  const hash = (bytes) =>
    createHash("sha256").update(bytes).digest("hex").slice(0, 20);
  const assets = new Set();
  const pending = [];
  function discover(text) {
    for (const match of text.matchAll(
      /(?:\/_next\/)?static\/([^\s"\'<>\\)]+\.(?:js|css|woff2?))/g,
    )) {
      const relative = match[1];
      if (!relative.includes("..") && !assets.has(relative)) {
        assets.add(relative);
        pending.push(relative);
      }
    }
  }
  const shellRoutes = [
    "/attendant/sign-in",
    "/attendant/sale",
    "/attendant/register",
    "/attendant/account",
    "/attendant/account/hand-over",
    "/attendant/access-expired",
  ];
  const buildId = (
    await readFile(path.join(root, ".next/BUILD_ID"), "utf8")
  ).trim();
  if (!buildId) throw new Error("The production build ID is missing");
  for (const route of shellRoutes) {
    // The runtime staging banner makes the root layout dynamic. These fixed routes
    // still render generic client shells; fetch them at SW installation so the
    // environment banner survives, and discover only their build-time dependencies.
    const page = path.join(
      root,
      ".next/server/app/(attendant)",
      route.slice(1),
    );
    const [references, bootstrap] = await Promise.all([
      readFile(path.join(page, "page_client-reference-manifest.js"), "utf8"),
      readFile(path.join(page, "page/build-manifest.json"), "utf8"),
    ]);
    manifest.push({ url: route, revision: buildId });
    discover(references);
    discover(bootstrap);
  }
  while (pending.length) {
    const relative = pending.shift();
    const bytes = await readFile(path.join(root, ".next/static", relative));
    manifest.push({ url: "/_next/static/" + relative, revision: hash(bytes) });
    if (/\.(js|css)$/.test(relative)) {
      discover(bytes.toString());
      // CSS self-hosted font URLs are relative to static/chunks or static/css.
      for (const match of bytes
        .toString()
        .matchAll(/url\(["']?(\.\.\/[^"')]+\.woff2?)["']?\)/g)) {
        const font = path.posix.normalize(
          path.posix.join(path.posix.dirname(relative), match[1]),
        );
        if (!font.startsWith("..") && !assets.has(font)) {
          assets.add(font);
          pending.push(font);
        }
      }
    }
  }
  for (const relative of [
    "attendant/manifest.webmanifest",
    "design-system/mark.svg",
  ]) {
    const bytes = await readFile(path.join(root, "public", relative));
    manifest.push({ url: "/" + relative, revision: hash(bytes) });
  }
  for (const file of await walk(path.join(root, "public/fonts"))) {
    if (/\.woff2?$/.test(file))
      manifest.push({
        url:
          "/fonts/" +
          path
            .relative(path.join(root, "public/fonts"), file)
            .split(path.sep)
            .join("/"),
        revision: hash(await readFile(file)),
      });
  }
  return manifest;
}
