import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// Background removal loads ONNX Runtime from jsDelivr (the WebGPU build is too big for Cloudflare
// Pages). Pin the exact files to the installed package: the worker checks these SHA-384 hashes
// before running anything it downloaded.
const ortDir = join(process.cwd(), "node_modules", "onnxruntime-web");
const ORT = {
  version: JSON.parse(readFileSync(join(ortDir, "package.json"), "utf8")).version as string,
  sha384: Object.fromEntries(
    ["ort-wasm-simd-threaded.asyncify", "ort-wasm-simd-threaded"].flatMap((base) =>
      [".mjs", ".wasm"].map((ext) => [
        base + ext,
        createHash("sha384").update(readFileSync(join(ortDir, "dist", base + ext))).digest("base64"),
      ]),
    ),
  ),
};

const nextConfig: NextConfig = {
  // Everything runs in the browser, so ship plain static files (Cloudflare Pages serves `out/`).
  output: "export",
  devIndicators: false,
  // No image server on a static host; screenshots are pre-sized WebP files.
  images: { unoptimized: true },
  // Konva's Node entry requires the optional native `canvas` package; the editor
  // only renders in the browser, so keep it out of server bundles.
  webpack: (config, { webpack }) => {
    config.plugins.push(new webpack.DefinePlugin({ __ORT__: JSON.stringify(ORT) }));
    config.externals = [...(config.externals ?? []), { canvas: "commonjs canvas" }];
    // transformers.js (background removal) runs in the browser only; skip its Node backends.
    config.resolve.alias = { ...config.resolve.alias, sharp$: false, "onnxruntime-node$": false };
    // ONNX Runtime's wasm (27 MB, over Cloudflare Pages' 25 MiB file limit) loads from jsDelivr
    // at run time, so don't let webpack copy it and its loaders into the build.
    config.module.rules.push({ test: /node_modules[\\/]onnxruntime-web[\\/]/, parser: { url: false } });
    return config;
  },
};

export default nextConfig;
