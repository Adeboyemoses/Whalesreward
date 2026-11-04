import { build } from "esbuild";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const root = process.cwd();
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
  "/attendant/account",
  "/attendant/account/hand-over",
  "/attendant/access-expired",
];
for (const route of shellRoutes) {
  const file = path.join(root, ".next/server/app", route + ".html");
  let bytes;
  try {
    bytes = await readFile(file);
  } catch {
    throw new Error(`Missing static attendant shell: ${route}`);
  }
  manifest.push({ url: route, revision: hash(bytes) });
  discover(bytes.toString());
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
const source = (
  await readFile(path.join(root, "src/client/sw/worker.js"), "utf8")
).replace("self.__WB_MANIFEST", JSON.stringify(manifest));
await mkdir(path.join(root, "public/attendant"), { recursive: true });
const result = await build({
  stdin: { contents: source, resolveDir: root, loader: "js" },
  bundle: true,
  minify: true,
  write: false,
  target: "es2022",
  define: { "process.env.NODE_ENV": '"production"' },
});
await writeFile(
  path.join(root, "public/attendant/sw.js"),
  result.outputFiles[0].contents,
);
console.log(
  `Built attendant Workbox worker with ${manifest.length} generic shells/static assets.`,
);
