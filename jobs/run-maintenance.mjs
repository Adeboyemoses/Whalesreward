import { existsSync } from "node:fs";

const job = process.argv[2];
if (job !== "orphans" && job !== "reconcile-uploads")
  throw new Error("Unsupported maintenance command");
// Local development uses the reviewed TypeScript sources. The application image
// contains bundled ESM entrypoints instead of the source tree.
const source = new URL(`./${job}.ts`, import.meta.url);
await import(
  existsSync(source)
    ? source.href
    : new URL(`./${job}.mjs`, import.meta.url).href
);
