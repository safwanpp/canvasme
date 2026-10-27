import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({ saveAsset: vi.fn(), saveDesign: vi.fn(), saveThumb: vi.fn(), listFonts: async () => [] }));
vi.mock("@/lib/render", () => ({ renderThumbnail: vi.fn(() => Promise.reject(new Error("no canvas"))) }));

import type { BezierPath, Layer } from "ag-psd";
import { Design, type Element, type ShapeElement, type VectorElement } from "@/lib/model";
import { buildDesignFromPsdResult } from "@/lib/importers/psd";
import { convert } from "@/lib/importers/psdConvert";
import { KNOT_BUDGET, readVectorMask } from "@/lib/importers/psdVector";
import { buildPsd, pixelLayer, polyPath, readFixture, shapeLayer } from "../fixtures/psd";

const io = { encode: async (rgba: Uint8ClampedArray) => new Blob([rgba as Uint8ClampedArray<ArrayBuffer>]) };
const deps = { saveAsset: async () => {} };
const px = (value: number) => ({ units: "Pixels" as const, value });

async function importLayers(layers: Layer[], o?: { width?: number; height?: number; budget?: number }) {
  const result = await convert(readFixture(buildPsd(layers, o)), () => {}, io, o?.budget !== undefined ? { knotBudget: o.budget } : undefined);
  const { design, report } = await buildDesignFromPsdResult(result, "v.psd", deps);
  expect(Design.safeParse(design).success).toBe(true);
  return { result, design, report, els: design.pages[0].elements };
}
const byName = (els: Element[], name: string) => {
  const el = els.find((e) => e.name === name);
  if (!el) throw new Error(`no ${name} in ${els.map((e) => e.name)}`);
  return el;
};
const vec = (els: Element[], name: string) => {
  const el = byName(els, name);
  expect(el.type).toBe("vector");
  return el as VectorElement;
};
const close = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const triangle = (extra?: Partial<BezierPath>) => polyPath([[20, 10], [80, 70], [20, 70]], extra);

describe("psd vector shape layers", () => {
  it("a shape layer becomes a vector element with colour fill and exact local knots", async () => {
    const { els, design } = await importLayers([shapeLayer({ name: "Tri", paths: [triangle()], fill: { type: "color", color: { r: 0, g: 128, b: 255 } } })]);
    const v = vec(els, "Tri");
    expect(v).toMatchObject({ x: 20, y: 10, width: 60, height: 60, fill: { type: "color", color: "#0080ff" }, stroke: null, fillRule: "nonzero" });
    const k = v.subpaths[0].knots;
    close(k[0].x, 0);
    close(k[0].y, 0);
    close(k[1].x, 60);
    close(k[1].y, 60);
    close(k[2].x, 0);
    close(k[2].y, 60);
    expect(v.subpaths[0].closed).toBe(true);
    // The vector replaces the layer's pixels.
    expect(Object.keys(design.assets)).toHaveLength(0);
  });

  it("knot points map as [inX, inY, x, y, outX, outY]", async () => {
    const path: BezierPath = {
      open: true,
      fillRule: "non-zero",
      operation: "combine",
      knots: [
        { linked: true, points: [5, 50, 10, 50, 15, 30] },
        { linked: true, points: [85, 30, 90, 50, 95, 50] },
      ],
    };
    const { els } = await importLayers([shapeLayer({ name: "Arc", paths: [path] })]);
    const v = vec(els, "Arc");
    const [a, b] = v.subpaths[0].knots;
    // Bounds come from the curve itself: x 10..90; the arch tops out at y = 35.
    close(v.x, 10);
    close(v.width, 80);
    close(v.y, 35, 1e-2);
    close(a.x + v.x, 10);
    close(a.y + v.y, 50);
    close(a.inX + v.x, 5);
    close(a.outX + v.x, 15);
    close(a.outY + v.y, 30);
    close(b.inX + v.x, 85);
    close(b.x + v.x, 90);
    close(b.outX + v.x, 95);
    expect(v.subpaths[0].closed).toBe(false);
  });

  it("vector stroke maps width (points to px), alignment, caps, joins, dash and opacity", async () => {
    const { els } = await importLayers(
      [
        shapeLayer({
          name: "S",
          paths: [triangle()],
          extra: {
            vectorStroke: {
              strokeEnabled: true,
              fillEnabled: true,
              lineWidth: { units: "Points", value: 3 },
              lineAlignment: "outside",
              lineCapType: "round",
              lineJoinType: "bevel",
              lineDashSet: [{ units: "None", value: 2 }, { units: "None", value: 1 }],
              content: { type: "color", color: { r: 0, g: 0, b: 255 } },
              opacity: 0.5,
              miterLimit: 4,
            },
          },
        }),
      ],
      undefined,
    );
    const v = vec(els, "S");
    expect(v).toMatchObject({ strokeAlign: "outside", lineCap: "round", lineJoin: "bevel", strokeWidth: 3 });
    // Dashes stay in stroke widths, as in Photoshop.
    expect(v.dash).toEqual([2, 1]);
    expect(v.miterLimit).toBe(4);
    expect(v.stroke).toEqual({ type: "color", color: "#0000ff80" });
  });

  it("disabled fill gives no fill; a disabled stroke none", async () => {
    const { els } = await importLayers([
      shapeLayer({
        name: "S",
        paths: [triangle()],
        extra: { vectorStroke: { strokeEnabled: false, fillEnabled: false, lineWidth: px(4), content: { type: "color", color: { r: 0, g: 0, b: 0 } } } },
      }),
    ]);
    expect(vec(els, "S")).toMatchObject({ fill: null, stroke: null });
  });

  it("gradient fill becomes a gradient paint", async () => {
    const { els } = await importLayers([
      shapeLayer({
        name: "G",
        paths: [triangle()],
        fill: {
          type: "solid",
          name: "g",
          colorStops: [
            { color: { r: 255, g: 0, b: 0 }, location: 0, midpoint: 0.5 },
            { color: { r: 0, g: 0, b: 255 }, location: 1, midpoint: 0.5 },
          ],
          opacityStops: [
            { opacity: 1, location: 0, midpoint: 0.5 },
            { opacity: 1, location: 1, midpoint: 0.5 },
          ],
          style: "radial",
          angle: 30,
        },
      }),
    ]);
    const v = vec(els, "G");
    expect(v.fill?.type).toBe("gradient");
    if (v.fill?.type !== "gradient") return;
    expect(v.fill.gradient).toMatchObject({ style: "radial", angle: 30, stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }] });
  });

  it("path operations and components come through; ag-psd's even-odd flag (Photoshop's usual value) reads as non-zero", async () => {
    const outer = polyPath([[0, 0], [100, 0], [100, 100], [0, 100]], { fillRule: "even-odd" });
    const inner = polyPath([[25, 25], [75, 25], [75, 75], [25, 75]], { operation: undefined, fillRule: "even-odd" });
    const sub = polyPath([[40, 0], [60, 0], [60, 10], [40, 10]], { operation: "subtract", fillRule: "even-odd" });
    const int = polyPath([[0, 0], [90, 0], [90, 90], [0, 90]], { operation: "intersect", fillRule: "even-odd" });
    const exc = polyPath([[0, 80], [10, 80], [10, 90], [0, 90]], { operation: "exclude", fillRule: "even-odd" });
    const { els } = await importLayers([shapeLayer({ name: "Ops", paths: [outer, inner, sub, int, exc] })]);
    const v = vec(els, "Ops");
    expect(v.fillRule).toBe("nonzero");
    expect(v.subpaths.map((s) => s.op)).toEqual(["combine", undefined, "subtract", "intersect", "exclude"]);
  });

  it("a pattern fill is baked into pixels with a note", async () => {
    const { els, design } = await importLayers([
      shapeLayer({ name: "P", paths: [triangle()], fill: { type: "pattern", name: "p", id: "x" } as never }),
    ]);
    expect(byName(els, "P").type).toBe("image");
    expect(design.importReport?.items.some((i) => i.kind === "baked" && /pattern/i.test(i.message))).toBe(true);
  });

  it("a shape layer with no pixels saved still comes in as a vector", async () => {
    const { els } = await importLayers([shapeLayer({ name: "NoPx", paths: [triangle()], pixels: false })]);
    expect(vec(els, "NoPx").width).toBeCloseTo(60, 3);
  });

  it("layer effects, blend and fill opacity stay on the vector", async () => {
    const { els } = await importLayers([
      shapeLayer({
        name: "FX",
        paths: [triangle()],
        extra: {
          blendMode: "multiply",
          fillOpacity: 0.5,
          effects: { dropShadow: [{ enabled: true, size: px(5), distance: px(4), angle: 90, color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }] },
        },
      }),
    ]);
    const v = vec(els, "FX");
    expect(v.blendMode).toBe("multiply");
    expect(v.fillOpacity).toBeCloseTo(0.5, 2);
    expect(v.effects?.dropShadow?.[0]).toMatchObject({ size: 5, distance: 4 });
  });
});

describe("psd live shapes", () => {
  const box = (t: number, l: number, b: number, r: number) => ({ top: px(t), left: px(l), bottom: px(b), right: px(r) });
  const rect = polyPath([[10, 20], [110, 20], [110, 70], [10, 70]]);

  it("a live rectangle becomes a shape element", async () => {
    const { els } = await importLayers([
      shapeLayer({ name: "R", paths: [rect], extra: { vectorOrigination: { keyDescriptorList: [{ keyOriginType: 1, keyOriginShapeBoundingBox: box(20, 10, 70, 110) }] } } }),
    ]);
    const s = byName(els, "R") as ShapeElement;
    expect(s).toMatchObject({ type: "shape", shape: "rect", x: 10, y: 20, width: 100, height: 50, fill: "#ff0000", strokeWidth: 0, cornerRadius: 0 });
  });

  it("a live rounded rectangle with equal radii keeps its radius; a centred solid stroke maps too", async () => {
    const r = { topLeft: px(8), topRight: px(8), bottomLeft: px(8), bottomRight: px(8) };
    const { els } = await importLayers([
      shapeLayer({
        name: "RR",
        paths: [rect],
        extra: {
          vectorOrigination: { keyDescriptorList: [{ keyOriginType: 2, keyOriginShapeBoundingBox: box(20, 10, 70, 110), keyOriginRRectRadii: r }] },
          vectorStroke: { strokeEnabled: true, fillEnabled: true, lineWidth: px(2), lineAlignment: "center", content: { type: "color", color: { r: 0, g: 0, b: 0 } } },
        },
      }),
    ]);
    expect(byName(els, "RR")).toMatchObject({ type: "shape", shape: "rect", cornerRadius: 8, stroke: "#000000", strokeWidth: 2 });
  });

  it("a live ellipse becomes an ellipse shape", async () => {
    const { els } = await importLayers([
      shapeLayer({ name: "E", paths: [rect], extra: { vectorOrigination: { keyDescriptorList: [{ keyOriginType: 5, keyOriginShapeBoundingBox: box(20, 10, 70, 110) }] } } }),
    ]);
    expect(byName(els, "E")).toMatchObject({ type: "shape", shape: "ellipse", x: 10, y: 20, width: 100, height: 50 });
  });

  it("a live shape a shape element can't draw exactly stays a vector", async () => {
    const { els } = await importLayers([
      shapeLayer({
        name: "Out",
        paths: [rect],
        extra: {
          vectorOrigination: { keyDescriptorList: [{ keyOriginType: 1, keyOriginShapeBoundingBox: box(20, 10, 70, 110) }] },
          vectorStroke: { strokeEnabled: true, fillEnabled: true, lineWidth: px(2), lineAlignment: "outside", content: { type: "color", color: { r: 0, g: 0, b: 0 } } },
        },
      }),
    ]);
    expect(byName(els, "Out").type).toBe("vector");
  });
});

describe("psd vector masks", () => {
  it("a vector mask on a pixel layer is kept, in the layer's local units", async () => {
    const { els } = await importLayers([
      pixelLayer({ name: "M", left: 10, top: 20, w: 100, h: 100, extra: { vectorMask: { paths: [polyPath([[30, 40], [80, 40], [80, 90], [30, 90]])] } } }),
    ]);
    const el = byName(els, "M");
    expect(el.type).toBe("image");
    expect(el.vectorMask).toMatchObject({ invert: false, fillRule: "nonzero" });
    const k = el.vectorMask!.subpaths[0].knots[0];
    close(k.x, 20);
    close(k.y, 20);
  });

  it("inverted masks stay inverted; disabled masks are skipped", async () => {
    const path = polyPath([[30, 40], [80, 40], [80, 90], [30, 90]]);
    const { els } = await importLayers([
      pixelLayer({ name: "Inv", w: 100, h: 100, extra: { vectorMask: { paths: [path], invert: true } } }),
      pixelLayer({ name: "Off", w: 100, h: 100, extra: { vectorMask: { paths: [path], disable: true } } }),
    ]);
    expect(byName(els, "Inv").vectorMask?.invert).toBe(true);
    expect(byName(els, "Off").vectorMask).toBeUndefined();
  });

  it("a mask that starts from all pixels gets the document as its first component", async () => {
    const path = polyPath([[30, 40], [80, 40], [80, 90], [30, 90]], { operation: "subtract" });
    const { els } = await importLayers([pixelLayer({ name: "All", left: 10, top: 10, w: 100, h: 100, extra: { vectorMask: { paths: [path], fillStartsWithAllPixels: true } } })]);
    const m = byName(els, "All").vectorMask!;
    expect(m.subpaths.map((s) => s.op)).toEqual(["combine", "subtract"]);
    // The document rect, local to the layer.
    expect(m.subpaths[0].knots[0]).toMatchObject({ x: -10, y: -10 });
  });

  it("no lossy 'vector masks were left out' note any more", async () => {
    const { result } = await importLayers([pixelLayer({ name: "M", w: 10, h: 10, extra: { vectorMask: { paths: [polyPath([[1, 1], [5, 1], [5, 5]])] } } })]);
    expect(result.notes.join(" ")).not.toMatch(/vector mask/i);
    expect(result.lossy).toBe(false);
  });
});

describe("psd shape layers with a pixel mask", () => {
  it("a shape layer with a raster mask keeps its pixels with the mask applied, with a note", async () => {
    // Mask: left half hidden (0), right half shown (255), over the triangle's box 20..80 × 10..70.
    const mw = 60;
    const mh = 60;
    const data = new Uint8ClampedArray(mw * mh * 4);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) data.set(x < 30 ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * mw + x) * 4);
    const mask = { left: 20, top: 10, right: 80, bottom: 70, imageData: { width: mw, height: mh, data } as unknown as ImageData };
    const { els, result } = await importLayers([shapeLayer({ name: "Tri", paths: [triangle()], extra: { mask } })]);
    const el = byName(els, "Tri");
    expect(el.type).toBe("image");
    const node = result.nodes.find((n) => n.name === "Tri")!;
    expect(node.vector).toBeUndefined();
    const rgba = new Uint8ClampedArray(await node.png!.arrayBuffer());
    const alpha = (x: number, y: number) => rgba[(y * node.width + x) * 4 + 3];
    expect(alpha(5, 30)).toBe(0);
    expect(alpha(50, 30)).toBe(255);
    expect(node.issues?.map((i) => i.message).join(" ")).toMatch(/pixel mask kept as image/i);
  });
});

describe("psd stroke miter limit", () => {
  it("a stroke without a miter limit gets Photoshop's 100", async () => {
    const { els } = await importLayers([
      shapeLayer({ name: "S", paths: [triangle()], extra: { vectorStroke: { strokeEnabled: true, lineWidth: px(2), content: { type: "color", color: { r: 0, g: 0, b: 0 } } } } }),
    ]);
    expect(vec(els, "S").miterLimit).toBe(100);
  });
});

describe("psd path limits", () => {
  it("a mask that starts from all pixels stays within 500 subpaths", async () => {
    const paths = Array.from({ length: 520 }, (_, i) => polyPath([[i % 50, 0], [(i % 50) + 1, 0], [(i % 50) + 1, 1]], { operation: "subtract" }));
    const m = readVectorMask({ paths, fillStartsWithAllPixels: true }, { width: 100, height: 100 })!;
    expect(m.subpaths).toHaveLength(500);
    expect(m.subpaths[0].knots[2]).toMatchObject({ x: 100, y: 100 });
  });

  it("past the file's knot budget a shape keeps its pixels and a mask is left out, with notes", async () => {
    const many = (n: number, x0: number) => polyPath(Array.from({ length: n }, (_, i) => [x0 + (i % 40), 10 + Math.floor(i / 40) * 0.01] as [number, number]));
    const { els, result } = await importLayers([
      shapeLayer({ name: "A", paths: [many(4000, 0)] }),
      shapeLayer({ name: "B", paths: [many(4000, 50)] }),
      pixelLayer({ name: "M", w: 40, h: 40, extra: { vectorMask: { paths: [many(4000, 0)] } } }),
    ], { budget: 5000 });
    expect(byName(els, "A").type).toBe("vector");
    expect(byName(els, "B").type).toBe("image");
    expect(byName(els, "M").vectorMask).toBeUndefined();
    const msgs = result.nodes.flatMap((n) => n.issues ?? []).map((i) => i.message).join(" ");
    expect(msgs).toMatch(/too many path points/i);
    expect(KNOT_BUDGET).toBe(200_000);
  });
});
