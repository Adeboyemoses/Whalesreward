import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectPrecacheManifest } from "./manifest.mjs";
const root = process.cwd();
const manifest = await collectPrecacheManifest(root);
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
