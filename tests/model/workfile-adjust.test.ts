// Node env: jsdom's Blob mangles fflate's Uint8Array (cross-realm).
import { describe, expect, it, vi } from "vitest";
import { Design as DesignSchema, pageSize, usedAssets, type Design } from "@/lib/model";
import { adjEl, makeDesign, rectEl } from "../fixtures/design";

vi.mock("@/lib/storage", () => ({
  saveDesign: async () => {},
  loadAsset: async () => undefined,
  saveAsset: async () => {},
  saveThumb: async () => {},
  listFonts: async () => [],
  saveFont: async () => {},
  deleteFont: async () => {},
}));
vi.mock("@/lib/render", () => ({ renderThumbnail: () => Promise.reject(new Error("no thumbnails in tests")) }));

function sample(): Design {
  const d = makeDesign([
    rectEl({ id: "r", filters: [{ type: "blur", radius: 3 }, { type: "adjust", adjustment: { type: "posterize", levels: 3 } }] }),
    adjEl({ id: "a", adjustment: { type: "levels", channels: { rgb: { inBlack: 10, inWhite: 240, gamma: 1.2, outBlack: 0, outWhite: 255 } } }, rasterMask: { assetId: "m", x: 0, y: 0, width: 200, height: 200, outside: 1 } }),
  ]);
  d.pages.push({ id: "p2", background: "#000000", elements: [], width: 640, height: 360 });
  d.version = 3;
  return d;
}

describe("P5 model", () => {
  it("pageSize falls back to the design size", () => {
    const d = sample();
    expect(pageSize(d, d.pages[0])).toEqual({ width: 200, height: 200 });
    expect(pageSize(d, d.pages[1])).toEqual({ width: 640, height: 360 });
    expect(pageSize(d, { width: -3, height: Number.NaN })).toEqual({ width: 200, height: 200 });
  });

  it("schema keeps adjustments, filters and page sizes; old designs still parse", () => {
    const d = sample();
    const parsed = DesignSchema.parse(d);
    expect(parsed.pages[1]).toMatchObject({ width: 640, height: 360 });
    expect(parsed.pages[0].elements[1]).toMatchObject({ type: "adjustment", rasterMask: { outside: 1 } });
    expect(parsed.pages[0].elements[0].filters).toHaveLength(2);
    const old = makeDesign([rectEl()]);
    expect(DesignSchema.parse(old).pages[0]).not.toHaveProperty("width");
  });

  it("an adjustment's raster mask counts as a used asset", () => {
    expect(usedAssets(sample()).has("m")).toBe(true);
  });

  it("workfile keeps page size, adjustments and filters", async () => {
    const { exportWorkfile, importWorkfile } = await import("@/lib/workfile");
    const back = await importWorkfile(new File([await exportWorkfile(sample())], "x.canvasme"));
    expect(back.pages[1]).toMatchObject({ width: 640, height: 360 });
    expect(back.pages[0].elements.map((e) => e.type)).toEqual(["shape", "adjustment"]);
    expect(back.pages[0].elements[0].filters?.[1]).toMatchObject({ type: "adjust", adjustment: { type: "posterize", levels: 3 } });
  });
});
