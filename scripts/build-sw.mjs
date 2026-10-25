// Writes out/sw.js after `next build`: precaches every page, its RSC payload and
// every static asset of this build, versioned by a hash of their contents.
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const OUT = "out";
// Crawler files (robots, sitemap, llms) aren't needed offline.
const SKIP = new Set([
  "sw.js",
  "_headers",
  "404.html",
  "404.txt",
  "opengraph-image",
  "twitter-image",
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
  "llms-full.txt",
]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])),
  );
  return files.flat();
}

const files = (await walk(OUT))
  .map((f) => relative(OUT, f).split(sep).join("/"))
  // Malayalam fonts (~4 MB) are cached at runtime when a design first uses them.
  .filter((f) => !SKIP.has(f) && !f.startsWith("_not-found") && !f.startsWith("fonts/"))
  .sort();

const hash = createHash("sha256");
const urls = [];
for (const f of files) {
  hash.update(f);
  hash.update(await readFile(join(OUT, f)));
  if (f.endsWith(".html")) urls.push(f === "index.html" ? "/" : `/${f.slice(0, -".html".length)}`);
  else urls.push(`/${f}`);
}

const version = hash.digest("hex").slice(0, 12);
const template = await readFile("scripts/sw-template.js", "utf8");
await writeFile(
  join(OUT, "sw.js"),
  template.replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(urls, null, 2)),
);
console.log(`sw.js: version ${version}, ${urls.length} files precached`);
