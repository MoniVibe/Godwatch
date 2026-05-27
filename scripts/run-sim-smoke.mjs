import { build } from "esbuild";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outdir = path.join(root, ".smoke");
const outfile = path.join(outdir, "sim-smoke-entry.mjs");

try {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: [path.join(root, "scripts", "sim-smoke-entry.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    sourcemap: "inline",
    logLevel: "silent"
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(outdir, { recursive: true, force: true });
}
