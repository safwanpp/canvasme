import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Everything runs in the browser, so ship plain static files (Cloudflare Pages serves `out/`).
  output: "export",
  devIndicators: false,
  // No image server on a static host; screenshots are pre-sized WebP files.
  images: { unoptimized: true },
  // Konva's Node entry requires the optional native `canvas` package; the editor
  // only renders in the browser, so keep it out of server bundles.
  webpack: (config) => {
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
