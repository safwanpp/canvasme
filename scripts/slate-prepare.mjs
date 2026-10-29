// Prepares the static export in `out/` for Zoho Catalyst Slate (run after `npm run build`).
// Slate ignores `_redirects` and `[[redirects]]` rewrites, does not map `/features` to
// `features.html`, and 404s extensionless files. So, in `out/` only (Cloudflare Pages is unaffected):
//   - copy each `X.html` to `X/index.html` so clean URLs resolve,
//   - copy extensionless metadata images (apple-icon, opengraph-image, ...) to `.png` and point the
//     HTML and the service worker's precache list at the `.png` copies,
//   - write `.catalyst/slate-config.toml`.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const out = join(process.cwd(), "out");
const htmlFiles = [];
const images = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(out, full).split("\\").join("/");
    if (statSync(full).isDirectory()) {
      if (!["_next", ".catalyst"].includes(rel)) walk(full);
    } else if (name.endsWith(".html")) {
      htmlFiles.push(full);
    } else if (dir === out && !name.includes(".") && !name.startsWith("_")) {
      images.push(name);
    }
  }
}

walk(out);

for (const name of images) copyFileSync(join(out, name), join(out, name + ".png"));
const imageRef = new RegExp(`/(${images.join("|")})(?=[?"])`, "g");

// The service worker precaches with cache.addAll, so one 404 (e.g. `/apple-icon`) fails install.
const sw = join(out, "sw.js");
if (images.length) writeFileSync(sw, readFileSync(sw, "utf8").replace(imageRef, "/$1.png"));

let indexes = 0;
for (const file of htmlFiles) {
  if (images.length) {
    writeFileSync(file, readFileSync(file, "utf8").replace(imageRef, "/$1.png"));
  }
  const rel = relative(out, file);
  if (!["index.html", "404.html"].includes(rel) && !rel.endsWith("/index.html")) {
    const target = join(out, rel.slice(0, -".html".length), "index.html");
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file, target);
    indexes++;
  }
}

mkdirSync(join(out, ".catalyst"), { recursive: true });
writeFileSync(
  join(out, ".catalyst", "slate-config.toml"),
  'framework = "static"\ndeployment_name = "default"\n',
);
console.log(`slate: ${indexes} directory indexes, ${images.length} image copies`);
