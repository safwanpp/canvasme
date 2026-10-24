import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Everything runs in the browser, so ship plain static files (Cloudflare Pages serves `out/`).
  output: "export",
  // Konva's Node entry requires the optional native `canvas` package; the editor
  // only renders in the browser, so keep it out of server bundles.
  webpack: (config) => {
    config.externals = [...(config.externals ?? []), { canvas: "commonjs canvas" }];
    return config;
  },
};

export default nextConfig;
