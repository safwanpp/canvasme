import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({ saveAsset: vi.fn(), saveDesign: vi.fn(), saveThumb: vi.fn(), loadAsset: vi.fn(async () => null), listFonts: vi.fn(async () => []), saveFont: vi.fn() }));
vi.mock("@/lib/render", () => ({ renderThumbnail: vi.fn(() => Promise.reject(new Error("no canvas"))) }));
vi.mock("@/lib/importers/fontMatch", () => ({
  availableFamilies: async () => ["Inter"],
  matchFont: () => ({ family: "Inter", bold: false, italic: false }),
}));

import type { AdjustmentLayer, Layer, Psd } from "ag-psd";
import { Adjustment as AdjustmentSchema } from "@/lib/adjustments";
import { Design, pageSize } from "@/lib/model";
import { buildDesignFromPsdResult } from "@/lib/importers/psd";
import { modelAdjustmentToPsd, psdAdjustmentToModel } from "@/lib/importers/psdAdjust";
import { convert } from "@/lib/importers/psdConvert";
import { buildPsd, groupLayer, pixelLayer, readFixture } from "../fixtures/psd";

const io = { encode: async (rgba: Uint8ClampedArray) => new Blob([rgba as Uint8ClampedArray<ArrayBuffer>]) };
const saved: string[] = [];
const deps = { saveAsset: async (id: string) => void saved.push(id) };

const adjLayer = (name: string, adjustment: AdjustmentLayer, extra?: Partial<Layer>): Layer => ({ name, adjustment, ...extra });

async function fromPsd(psd: Psd, file = "a.psd") {
  const result = await convert(psd, () => {}, io);
  const out = await buildDesignFromPsdResult(result, file, deps);
  return { result, ...out };
}
const fromLayers = (layers: Layer[]) => fromPsd(readFixture(buildPsd(layers)));

describe("psd adjustment layers", () => {
  it("levels maps each channel", async () => {
    const { design } = await fromLayers([
      pixelLayer({ name: "Base", w: 20, h: 20 }),
      adjLayer("Levels", {
        type: "levels",
        rgb: { shadowInput: 10, highlightInput: 240, shadowOutput: 5, highlightOutput: 250, midtoneInput: 1.5 },
        red: { shadowInput: 20, highlightInput: 200, shadowOutput: 0, highlightOutput: 255, midtoneInput: 0.8 },
        blue: { shadowInput: 0, highlightInput: 128, shadowOutput: 0, highlightOutput: 255, midtoneInput: 1 },
      }),
    ]);
    const el = design.pages[0].elements.find((e) => e.type === "adjustment")!;
    expect(el).toMatchObject({ type: "adjustment", x: 0, y: 0, width: 200, height: 200, name: "Levels" });
    const adj = (el as Extract<typeof el, { type: "adjustment" }>).adjustment;
    expect(adj.type).toBe("levels");
    if (adj.type !== "levels") return;
    expect(adj.channels.rgb).toEqual({ inBlack: 10, inWhite: 240, outBlack: 5, outWhite: 250, gamma: 1.5 });
    expect(adj.channels.r).toMatchObject({ inBlack: 20, inWhite: 200, gamma: 0.8 });
    expect(adj.channels.g).toBeUndefined();
    expect(adj.channels.b).toMatchObject({ inWhite: 128 });
    expect(Design.safeParse(design).success).toBe(true);
  });

  it("curves points 0..255 → 0..1", () => {
    const adj = psdAdjustmentToModel({
      type: "curves",
      rgb: [
        { input: 255, output: 255 },
        { input: 0, output: 0 },
        { input: 128, output: 64 },
        { input: 128, output: 70 },
      ],
      green: [{ input: 0, output: 255 }],
    });
    expect(adj).toMatchObject({ type: "curves" });
    if (adj?.type !== "curves") return;
    expect(adj.channels.rgb).toEqual([
      { x: 0, y: 0 },
      { x: 128 / 255, y: 70 / 255 },
      { x: 1, y: 1 },
    ]);
    // A single point is not a curve.
    expect(adj.channels.g).toBeUndefined();
    expect(AdjustmentSchema.safeParse(adj).success).toBe(true);
  });

  it("hue/sat master and ranges", () => {
    const ch = (a: number, b: number, c: number, d: number, hue: number, saturation: number, lightness: number) => ({ a, b, c, d, hue, saturation, lightness });
    const adj = psdAdjustmentToModel({
      type: "hue/saturation",
      master: ch(0, 0, 0, 0, 20, -30, 10),
      reds: ch(315, 345, 15, 45, 0, 0, 0),
      yellows: ch(15, 45, 75, 105, -40, 25, 5),
      blues: ch(195, 225, 255, 285, 0, 0, -20),
    });
    expect(adj).toMatchObject({ type: "hue-saturation", colorize: false, master: { hue: 20, saturation: -30, lightness: 10 } });
    if (adj?.type !== "hue-saturation") return;
    // Only ranges that change something are kept, with their own edges.
    expect(adj.ranges).toEqual([
      { range: "yellows", a: 15, b: 45, c: 75, d: 105, hue: -40, saturation: 25, lightness: 5 },
      { range: "blues", a: 195, b: 225, c: 255, d: 285, hue: 0, saturation: 0, lightness: -20 },
    ]);
    expect(AdjustmentSchema.safeParse(adj).success).toBe(true);
  });

  it("hue/sat colorize: the flag in master.a's high byte, its values in master.b/c/d", () => {
    const ch = (a: number, b: number, c: number, d: number, hue: number, saturation: number, lightness: number) => ({ a, b, c, d, hue, saturation, lightness });
    const adj = psdAdjustmentToModel({ type: "hue/saturation", master: ch(1 << 8, 210, 40, -15, 5, 0, 0), reds: ch(315, 345, 15, 45, 30, 0, 0) });
    // Colorize ignores the master shift and the ranges.
    expect(adj).toEqual({ type: "hue-saturation", colorize: true, master: { hue: 210, saturation: 40, lightness: -15 } });
    expect(AdjustmentSchema.safeParse(adj).success).toBe(true);
    // The pad byte alone isn't the flag.
    expect(psdAdjustmentToModel({ type: "hue/saturation", master: ch(1, 210, 40, -15, 5, 0, 0) })).toMatchObject({ colorize: false, master: { hue: 5 } });
    // And the export writes it back the same way.
    expect(modelAdjustmentToPsd(adj!)).toMatchObject({ master: { a: 256, b: 210, c: 40, d: -15, hue: 0, saturation: 0, lightness: 0 } });
  });

  it("an adjustment's fill opacity fades it like opacity", async () => {
    const { design } = await fromLayers([pixelLayer({ name: "Base", w: 10, h: 10 }), adjLayer("Inv", { type: "invert" }, { opacity: 0.5, fillOpacity: 0.5 })]);
    const el = design.pages[0].elements.find((e) => e.name === "Inv")!;
    expect(el.opacity).toBeCloseTo(0.25, 2);
  });

  it("gradient map stops", async () => {
    const { design } = await fromLayers([
      pixelLayer({ name: "Base", w: 10, h: 10 }),
      adjLayer("Map", {
        type: "gradient map",
        gradientType: "solid",
        reverse: true,
        smoothness: 1,
        colorStops: [
          { color: { r: 255, g: 255, b: 255 }, location: 1, midpoint: 0.5 },
          { color: { r: 0, g: 0, b: 128 }, location: 0, midpoint: 0.5 },
          { color: { r: 255, g: 0, b: 0 }, location: 0.5, midpoint: 0.5 },
        ],
        opacityStops: [
          { opacity: 1, location: 0, midpoint: 0.5 },
          { opacity: 0.5, location: 1, midpoint: 0.5 },
        ],
      }),
    ]);
    const el = design.pages[0].elements.find((e) => e.type === "adjustment");
    const adj = el && el.type === "adjustment" ? el.adjustment : null;
    expect(adj).toMatchObject({ type: "gradient-map", reverse: true });
    if (adj?.type !== "gradient-map") return;
    expect(adj.gradient.stops.map((s) => [Math.round(s.offset * 100) / 100, s.color])).toEqual([
      [0, "#000080"],
      [0.5, "#ff0000"],
      [1, "#ffffff"],
    ]);
    const ops = adj.gradient.opacityStops!.map((o) => o.opacity);
    expect(ops[0]).toBe(1);
    // Stored as 0..255.
    expect(ops[1]).toBeCloseTo(0.5, 2);
  });

  it("maps the other kinds and writes them back", () => {
    const layers: AdjustmentLayer[] = [
      { type: "brightness/contrast", brightness: 30, contrast: -20, useLegacy: true },
      { type: "exposure", exposure: 1.5, offset: 0.1, gamma: 0.9 },
      { type: "vibrance", vibrance: 40, saturation: -10 },
      { type: "color balance", shadows: { cyanRed: 10, magentaGreen: 0, yellowBlue: -5 }, midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 }, highlights: { cyanRed: 0, magentaGreen: 20, yellowBlue: 0 }, preserveLuminosity: true },
      { type: "black & white", reds: 30, yellows: 50, greens: 40, cyans: 60, blues: 20, magentas: 80, useTint: true, tintColor: { r: 255, g: 128, b: 0 } },
      { type: "photo filter", color: { r: 236, g: 138, b: 0 }, density: 0.25, preserveLuminosity: true },
      { type: "channel mixer", monochrome: false, red: { red: 90, green: 5, blue: 5, constant: 0 }, green: { red: 0, green: 100, blue: 0, constant: 2 }, blue: { red: 0, green: 0, blue: 100, constant: 0 }, gray: { red: 40, green: 40, blue: 20, constant: 0 } },
      { type: "invert" },
      { type: "posterize", levels: 5 },
      { type: "threshold", level: 100 },
    ];
    for (const l of layers) {
      const m = psdAdjustmentToModel(l);
      expect(m, l.type).not.toBeNull();
      expect(AdjustmentSchema.safeParse(m).success, l.type).toBe(true);
      // The way back keeps the model: map again and compare.
      expect(psdAdjustmentToModel(modelAdjustmentToPsd(m!)), l.type).toEqual(m);
    }
    expect(psdAdjustmentToModel(layers[4])).toMatchObject({ type: "black-white", tint: "#ff8000" });
    expect(psdAdjustmentToModel(layers[6])).toMatchObject({ type: "channel-mixer", r: { r: 90, g: 5, b: 5, constant: 0 } });
  });

  it("export direction round-trips levels, curves, hue/sat and gradient map through the file", async () => {
    const { defaultAdjustment } = await import("@/lib/adjustments");
    const adjs = [
      { type: "levels" as const, channels: { rgb: { inBlack: 12, inWhite: 230, gamma: 1.2, outBlack: 3, outWhite: 240 }, g: { inBlack: 0, inWhite: 200, gamma: 1, outBlack: 0, outWhite: 255 } } },
      { type: "curves" as const, channels: { rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }].map((p) => ({ x: Math.round(p.x * 255) / 255, y: Math.round(p.y * 255) / 255 })) } },
      { type: "hue-saturation" as const, colorize: false, master: { hue: 15, saturation: 10, lightness: -5 } },
      defaultAdjustment("gradient-map"),
    ];
    const back = readFixture(buildPsd([pixelLayer({ name: "B", w: 4, h: 4 }), ...adjs.map((a, i) => adjLayer(`A${i}`, modelAdjustmentToPsd(a)))]));
    const got = back.children!.slice(1).map((l) => psdAdjustmentToModel(l.adjustment!));
    expect(got[0]).toEqual(adjs[0]);
    expect(got[1]).toEqual(adjs[1]);
    expect(got[2]).toMatchObject({ type: "hue-saturation", master: { hue: 15, saturation: 10, lightness: -5 } });
    expect(got[3]).toMatchObject({ type: "gradient-map", reverse: false });
  });

  it("selective color dropped with note", async () => {
    const cmyk = { c: 0, m: 0, y: 0, k: 0 };
    const { result, report, design } = await fromLayers([
      pixelLayer({ name: "Base", w: 10, h: 10 }),
      adjLayer("Selective", { type: "selective color", mode: "relative", reds: cmyk, yellows: cmyk, greens: cmyk, cyans: cmyk, blues: cmyk, magentas: cmyk, whites: cmyk, neutrals: cmyk, blacks: cmyk }),
    ]);
    expect(design.pages[0].elements.some((e) => e.type === "adjustment")).toBe(false);
    expect(result.lossy).toBe(true);
    expect(result.notes.join(" ")).toMatch(/Selective color/);
    expect(result.layerIssues).toEqual([expect.objectContaining({ kind: "dropped", layerName: "Selective" })]);
    expect(report?.notes.join(" ")).toMatch(/Selective color/);
    expect(design.importReport?.items.some((i) => i.layerName === "Selective")).toBe(true);
  });

  it("color lookup dropped with note (direct input)", async () => {
    const psd: Psd = { width: 20, height: 20, children: [pixelLayer({ name: "Base", w: 5, h: 5 }), adjLayer("LUT", { type: "color lookup", name: "x" })] };
    const result = await convert(psd, () => {}, io);
    expect(result.lossy).toBe(true);
    expect(result.nodes.map((n) => n.kind)).toEqual([undefined]);
    expect(result.notes.join(" ")).toMatch(/Color lookup/);
  });

  it("adjustment mask becomes rasterMask asset", async () => {
    saved.length = 0;
    const w = 6;
    const h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([i % 2 ? 255 : 100, 0, 0, 255], i * 4);
    const psd: Psd = {
      width: 200,
      height: 100,
      children: [
        pixelLayer({ name: "Base", w: 20, h: 20 }),
        adjLayer("Masked", { type: "invert" }, {
          opacity: 0.5,
          blendMode: "multiply",
          mask: { left: 10, top: 20, right: 10 + w, bottom: 20 + h, defaultColor: 255, imageData: { width: w, height: h, data } as unknown as ImageData },
        }),
        adjLayer("Plain", { type: "invert" }),
      ],
    };
    const { design } = await fromPsd(psd);
    const [, masked, plain] = design.pages[0].elements;
    expect(masked).toMatchObject({ type: "adjustment", x: 0, y: 0, width: 200, height: 100, opacity: 0.5, blendMode: "multiply" });
    if (masked.type !== "adjustment") return;
    expect(masked.rasterMask).toMatchObject({ x: 10, y: 20, width: w, height: h, outside: 1 });
    const id = masked.rasterMask!.assetId;
    expect(saved).toContain(id);
    expect(design.assets[id]).toMatchObject({ mime: "image/png", generated: true });
    expect(plain.type === "adjustment" && plain.rasterMask).toBeFalsy();
    expect(Design.safeParse(design).success).toBe(true);
  });

  it("the mask PNG is grayscale with the value in colour and alpha", async () => {
    const data = new Uint8ClampedArray([200, 0, 0, 255, 50, 0, 0, 255]);
    const psd: Psd = {
      width: 10,
      height: 10,
      children: [adjLayer("M", { type: "invert" }, { mask: { left: 0, top: 0, right: 2, bottom: 1, imageData: { width: 2, height: 1, data } as unknown as ImageData } })],
    };
    let bytes: number[] = [];
    const result = await convert(psd, () => {}, { encode: async (rgba) => ((bytes = [...rgba]), new Blob()) });
    expect(result.nodes[0].mask).toMatchObject({ width: 2, height: 1, left: 0, top: 0 });
    expect(bytes).toEqual([200, 200, 200, 200, 50, 50, 50, 50]);
  });
});

describe("psd artboards", () => {
  const board = (name: string, rect: { left: number; top: number; right: number; bottom: number }, children: Layer[], color?: { backgroundType?: number; color?: { r: number; g: number; b: number } }) =>
    groupLayer(name, children, { artboard: { rect, ...color } });

  it("two artboards become two pages with translated content", async () => {
    const psd: Psd = {
      width: 400,
      height: 200,
      children: [
        board("A", { left: 0, top: 0, right: 100, bottom: 100 }, [pixelLayer({ name: "a1", left: 10, top: 20, w: 5, h: 5 })], { backgroundType: 4, color: { r: 0, g: 128, b: 0 } }),
        board("B", { left: 200, top: 50, right: 300, bottom: 150 }, [
          pixelLayer({ name: "b1", left: 230, top: 70, w: 10, h: 10 }),
          groupLayer("inner", [pixelLayer({ name: "b2", left: 250, top: 90, w: 10, h: 10 })]),
          adjLayer("adj", { type: "invert" }),
        ]),
        pixelLayer({ name: "loose", left: 5, top: 5, w: 4, h: 4 }),
      ],
    };
    const { design, report } = await fromPsd(psd);
    expect(design.pages).toHaveLength(3);
    const [a, b, outside] = design.pages;
    expect(a.background).toBe("#008000");
    expect(b.background).toBe("#ffffff");
    expect(a.elements.map((e) => e.name)).toEqual(["a1"]);
    expect(b.elements.map((e) => e.name)).toEqual(["b1", "b2", "inner", "adj"]);
    expect(b.elements.find((e) => e.name === "b1")).toMatchObject({ x: 30, y: 20, groupId: null });
    const inner = b.elements.find((e) => e.name === "inner")!;
    expect(inner.groupId).toBeNull();
    expect(b.elements.find((e) => e.name === "b2")).toMatchObject({ x: 50, y: 40, groupId: inner.id });
    expect(b.elements.find((e) => e.name === "adj")).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    expect(outside.elements.map((e) => e.name)).toEqual(["loose"]);
    expect(pageSize(design, outside)).toEqual({ width: 400, height: 200 });
    expect(report?.notes.join(" ")).toMatch(/outside every artboard/);
    expect(Design.safeParse(design).success).toBe(true);
  });

  it("a hidden artboard hides its contents", async () => {
    const hidden = board("H", { left: 0, top: 0, right: 100, bottom: 100 }, [
      pixelLayer({ name: "h1", left: 10, top: 10, w: 5, h: 5 }),
      groupLayer("hg", [pixelLayer({ name: "h2", left: 20, top: 20, w: 5, h: 5 })]),
    ]);
    hidden.hidden = true;
    const psd: Psd = {
      width: 300,
      height: 100,
      children: [hidden, board("V", { left: 200, top: 0, right: 300, bottom: 100 }, [pixelLayer({ name: "v1", left: 210, top: 10, w: 5, h: 5 })])],
    };
    const { design } = await fromPsd(psd);
    const [h, v] = design.pages;
    expect(h.elements.find((e) => e.name === "h1")!.hidden).toBe(true);
    expect(h.elements.find((e) => e.name === "hg")!.hidden).toBe(true);
    expect(v.elements.find((e) => e.name === "v1")!.hidden).toBe(false);
  });

  it("artboards of different sizes keep per-page width/height", async () => {
    const psd: Psd = {
      width: 1000,
      height: 800,
      children: [
        board("Phone", { left: 0, top: 0, right: 300, bottom: 600 }, [pixelLayer({ name: "p", w: 10, h: 10 })]),
        board("Desk", { left: 400, top: 0, right: 1000, bottom: 400 }, [pixelLayer({ name: "d", left: 400, w: 10, h: 10 })]),
      ],
    };
    const { design } = await fromPsd(psd);
    expect(design.pages).toHaveLength(2);
    expect([design.width, design.height]).toEqual([300, 600]);
    expect(pageSize(design, design.pages[0])).toEqual({ width: 300, height: 600 });
    expect(pageSize(design, design.pages[1])).toEqual({ width: 600, height: 400 });
    expect(design.pages[1]).toMatchObject({ width: 600, height: 400 });
    expect(design.pages[1].elements[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("large artboards scale together to the editor's limit", async () => {
    const psd: Psd = {
      width: 20000,
      height: 10000,
      children: [
        board("A", { left: 0, top: 0, right: 8000, bottom: 4000 }, [pixelLayer({ name: "a", w: 10, h: 10 })]),
        board("B", { left: 8000, top: 0, right: 20000, bottom: 6000 }, [pixelLayer({ name: "b", left: 8000, w: 10, h: 10 })]),
      ],
    };
    const result = await convert(psd, () => {}, io);
    const { design } = await buildDesignFromPsdResult(result, "big.psd", deps);
    // The 12000 px wide artboard sets the scale (2/3) for both.
    expect(design.pages[1]).toMatchObject({ width: 8000, height: 4000 });
    expect([design.width, design.height]).toEqual([5333, 2667]);
    expect(Design.safeParse(design).success).toBe(true);
  });

  it("a loose layer's outside page fits the limit with the artboards", async () => {
    const psd: Psd = {
      width: 20000,
      height: 10000,
      children: [
        board("A", { left: 0, top: 0, right: 1000, bottom: 500 }, [pixelLayer({ name: "a", w: 10, h: 10 })]),
        pixelLayer({ name: "loose", left: 15000, top: 5000, w: 10, h: 10 }),
      ],
    };
    const { design } = await fromPsd(psd);
    expect(design.pages).toHaveLength(2);
    expect(design.pages[1]).toMatchObject({ width: 8000, height: 4000 });
    expect(design.pages[0]).toMatchObject({ width: 400, height: 200 });
    expect(Design.safeParse(design).success).toBe(true);
    const { exportWorkfile, importWorkfile } = await import("@/lib/workfile");
    const back = await importWorkfile(new File([await exportWorkfile(design)], "x.canvasme"));
    expect(back.pages[1]).toMatchObject({ width: 8000, height: 4000 });
  });

  it("a lossy file keeps the reference composite on every page, lined up with its artboard", async () => {
    const cmyk = { c: 0, m: 0, y: 0, k: 0 };
    const flat = { width: 4, height: 2, data: new Uint8ClampedArray(4 * 2 * 4).fill(255) } as unknown as ImageData;
    const psd: Psd = {
      width: 400,
      height: 200,
      imageData: flat,
      children: [
        board("A", { left: 0, top: 0, right: 100, bottom: 100 }, [pixelLayer({ name: "a", w: 10, h: 10 })]),
        board("B", { left: 200, top: 50, right: 300, bottom: 150 }, [
          pixelLayer({ name: "b", left: 210, top: 60, w: 10, h: 10 }),
          adjLayer("Sel", { type: "selective color", mode: "relative", reds: cmyk }),
        ]),
        pixelLayer({ name: "loose", left: 5, top: 5, w: 4, h: 4 }),
      ],
    };
    const { design, report, result } = await fromPsd(psd);
    expect(result.lossy).toBe(true);
    expect(design.pages).toHaveLength(3);
    const refs = design.pages.map((p) => p.elements[0]);
    for (const r of refs) expect(r).toMatchObject({ type: "image", hidden: true, locked: true, width: 400, height: 200 });
    expect(refs.map((r) => [r.x, r.y])).toEqual([[0, 0], [-200, -50], [0, 0]]);
    expect(design.pages[1].elements.map((e) => e.name)).toEqual(["Flattened (as saved by Photoshop)", "b"]);
    const text = (report?.notes ?? []).join(" ");
    expect(text).toMatch(/hidden, locked bottom layer of each page/);
    expect(text).not.toMatch(/isn't kept/);
  });

  it("page without width/height renders at design size", async () => {
    const { design } = await fromLayers([pixelLayer({ name: "Base", w: 10, h: 10 })]);
    expect(design.pages).toHaveLength(1);
    expect(design.pages[0].width).toBeUndefined();
    expect(pageSize(design, design.pages[0])).toEqual({ width: design.width, height: design.height });
  });

  it("workfile keeps page size", async () => {
    const psd: Psd = {
      width: 500,
      height: 300,
      children: [
        board("A", { left: 0, top: 0, right: 100, bottom: 100 }, [pixelLayer({ name: "a", w: 10, h: 10 })]),
        board("B", { left: 100, top: 0, right: 500, bottom: 300 }, [pixelLayer({ name: "b", left: 100, w: 10, h: 10 })]),
      ],
    };
    const { design } = await fromPsd(psd);
    const { exportWorkfile, importWorkfile } = await import("@/lib/workfile");
    const back = await importWorkfile(new File([await exportWorkfile(design)], "x.canvasme"));
    expect(back.pages.map((p) => [p.width, p.height])).toEqual([[100, 100], [400, 300]]);
  });
});
