// Copies the pdf.js worker and the data files it fetches on demand (CMaps for CJK text, the
// standard fonts and the image-decoder wasm) from node_modules into public/pdfjs/<version>/, so
// .ai/.pdf import is served from our own origin. The version in the path keeps the worker in step
// with the pdf.js library bundled into the app, and lets the files be cached as immutable.
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const SRC = join("node_modules", "pdfjs-dist");
const { version } = JSON.parse(await readFile(join(SRC, "package.json"), "utf8"));
const ROOT = join("public", "pdfjs");
const OUT = join(ROOT, version);

await rm(ROOT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
// The legacy build: the modern one needs very recent JavaScript (Map.getOrInsertComputed).
await cp(join(SRC, "legacy", "build", "pdf.worker.min.mjs"), join(OUT, "pdf.worker.min.mjs"));
await cp(join(SRC, "LICENSE"), join(OUT, "LICENSE"));
await cp(join(SRC, "cmaps"), join(OUT, "cmaps"), { recursive: true });
await cp(join(SRC, "standard_fonts"), join(OUT, "standard_fonts"), { recursive: true });
await mkdir(join(OUT, "wasm"));
for (const f of await readdir(join(SRC, "wasm"))) {
  // QuickJS only runs PDF JavaScript, which canvas.me never does.
  if (f.startsWith("quickjs")) continue;
  await cp(join(SRC, "wasm", f), join(OUT, "wasm", f));
}
console.log(`pdfjs ${version} copied to ${OUT}`);
