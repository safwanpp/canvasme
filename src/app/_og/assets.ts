import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Build-time assets for the generated icon and share images.
export async function markDataUrl() {
  const svg = await readFile(join(process.cwd(), "public/brand/canvasme-mark.svg"));
  return `data:image/svg+xml;base64,${svg.toString("base64")}`;
}

export async function ogFonts() {
  const dir = join(process.cwd(), "src/app/_og");
  const [regular, semibold, mono] = await Promise.all([
    readFile(join(dir, "Geist-400.ttf")),
    readFile(join(dir, "Geist-600.ttf")),
    readFile(join(dir, "GeistMono-400.ttf")),
  ]);
  return [
    { name: "Geist", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Geist", data: semibold, weight: 600 as const, style: "normal" as const },
    { name: "Geist Mono", data: mono, weight: 400 as const, style: "normal" as const },
  ];
}
