import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({ saveAsset: vi.fn(), saveDesign: vi.fn(), saveThumb: vi.fn(), listFonts: async () => [] }));
vi.mock("@/lib/render", () => ({ renderThumbnail: vi.fn(() => Promise.reject(new Error("no canvas"))) }));
vi.mock("@/lib/importers/shared", async (orig) => ({
  ...(await orig<typeof import("@/lib/importers/shared")>()),
  fitTextWidth: async (_t: unknown, min: number) => Math.max(min, 100),
}));

import type { Layer } from "ag-psd";
import { Design, type Element, type TextElement } from "@/lib/model";
import { buildDesignFromPsdResult } from "@/lib/importers/psd";
import { convert } from "@/lib/importers/psdConvert";
import { buildPsd, readFixture, textLayer } from "../fixtures/psd";

const io = { encode: async (rgba: Uint8ClampedArray) => new Blob([rgba as Uint8ClampedArray<ArrayBuffer>]) };
const deps = { saveAsset: async () => {} };

async function importLayers(layers: Layer[]) {
  const result = await convert(readFixture(buildPsd(layers, { width: 400, height: 300 })), () => {}, io);
  const { design } = await buildDesignFromPsdResult(result, "text.psd", deps);
  // Whatever the importer made must survive the schema (workfiles parse it).
  expect(Design.safeParse(design).success).toBe(true);
  return { result, design, els: design.pages[0].elements };
}
const textOf = (els: Element[]) => {
  const t = els.find((e) => e.type === "text");
  if (!t || t.type !== "text") throw new Error(`no text: ${els.map((e) => e.type).join()}`);
  return t;
};
const sum = (runs: { length: number }[] | undefined) => (runs ?? []).reduce((n, r) => n + r.length, 0);
const rgb = (r: number, g: number, b: number) => ({ r, g, b });

describe("psd text: style runs", () => {
  it("two style runs become runs with correct lengths summing to text length", async () => {
    const layer = textLayer({
      text: "Big headline",
      left: 10,
      top: 10,
      fontSize: 20,
      font: "Inter-Regular",
      runs: [
        { length: 4, style: { font: { name: "Lora-BoldItalic" }, fontSize: 48, fillColor: rgb(255, 0, 0) } },
        { length: 8, style: { font: { name: "Inter-Regular" }, fontSize: 20, fillColor: rgb(0, 0, 0) } },
      ],
    });
    const t = textOf((await importLayers([layer])).els);
    expect(t.text).toBe("Big headline");
    // The run covering the most characters is the element's own style.
    expect(t).toMatchObject({ fontFamily: "Inter", fontSize: 20, fill: "#000000", bold: false, italic: false });
    expect(t.runs).toEqual([{ length: 4, fontFamily: "Lora", fontSize: 48, fill: "#ff0000", bold: true, italic: true }, { length: 8 }]);
    expect(sum(t.runs)).toBe(t.text.length);
  });

  it("keeps underline, strikethrough, tracking, baseline shift, caps, faux styles and scale per run", async () => {
    const layer = textLayer({
      text: "abcdefgh",
      left: 10,
      top: 10,
      fontSize: 20,
      runs: [
        { length: 2, style: { fontSize: 20, underline: true, strikethrough: true, tracking: 100 } },
        { length: 2, style: { fontSize: 20, baselineShift: 5, fontCaps: 2 } },
        { length: 2, style: { fontSize: 20, fontCaps: 1, fauxBold: true, fauxItalic: true, horizontalScale: 1.5, verticalScale: 0.8 } },
        { length: 2, style: { fontSize: 20 } },
      ],
    });
    const t = textOf((await importLayers([layer])).els);
    expect(t.runs).toEqual([
      { length: 2, underline: true, strike: true, letterSpacing: 2 },
      { length: 2, baselineShift: 5, caps: "all" },
      { length: 2, caps: "small", bold: true, italic: true, scaleX: 1.5, scaleY: 0.8 },
      { length: 2 },
    ]);
  });

  it("superscript becomes a smaller, raised run", async () => {
    const layer = textLayer({
      text: "x2",
      left: 10,
      top: 10,
      fontSize: 30,
      runs: [
        { length: 1, style: { fontSize: 30 } },
        { length: 1, style: { fontSize: 30, fontBaseline: 1 } },
      ],
    });
    const t = textOf((await importLayers([layer])).els);
    expect(t.runs![1].fontSize).toBeCloseTo(30 * 0.583, 2);
    expect(t.runs![1].baselineShift).toBeCloseTo(30 * 0.333, 2);
  });

  it("a single style has no runs (as before)", async () => {
    const t = textOf((await importLayers([textLayer({ text: "Plain", left: 10, top: 10 })])).els);
    expect(t.runs).toBeUndefined();
    expect(t.paragraphs).toBeUndefined();
  });

  it("runs stay fitted when a trailing line break is trimmed", async () => {
    const layer = textLayer({
      text: "ab\r",
      left: 10,
      top: 10,
      fontSize: 20,
      runs: [
        { length: 1, style: { fontSize: 40 } },
        { length: 2, style: { fontSize: 20 } },
      ],
    });
    const t = textOf((await importLayers([layer])).els);
    expect(t.text).toBe("ab");
    expect(sum(t.runs)).toBe(2);
  });
});

describe("psd text: paragraphs", () => {
  it("each paragraph keeps its alignment, indents and spacing", async () => {
    const layer = textLayer({ text: "Title\rBody text\rEnd", left: 10, top: 10, fontSize: 20 });
    layer.text!.paragraphStyleRuns = [
      { length: 6, style: { justification: "center", spaceAfter: 8 } },
      { length: 10, style: { justification: "left", firstLineIndent: 12, startIndent: 4, endIndent: 2, spaceBefore: 3 } },
      { length: 3, style: { justification: "left" } },
    ];
    const { els, design } = await importLayers([layer]);
    const t = textOf(els);
    expect(t.text).toBe("Title\nBody text\nEnd");
    expect(t.align).toBe("left");
    expect(t.paragraphs).toEqual([
      { length: 6, align: "center", spaceAfter: 8 },
      { length: 10, indent: 12, startIndent: 4, endIndent: 2, spaceBefore: 3 },
      { length: 3 },
    ]);
    // Mixed alignment is kept now, so no note about it.
    expect(JSON.stringify(design.importReport ?? {})).not.toMatch(/alignment/i);
  });
});

describe("psd text: transforms", () => {
  it("rotated point text becomes rotated text element", async () => {
    const a = (30 * Math.PI) / 180;
    const layer = textLayer({ text: "Tilted", left: 100, top: 100, fontSize: 20, extra: { left: 90, top: 80, right: 200, bottom: 160 } });
    layer.text!.transform = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 100, 120];
    const { els } = await importLayers([layer]);
    const t = textOf(els);
    expect(t.rotation).toBeCloseTo(30, 3);
    expect(t.fontSize).toBeCloseTo(20, 3);
    // The first baseline's start sits on the anchor: the box's top-left is up the rotated y axis from it.
    const lh = t.lineHeight * t.fontSize;
    const up = lh / 2 + 0.36 * t.fontSize;
    expect(t.x).toBeCloseTo(100 + Math.sin(a) * up, 3);
    expect(t.y).toBeCloseTo(120 - Math.cos(a) * up, 3);
  });

  it("rotated and scaled box text keeps its frame", async () => {
    const a = (-45 * Math.PI) / 180;
    const k = 2;
    const layer = textLayer({ text: "Boxed", left: 50, top: 50, fontSize: 10, runs: [{ length: 5, style: { fontSize: 10, tracking: 50 } }] });
    Object.assign(layer.text!, {
      transform: [k * Math.cos(a), k * Math.sin(a), -k * Math.sin(a), k * Math.cos(a), 200, 100],
      shapeType: "box",
      boxBounds: [0, 0, 80, 40],
    });
    const t = textOf((await importLayers([layer])).els);
    expect(t.rotation).toBeCloseTo(-45, 3);
    expect(t.x).toBeCloseTo(200, 3);
    expect(t.y).toBeCloseTo(100, 3);
    expect(t.width).toBeCloseTo(160, 3);
    expect(t.fontSize).toBeCloseTo(20, 3);
    expect(t.letterSpacing).toBeCloseTo(1, 3);
  });

  it("horizontally stretched text keeps a horizontal scale on its runs", async () => {
    const layer = textLayer({ text: "Wide", left: 10, top: 10, fontSize: 20 });
    layer.text!.transform = [1.5, 0, 0, 1, 10, 30];
    const t = textOf((await importLayers([layer])).els);
    expect(t.fontSize).toBeCloseTo(20, 3);
    expect(t.runs).toEqual([{ length: 4, scaleX: 1.5 }]);
  });

  it("skewed text keeps its pixels with a note", async () => {
    const layer = textLayer({ text: "Skew", left: 10, top: 10, fontSize: 20, extra: { left: 10, top: 10, right: 40, bottom: 40 } });
    layer.imageData = { width: 30, height: 30, data: new Uint8ClampedArray(30 * 30 * 4).fill(255) } as unknown as ImageData;
    layer.text!.transform = [1, 0, 0.4, 1, 10, 30];
    const { els, design } = await importLayers([layer]);
    expect(els.some((e) => e.type === "text")).toBe(false);
    expect(els.some((e) => e.type === "image")).toBe(true);
    expect(design.importReport?.notes.join(" ")).toMatch(/skewed/i);
  });

  it("text with no runs and no transform imports exactly as before", async () => {
    const t = textOf((await importLayers([textLayer({ text: "Hello", left: 5, top: 5, fontSize: 30, color: "#ff0000" })])).els) as TextElement;
    expect(t).toMatchObject({ rotation: 0, fontSize: 30, fill: "#ff0000" });
    expect("runs" in t && t.runs !== undefined).toBe(false);
  });
});
