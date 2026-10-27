import path from "path";
import { defineConfig } from "vitest/config";

// Node by default; a test file opts into the DOM with a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  // Components use the automatic JSX runtime (Next's tsconfig says "preserve").
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
