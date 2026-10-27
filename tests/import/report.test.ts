import { describe, expect, it, vi } from "vitest";
import type { LayerEffectsInfo } from "ag-psd";

vi.mock("@/lib/storage", () => ({ saveAsset: vi.fn(), saveDesign: vi.fn(), saveThumb: vi.fn() }));
vi.mock("@/lib/render", () => ({ renderThumbnail: vi.fn(() => Promise.reject(new Error("no canvas"))) }));
vi.mock("@/lib/importers/fontMatch", () => ({
  availableFamilies: async () => ["Inter"],
  matchFont: () => ({ family: "Inter", bold: false, italic: false }),
}));
vi.mock("@/lib/importers/shared", async (orig) => ({
  ...(await orig<typeof import("@/lib/importers/shared")>()),
  fitTextWidth: async (_t: unknown, min: number) => min,
}));

import { Design } from "@/lib/model";
import { buildDesignFromPsdResult } from "@/lib/importers/psd";
import { convert } from "@/lib/importers/psdConvert";
import { buildPsd, groupLayer, pixelLayer, readFixture, textLayer } from "../fixtures/psd";

const px = (value: number) => ({ units: "Pixels" as const, value });
const io = { encode: async (rgba: Uint8ClampedArray) => new Blob([rgba as Uint8ClampedArray<ArrayBuffer>]) };
const deps = { saveAsset: async () => {} };
const shadow: LayerEffectsInfo = { dropShadow: [{ enabled: true, size: px(10), distance: px(8), angle: 90, color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }] };
const bevel: LayerEffectsInfo = { bevel: { enabled: true, style: "outer bevel", size: px(4) } };

async function importFixture(width = 200) {
  const buf = buildPsd(
    [
      pixelLayer({ name: "Shadowed", left: 10, top: 10, w: 20, h: 20, extra: { effects: shadow, blendMode: "multiply", opacity: 0.8, fillOpacity: 0.4 } }),
      pixelLayer({ name: "Bevelled", left: 60, top: 60, w: 20, h: 20, extra: { effects: bevel } }),
      textLayer({ text: "Title", left: 10, top: 100, extra: { effects: { stroke: [{ enabled: true, size: px(2), color: { r: 255, g: 0, b: 0 } }] } } }),
      groupLayer("Card", [pixelLayer({ name: "In card", w: 4, h: 4 }), pixelLayer({ name: "Also", w: 4, h: 4 })], { effects: shadow }),
    ],
    { width, height: 200 },
  );
  const result = await convert(readFixture(buf), () => {}, io);
  return buildDesignFromPsdResult(result, "poster.psd", deps);
}

describe("importPsd report", () => {
  it("importPsd writes importReport with element ids", async () => {
    const { design, report } = await importFixture();
    const els = design.pages[0].elements;
    const r = design.importReport!;
    expect(r).toMatchObject({ source: "psd", fileName: "poster.psd" });
    expect(r.items.length).toBeGreaterThanOrEqual(1);
    for (const item of r.items) if (item.elementId) expect(els.some((e) => e.id === item.elementId)).toBe(true);
    const baked = r.items.find((i) => i.kind === "baked")!;
    expect(baked.layerName).toBe("Bevelled");
    expect(els.find((e) => e.id === baked.elementId)!.name).toBe("Bevelled");
    // The group's shadow is kept on the group element now, so it has nothing to report.
    expect(r.items.find((i) => i.layerName === "Card")).toBeUndefined();
    const card = els.find((e) => e.name === "Card")!;
    expect(card.type).toBe("group");
    expect(card.effects?.dropShadow).toHaveLength(1);
    expect(Design.safeParse(design).success).toBe(true);
    expect(report!.itemsCount).toBe(r.items.length);
    expect(report!.notes.join(" ")).toMatch(/1 layer had effects baked into pixels/);
    expect(report!.notes.join(" ")).toMatch(/Import notes/);
  });

  it("elements keep effects, blend mode, opacity and fill opacity", async () => {
    const { design } = await importFixture();
    const el = design.pages[0].elements.find((e) => e.name === "Shadowed")!;
    expect(el.blendMode).toBe("multiply");
    expect(el.opacity).toBeCloseTo(0.8, 2);
    expect(el.fillOpacity).toBeCloseTo(0.4, 2);
    expect(el.effects!.dropShadow![0]).toMatchObject({ size: 10, distance: 8 });
    const text = design.pages[0].elements.find((e) => e.type === "text")!;
    expect(text.effects!.stroke![0].size).toBe(2);
  });

  it("effects scale with the design when the canvas is scaled down", async () => {
    const { design } = await importFixture(16000);
    const el = design.pages[0].elements.find((e) => e.name === "Shadowed")!;
    expect(el.effects!.dropShadow![0].size).toBeCloseTo(5);
    expect(el.effects!.dropShadow![0].distance).toBeCloseTo(4);
  });

  it("baked layers grow to the baked box", async () => {
    const { design } = await importFixture();
    const el = design.pages[0].elements.find((e) => e.name === "Bevelled")!;
    expect(el.x).toBeLessThan(60);
    expect(el.width).toBeGreaterThan(20);
    expect(el.effects).toBeUndefined();
  });

  it("bake-only file has no composite layer", async () => {
    const result = await convert(readFixture(buildPsd([pixelLayer({ name: "B", w: 20, h: 20, extra: { effects: bevel } })])), () => {}, io);
    const { design } = await buildDesignFromPsdResult(result, "b.psd", deps);
    expect(design.pages[0].elements.map((e) => e.name)).toEqual(["B"]);
  });

  it("a file with nothing simplified has no import report", async () => {
    const result = await convert(readFixture(buildPsd([pixelLayer({ name: "P", w: 4, h: 4 })])), () => {}, io);
    const { design, report } = await buildDesignFromPsdResult(result, "p.psd", deps);
    expect(design.importReport).toBeUndefined();
    expect(report).toBeNull();
  });

  it("the design's report keeps the summary with the notes", async () => {
    const { design } = await importFixture();
    expect(design.importReport!.notes.join(" ")).toMatch(/1 layer had effects baked into pixels/);
    // The pointer to the panel belongs in the toast, not in the panel itself.
    expect(design.importReport!.notes.join(" ")).not.toMatch(/See Import notes/);
  });

  it("notes without per-layer items are still kept in the design", async () => {
    const result = await convert(readFixture(buildPsd([pixelLayer({ name: "P", w: 4, h: 4 })])), () => {}, io);
    result.notes.push("Warped, rotated or vertical text came in as images.");
    const { design, report } = await buildDesignFromPsdResult(result, "n.psd", deps);
    expect(design.importReport).toMatchObject({ notes: ["Warped, rotated or vertical text came in as images."], items: [] });
    expect(Design.safeParse(design).success).toBe(true);
    expect(report!.itemsCount).toBeUndefined();
  });
});
