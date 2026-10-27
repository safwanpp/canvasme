import { describe, expect, it, vi } from "vitest";
import { writePsd } from "ag-psd";
import { createCanvas } from "canvas";

vi.mock("@/lib/storage", () => ({ saveAsset: vi.fn(), saveDesign: vi.fn(), saveThumb: vi.fn(), listFonts: async () => [] }));
vi.mock("@/lib/render", () => ({ renderThumbnail: vi.fn(() => Promise.reject(new Error("no canvas"))) }));
vi.mock("@/lib/importers/shared", async (orig) => ({
  ...(await orig<typeof import("@/lib/importers/shared")>()),
  fitTextWidth: async (_t: unknown, min: number) => min,
}));

import { BLEND_MODES, type BlendMode, type Effects, Effects as EffectsSchema } from "@/lib/effects";
import type { Design, Element } from "@/lib/model";
import { buildDesignFromPsdResult } from "@/lib/importers/psd";
import { convert } from "@/lib/importers/psdConvert";
import {
  ARTBOARD_GAP,
  ARTBOARD_MAX_PIXELS,
  ARTBOARD_MAX_SIDE,
  ARTBOARDS_TOO_BIG,
  artboardLayout,
  buildArtboardPsd,
  buildPsd,
  compositeFits,
  type BuildIo,
  type RenderLayer,
} from "@/lib/importers/psdBuild";
import { ADJUSTMENT_TYPES, defaultAdjustment, defaultFilter } from "@/lib/adjustments";
import { modelAdjustmentToPsd, psdAdjustmentToModel } from "@/lib/importers/psdAdjust";
import { pageSize } from "@/lib/model";
import { readFixture } from "../fixtures/psd";
import { adjEl, groupEl, imageEl, makeDesign, rectEl, rectPath, textEl, vectorEl } from "../fixtures/design";
import type { VectorElement } from "@/lib/model";

const io = { encode: async (rgba: Uint8ClampedArray) => new Blob([rgba as Uint8ClampedArray<ArrayBuffer>]) };
const deps = { saveAsset: async () => {} };

/** A stub renderer: a solid red rectangle over the element's box (non-blank, so the importer keeps it). */
const calls: { id: string; effects: false; el: Element }[] = [];
const stubRender: RenderLayer = async (el, o) => {
  calls.push({ id: el.id, effects: o.effects, el });
  const box = { x: Math.round(el.x), y: Math.round(el.y), width: Math.max(1, Math.round(el.width)), height: Math.max(1, Math.round(el.height)) };
  const c = createCanvas(box.width, box.height);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, box.width, box.height);
  return { canvas: c as unknown as HTMLCanvasElement, box };
};

async function roundTrip(design: Design, bio: BuildIo = {}) {
  const psd = await buildPsd(design, design.pages[0], stubRender, [], bio);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const buf = writePsd(psd, { noBackground: true, invalidateTextLayers: true, logMissingFeatures: true });
  // ag-psd logs any field we set that it can't write.
  expect([...warn.mock.calls, ...log.mock.calls]).toEqual([]);
  warn.mockRestore();
  log.mockRestore();
  const result = await convert(readFixture(buf), () => {}, io);
  const { design: back } = await buildDesignFromPsdResult(result, "x.psd", deps);
  return { psd, back, els: back.pages[0].elements };
}

const byName = (els: Element[], name: string) => {
  const el = els.find((e) => e.name === name);
  if (!el) throw new Error(`no element ${name}: ${els.map((e) => e.name).join(", ")}`);
  return el;
};

/** Deep equality with a numeric tolerance. */
function expectClose(actual: unknown, expected: unknown, tol = 1e-2, path = "$") {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expect(Math.abs((actual as number) - expected), `${path}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol);
    return;
  }
  if (expected && typeof expected === "object") {
    expect(actual && typeof actual === "object", path).toBe(true);
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    expect(Object.keys(a).sort(), path).toEqual(Object.keys(e).filter((k) => e[k] !== undefined).sort());
    for (const k of Object.keys(e)) if (e[k] !== undefined) expectClose(a[k], e[k], tol, `${path}.${k}`);
    return;
  }
  expect(actual, path).toEqual(expected);
}

const grad = {
  style: "linear" as const,
  stops: [
    { offset: 0, color: "#3e3aa8" },
    { offset: 0.4, color: "#ffffff", midpoint: 0.3 },
    { offset: 1, color: "#0e1530" },
  ],
  opacityStops: [
    { offset: 0, opacity: 1 },
    { offset: 1, opacity: 0.25 },
  ],
  angle: 45,
  scale: 1.5,
  reverse: true,
  offset: { x: 0.2, y: -0.1 },
};

const ALL: Effects = {
  dropShadow: [
    { enabled: true, blendMode: "multiply", opacity: 0.35, color: "#000000", angle: 120, distance: 8, size: 16, spread: 0.25, knockout: true },
    { enabled: false, blendMode: "normal", opacity: 0.8, color: "#ff0000", angle: 30, distance: 3, size: 4, spread: 0, knockout: false, contour: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }] },
  ],
  innerShadow: [{ enabled: true, blendMode: "multiply", opacity: 0.5, color: "#112233", angle: 90, distance: 4, size: 6, choke: 0.1 }],
  outerGlow: { enabled: true, blendMode: "screen", opacity: 0.75, color: "#ffd54a", size: 12, spread: 0.2, technique: "precise" },
  innerGlow: { enabled: true, blendMode: "normal", opacity: 0.6, color: "#00ff00", size: 10, choke: 0.3, technique: "softer", source: "center" },
  stroke: [
    { enabled: true, blendMode: "normal", opacity: 1, size: 4, position: "outside", paint: { type: "color", color: "#000000" } },
    { enabled: true, blendMode: "overlay", opacity: 0.5, size: 2, position: "inside", paint: { type: "gradient", gradient: { ...grad, style: "radial", offset: undefined } } },
  ],
  colorOverlay: [
    { enabled: true, blendMode: "color", opacity: 0.4, color: "#3e3aa8" },
    { enabled: true, blendMode: "normal", opacity: 1, color: "#abcdef" },
  ],
  gradientOverlay: [{ enabled: true, blendMode: "soft-light", opacity: 0.9, gradient: grad, alignWithLayer: true }],
};

describe("psd export round trip", () => {
  it("effects round-trip: every kind, several of a kind, disabled ones", async () => {
    const design = makeDesign([rectEl({ name: "Fx", x: 40, y: 40, width: 60, height: 50, effects: ALL })]);
    const { psd, els } = await roundTrip(design);
    // Photoshop reads a missing `enabled` as off: every effect carries it.
    const fx = psd.children![1].effects!;
    expect(fx.dropShadow!.map((e) => e.enabled)).toEqual([true, false]);
    for (const e of [...fx.stroke!, ...fx.solidFill!, ...fx.gradientOverlay!, ...fx.innerShadow!, fx.outerGlow!, fx.innerGlow!]) expect(e.enabled).toBe(true);
    const strip = (e: Effects) => JSON.parse(JSON.stringify(e));
    expectClose(byName(els, "Fx").effects, strip(ALL));
  });

  it("blend modes round-trip for every non-group mode (native and software)", async () => {
    const modes = BLEND_MODES.filter((m) => m !== "pass-through" && m !== "normal") as BlendMode[];
    const design = makeDesign(modes.map((m, i) => rectEl({ name: `B${i}`, x: i * 5, y: 10, width: 4, height: 4, blendMode: m })));
    const { els } = await roundTrip(design);
    modes.forEach((m, i) => expect(byName(els, `B${i}`).blendMode, m).toBe(m));
    // pass-through on a leaf means normal.
    const { els: els2 } = await roundTrip(makeDesign([rectEl({ name: "P", blendMode: "pass-through" })]));
    expect(byName(els2, "P").blendMode).toBeUndefined();
  });

  it("opacity and fill opacity stay separate; hidden survives", async () => {
    const design = makeDesign([
      rectEl({ name: "Faded", opacity: 0.5, fillOpacity: 0.4, effects: { stroke: [ALL.stroke![0]] } }),
      rectEl({ name: "Hidden", hidden: true, opacity: 0.8 }),
    ]);
    const { psd, els } = await roundTrip(design);
    expect(psd.children![1]).toMatchObject({ opacity: 0.5, fillOpacity: 0.4 });
    const f = byName(els, "Faded");
    expect(f.opacity).toBeCloseTo(0.5, 2);
    expect(f.fillOpacity).toBeCloseTo(0.4, 2);
    const h = byName(els, "Hidden");
    expect(h.hidden).toBe(true);
    expect(h.opacity).toBeCloseTo(0.8, 2);
  });

  it("pixels are rendered without effects (Photoshop draws them itself)", async () => {
    calls.length = 0;
    const el = rectEl({ effects: ALL, blendMode: "multiply" });
    await buildPsd(makeDesign([el]), makeDesign([el]).pages[0], stubRender);
    expect(calls.map(({ id, effects }) => ({ id, effects }))).toEqual([{ id: el.id, effects: false }]);
  });

  it("text round-trip stays editable text with the same properties", async () => {
    const t = textEl({
      name: "Title",
      text: "Hello\nworld",
      x: 20,
      y: 30,
      width: 150,
      fontFamily: "Playfair Display",
      fontSize: 32,
      bold: true,
      italic: true,
      underline: true,
      fill: "#3e3aa8",
      align: "center",
      lineHeight: 1.4,
      letterSpacing: 3.2,
      effects: { dropShadow: [ALL.dropShadow![0]] },
    });
    const plain = textEl({ name: "Plain", text: "Body", x: 10, y: 150, width: 80, fontFamily: "Bebas Neue", bold: true, align: "right" });
    const { psd, els } = await roundTrip(makeDesign([t, plain]));
    const layer = psd.children![1];
    expect(layer.text!.style!.font!.name).toBe("PlayfairDisplay-BoldItalic");
    expect(layer.canvas).toBeDefined(); // pixels too, for readers that don't lay out text
    // Bebas Neue has no bold face: faux bold on the regular one.
    expect(psd.children![2].text!.style).toMatchObject({ font: { name: "BebasNeue-Regular" }, fauxBold: true });

    const back = byName(els, "Title");
    expect(back.type).toBe("text");
    if (back.type !== "text") return;
    expect(back).toMatchObject({ text: "Hello\nworld", fontFamily: "Playfair Display", bold: true, italic: true, underline: true, fill: "#3e3aa8", align: "center" });
    expect(back.fontSize).toBeCloseTo(32, 3);
    expect(Math.abs(back.letterSpacing - 3.2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(back.lineHeight - 1.4)).toBeLessThanOrEqual(0.02);
    expect(back.x).toBeCloseTo(20, 3);
    expect(back.y).toBeCloseTo(30, 3);
    expect(back.width).toBeCloseTo(150, 3);
    expectClose(back.effects, JSON.parse(JSON.stringify({ dropShadow: [ALL.dropShadow![0]] })));

    const p = byName(els, "Plain");
    expect(p).toMatchObject({ type: "text", text: "Body", fontFamily: "Bebas Neue", bold: true, align: "right" });
  });

  it("an element with no effects exports exactly as before", async () => {
    const el = imageEl({ name: "Plain", x: 10, y: 20, width: 30, height: 40, opacity: 0.7 });
    const psd = await buildPsd(makeDesign([el]), makeDesign([el]).pages[0], stubRender);
    const layer = psd.children![1];
    expect(Object.keys(layer).sort()).toEqual(["canvas", "hidden", "left", "name", "opacity", "top"]);
    expect(layer).toMatchObject({ name: "Plain", opacity: 0.7, hidden: false, left: 10, top: 20 });
    expect(psd.children![0].name).toBe("Background");
  });

  it("groups export as folders with their own opacity, blend, visibility and fold state", async () => {
    const a = rectEl({ name: "A", groupId: "g" });
    const b = rectEl({ name: "B", groupId: "g", blendMode: "screen" });
    const g = groupEl({ id: "g", name: "Card", opacity: 0.5, blendMode: "multiply", collapsed: true });
    const d = makeDesign([a, b, g]);
    const psd = await buildPsd(d, d.pages[0], stubRender);
    expect(psd.children![1]).toMatchObject({ name: "Card", opened: false, opacity: 0.5, blendMode: "multiply", hidden: false });
    expect(psd.children![1].children!.map((l) => l.blendMode)).toEqual([undefined, "screen"]);
  });

  it("a pass-through group is written as pass through, a normal one as normal", async () => {
    const d = makeDesign([rectEl({ groupId: "p" }), groupEl({ id: "p", name: "P" }), rectEl({ groupId: "n" }), groupEl({ id: "n", name: "N", blendMode: "normal" })]);
    const psd = await buildPsd(d, d.pages[0], stubRender);
    expect(psd.children![1]).toMatchObject({ name: "P", blendMode: "pass through" });
    expect(psd.children![2]).toMatchObject({ name: "N", blendMode: "normal" });
  });

  it("nested groups round-trip with opacity, blend, effects and hidden", async () => {
    const effects = EffectsSchema.parse({ dropShadow: [{ color: "#000000", angle: 90, distance: 4, size: 5 }] });
    const design = makeDesign([
      rectEl({ name: "Under" }),
      rectEl({ name: "A", groupId: "outer", x: 10, y: 10, width: 20, height: 20 }),
      rectEl({ name: "B", groupId: "inner", x: 40, y: 40, width: 20, height: 20, opacity: 0.5 }),
      groupEl({ id: "inner", name: "Inner", groupId: "outer", opacity: 0.4, hidden: true }),
      groupEl({ id: "outer", name: "Outer", opacity: 0.8, blendMode: "multiply", effects }),
    ]);
    const { els } = await roundTrip(design);
    expect(els.map((e) => e.name)).toEqual(["Background", "Under", "A", "B", "Inner", "Outer"]);
    const outer = byName(els, "Outer");
    const inner = byName(els, "Inner");
    expect(outer).toMatchObject({ type: "group", groupId: null, blendMode: "multiply" });
    expect(outer.opacity).toBeCloseTo(0.8, 2);
    expect(outer.effects?.dropShadow?.[0]).toMatchObject({ distance: 4, size: 5 });
    expect(inner).toMatchObject({ type: "group", groupId: outer.id, hidden: true });
    expect(inner.opacity).toBeCloseTo(0.4, 2);
    expect(byName(els, "B")).toMatchObject({ groupId: inner.id, hidden: false });
    expect(byName(els, "B").opacity).toBeCloseTo(0.5, 2);
    // Group folders carry no pixels of their own.
    expect(calls.some((c) => c.id === "outer" || c.id === "inner")).toBe(false);
  });
});

describe("psd export: clipping", () => {
  it("clipping round-trip: clipped layers, a group base and a clipped group", async () => {
    const design = makeDesign([
      rectEl({ name: "Base" }),
      rectEl({ name: "C1", clipped: true }),
      rectEl({ name: "C2", clipped: true, blendMode: "multiply" }),
      rectEl({ name: "M", groupId: "g" }),
      groupEl({ id: "g", name: "G" }),
      rectEl({ name: "N", groupId: "h" }),
      groupEl({ id: "h", name: "H", clipped: true }),
    ]);
    const { psd, els } = await roundTrip(design);
    expect(psd.children!.map((l) => [l.name, l.clipping])).toEqual([
      ["Background", undefined],
      ["Base", undefined],
      ["C1", true],
      ["C2", true],
      ["G", undefined],
      ["H", true],
    ]);
    expect(els.map((e) => [e.name, !!e.clipped])).toEqual([
      ["Background", false],
      ["Base", false],
      ["C1", true],
      ["C2", true],
      ["M", false],
      ["G", false],
      ["N", false],
      ["H", true],
    ]);
    expect(byName(els, "C2").blendMode).toBe("multiply");
  });
});

describe("psd export: vectors and vector masks", () => {
  const curved: VectorElement["subpaths"] = [
    {
      closed: true,
      op: "combine",
      knots: [
        { x: 0, y: 40, inX: 0, inY: 60, outX: 0, outY: 10 },
        { x: 60, y: 0, inX: 20, inY: 0, outX: 90, outY: 0 },
        { x: 120, y: 40, inX: 120, inY: 10, outX: 120, outY: 70 },
        { x: 60, y: 80, inX: 100, inY: 80, outX: 20, outY: 80 },
      ],
    },
    rectPath(40, 30, 40, 20, "subtract"),
    rectPath(50, 35, 10, 10),
  ];

  it("vector knots, ops, fill rule, stroke and fill round-trip as a shape layer", async () => {
    const v = vectorEl({
      name: "Blob",
      x: 30.5,
      y: 20.25,
      width: 120,
      height: 80,
      subpaths: curved,
      fillRule: "nonzero",
      fill: { type: "gradient", gradient: { ...grad, offset: undefined } },
      stroke: { type: "color", color: "#00ff0080" },
      strokeWidth: 3,
      strokeAlign: "outside",
      lineCap: "round",
      lineJoin: "bevel",
      dash: [2, 1],
      miterLimit: 7,
      effects: { dropShadow: [ALL.dropShadow![0]] },
    });
    const { psd, els } = await roundTrip(makeDesign([v]));
    const layer = psd.children![1];
    expect(layer.vectorMask?.paths).toHaveLength(3);
    expect(layer.vectorFill?.type).toBe("solid");
    expect(layer.vectorStroke).toMatchObject({ strokeEnabled: true, fillEnabled: true, lineAlignment: "outside" });
    expect(layer.canvas).toBeDefined();
    expect(layer.vectorOrigination).toBeUndefined();
    // [in, anchor, out] of the first knot, in document px (asymmetric, so a swapped order fails).
    expect(layer.vectorMask?.paths?.[0].knots?.[0].points).toEqual([30.5, 80.25, 30.5, 60.25, 30.5, 30.25]);
    const back = byName(els, "Blob") as VectorElement;
    expect(back.type).toBe("vector");
    expect(Math.abs(back.x - v.x)).toBeLessThan(0.01);
    expect(Math.abs(back.y - v.y)).toBeLessThan(0.01);
    expectClose(back.subpaths, v.subpaths, 0.01);
    expect(back).toMatchObject({ fillRule: "nonzero", strokeAlign: "outside", lineCap: "round", lineJoin: "bevel", stroke: { type: "color", color: "#00ff0080" } });
    expect(back.strokeWidth).toBeCloseTo(3, 3);
    expectClose(back.dash, [2, 1], 0.01);
    expect(layer.vectorStroke?.lineDashSet).toEqual([{ units: "None", value: 2 }, { units: "None", value: 1 }]);
    expect(layer.vectorStroke?.miterLimit).toBe(7);
    expect(back.miterLimit).toBe(7);
    expect(back.fill?.type).toBe("gradient");
    if (back.fill?.type === "gradient") expectClose(back.fill.gradient, { ...grad, offset: undefined }, 1e-2);
    expect(back.effects?.dropShadow).toHaveLength(1);
  });

  it("the fill rule round-trips: non-zero as is, an even-odd component as exclude operations", async () => {
    // Photoshop has no even-odd shapes (and its usual path flag reads as even-odd in ag-psd), so
    // even-odd goes out as the same region in operations: each later subpath of the first component excludes.
    const ring = [rectPath(0, 0, 100, 100, "combine"), rectPath(25, 25, 50, 50)];
    const { psd, els } = await roundTrip(makeDesign([vectorEl({ name: "Ring", subpaths: ring, fillRule: "evenodd" }), vectorEl({ name: "Nz", subpaths: ring })]));
    expect(psd.children![1].vectorMask?.paths.map((p) => p.operation)).toEqual(["combine", "exclude"]);
    const r = byName(els, "Ring") as VectorElement;
    expect(r.fillRule).toBe("nonzero");
    expect(r.subpaths.map((s) => s.op)).toEqual(["combine", "exclude"]);
    const n = byName(els, "Nz") as VectorElement;
    expect(n.fillRule).toBe("nonzero");
    expect(n.subpaths.map((s) => s.op)).toEqual(["combine", undefined]);
  });

  it("what is written as live vector data isn't also baked into the pixels", async () => {
    calls.length = 0;
    const mask = { subpaths: [rectPath(10, 10, 30, 20, "combine")], fillRule: "nonzero" as const, invert: false };
    const v = vectorEl({ id: "v", stroke: { type: "color", color: "#000000" }, strokeWidth: 4 });
    await roundTrip(makeDesign([v, imageEl({ id: "i", vectorMask: mask })]));
    const sent = (id: string) => calls.find((c) => c.id === id)!.el;
    // The shape layer's stroke is Photoshop's to draw (vectorStroke); its pixels are the fill alone.
    expect(sent("v")).toMatchObject({ stroke: null, strokeWidth: 0 });
    // A layer's vector mask is written live, so its pixels are unmasked.
    expect(sent("i").vectorMask).toBeUndefined();
  });

  it("a translucent fill with no stroke stays a shape layer, its alpha as fill opacity", async () => {
    const d = makeDesign([
      rectEl({ name: "Glass", x: 10, y: 10, width: 40, height: 30, fill: "#33669980" }),
      vectorEl({ name: "Veil", fill: { type: "color", color: "#ff000040" }, stroke: null, strokeWidth: 0, fillOpacity: 0.5 }),
    ]);
    const { psd, els } = await roundTrip(d);
    expect(psd.children![1].vectorMask).toBeDefined();
    expect(psd.children![1].fillOpacity).toBeCloseTo(128 / 255, 3);
    const g = byName(els, "Glass") as VectorElement;
    expect(g.type).toBe("vector");
    expect(g.fill).toEqual({ type: "color", color: "#336699" });
    expect(g.fillOpacity!).toBeCloseTo(128 / 255, 2);
    const v = byName(els, "Veil") as VectorElement;
    expect(v.fillOpacity!).toBeCloseTo((64 / 255) * 0.5, 2);
  });

  it("a translucent fill with a stroke falls back to pixels", async () => {
    const d = makeDesign([rectEl({ name: "Edged", fill: "#33669980", stroke: "#ff0000", strokeWidth: 3 }), vectorEl({ name: "Edged vec", fill: { type: "color", color: "#00ff0080" }, stroke: { type: "color", color: "#000000" }, strokeWidth: 2 })]);
    calls.length = 0;
    const { psd } = await roundTrip(d);
    for (const i of [1, 2]) {
      expect(psd.children![i].vectorMask).toBeUndefined();
      expect(psd.children![i].vectorFill).toBeUndefined();
      expect(psd.children![i].canvas).toBeDefined();
    }
    // The stroke stays in the pixels.
    expect(calls[1].el).toMatchObject({ type: "vector", strokeWidth: 2 });
  });

  it("a vector with its own vector mask keeps the mask and its pixels", async () => {
    const mask = { subpaths: [rectPath(10, 10, 30, 20, "combine")], fillRule: "nonzero" as const, invert: true };
    calls.length = 0;
    const { psd, els } = await roundTrip(makeDesign([vectorEl({ name: "Masked vec", x: 5, y: 6, vectorMask: mask })]));
    const layer = psd.children![1];
    expect(layer.vectorFill).toBeUndefined();
    expect(layer.canvas).toBeDefined();
    expect(layer.vectorMask).toMatchObject({ invert: true });
    expect(layer.vectorMask!.paths).toHaveLength(1);
    // The mask is Photoshop's to apply, so the pixels are unmasked.
    expect(calls[0].el.vectorMask).toBeUndefined();
    expect(byName(els, "Masked vec").vectorMask?.invert).toBe(true);
  });

  it("a vector with filters is written as pixels, with the note", async () => {
    const notes: string[] = [];
    const d = makeDesign([vectorEl({ name: "Soft", filters: [{ type: "blur", radius: 3 }] })]);
    const psd = await buildPsd(d, d.pages[0], stubRender, notes);
    expect(psd.children![1].vectorMask).toBeUndefined();
    expect(psd.children![1].vectorFill).toBeUndefined();
    expect(psd.children![1].canvas).toBeDefined();
    expect(notes.some((n) => /Filters/.test(n))).toBe(true);
  });

  it("no fill and no stroke are written as disabled", async () => {
    const v = vectorEl({ name: "Line", fill: null, stroke: { type: "color", color: "#000000" }, strokeWidth: 2 });
    const { psd, els } = await roundTrip(makeDesign([v]));
    expect(psd.children![1].vectorStroke).toMatchObject({ fillEnabled: false, strokeEnabled: true });
    expect(byName(els, "Line")).toMatchObject({ type: "vector", fill: null });
    const { els: e2 } = await roundTrip(makeDesign([vectorEl({ name: "Plain" })]));
    expect(byName(e2, "Plain")).toMatchObject({ type: "vector", stroke: null, strokeWidth: 0, fill: { type: "color", color: "#ff0000" } });
  });

  it("a rotated vector is written with its rotation in the knots", async () => {
    const v = vectorEl({ name: "Rot", x: 100, y: 50, rotation: 90, subpaths: [rectPath(0, 0, 100, 40, "combine")], width: 100, height: 40 });
    const { els } = await roundTrip(makeDesign([v]));
    const back = byName(els, "Rot") as VectorElement;
    // Rotated 90° about its origin: it now spans x 60..100, y 50..150.
    expect(back.rotation).toBe(0);
    expectClose({ x: back.x, y: back.y, w: back.width, h: back.height }, { x: 60, y: 50, w: 40, h: 100 }, 0.01);
  });

  it("shapes export as vectors and reimport as vectors", async () => {
    const d = makeDesign([
      rectEl({ name: "Card", x: 10, y: 20, width: 60, height: 40, cornerRadius: 8, fill: "#336699", stroke: "#ff0000", strokeWidth: 4 }),
      rectEl({ name: "Oval", shape: "ellipse", x: 80, y: 20, width: 50, height: 30 }),
      rectEl({ name: "Tri", shape: "triangle", x: 10, y: 90, width: 40, height: 30 }),
      rectEl({ name: "Filtered", x: 60, y: 90, filters: [{ type: "blur", radius: 2 }] }),
    ]);
    const { psd, els } = await roundTrip(d);
    expect(psd.children![1].vectorMask?.paths).toHaveLength(1);
    expect(psd.children![1].vectorMask?.paths?.[0].knots).toHaveLength(8);
    expect(psd.children![1].vectorFill).toMatchObject({ type: "color" });
    expect(psd.children![1].vectorOrigination).toBeUndefined();
    const card = byName(els, "Card") as VectorElement;
    expect(card.type).toBe("vector");
    expect(card).toMatchObject({ fill: { type: "color", color: "#336699" }, stroke: { type: "color", color: "#ff0000" } });
    expect(card.strokeWidth).toBeCloseTo(4, 3);
    expect(card.subpaths[0].knots).toHaveLength(8);
    expect(Math.abs(card.x - 10)).toBeLessThan(0.01);
    expect(Math.abs(card.width - 60)).toBeLessThan(0.01);
    expect(byName(els, "Oval").type).toBe("vector");
    expect((byName(els, "Tri") as VectorElement).subpaths[0].knots).toHaveLength(3);
    // Shapes with filters keep their pixels.
    expect(psd.children![4].vectorMask).toBeUndefined();
  });

  it("an image clipped to a shape also carries the shape as a vector mask", async () => {
    const shape = rectEl({ shape: "ellipse", x: 0, y: 0, width: 50, height: 30 });
    const img = imageEl({ name: "Clipped", x: 20, y: 10, width: 50, height: 30, mask: { shape, image: { x: 0, y: 0, width: 50, height: 30, rotation: 0 }, shapeAbove: false } });
    const { psd, els } = await roundTrip(makeDesign([img]));
    expect(psd.children![1].canvas).toBeDefined();
    expect(psd.children![1].vectorMask?.paths).toHaveLength(1);
    const back = byName(els, "Clipped");
    expect(back.vectorMask?.subpaths[0].knots).toHaveLength(4);
    expectClose(back.vectorMask?.subpaths[0].knots[1], { x: 50, y: 15, inX: 50, inY: 15 - 15 * 0.5522847498, outX: 50, outY: 15 + 15 * 0.5522847498 }, 0.01);
  });

  it("vector masks round-trip on shapes and images, inversion included", async () => {
    const mask = { subpaths: [rectPath(10, 10, 30, 20, "combine")], fillRule: "nonzero" as const, invert: true };
    const d = makeDesign([rectEl({ name: "Masked", x: 20, y: 30, vectorMask: mask }), imageEl({ name: "Pic", x: 40, y: 40, vectorMask: { ...mask, invert: false } })]);
    const { psd, els } = await roundTrip(d);
    expect(psd.children![1].vectorMask).toMatchObject({ invert: true });
    const m = byName(els, "Masked");
    // Re-imported as a pixel layer of the stub's box, so the mask is local to the same origin.
    expectClose(m.vectorMask, mask, 0.01);
    expectClose(byName(els, "Pic").vectorMask, { ...mask, invert: false }, 0.01);
  });
});

describe("psd export: rich text", () => {
  const rich = () =>
    textEl({
      name: "Rich",
      text: "Big title\nsmall body text",
      x: 20,
      y: 30,
      width: 160,
      fontFamily: "Inter",
      fontSize: 16,
      fill: "#000000",
      align: "left",
      lineHeight: 1.3,
      runs: [
        { length: 3, fontFamily: "Playfair Display", fontSize: 40, bold: true, fill: "#ff0000" },
        { length: 7, italic: true, underline: true },
        { length: 5, strike: true, letterSpacing: 2, baselineShift: 3 },
        { length: 5, caps: "all", scaleX: 1.5 },
        { length: 5, caps: "small", scaleY: 0.8 },
      ],
      paragraphs: [
        { length: 10, align: "center", spaceAfter: 6 },
        { length: 15, indent: 12, startIndent: 4, endIndent: 2, spaceBefore: 3 },
      ],
    });

  it("style runs and paragraph runs are written as Photoshop runs", async () => {
    const el = rich();
    const { psd } = await roundTrip(makeDesign([el]));
    const t = psd.children![1].text!;
    expect(t.styleRuns!.map((r) => r.length)).toEqual([3, 7, 5, 5, 5]);
    expect(t.styleRuns![0].style).toMatchObject({ font: { name: "PlayfairDisplay-Bold" }, fontSize: 40, fillColor: { r: 255, g: 0, b: 0 } });
    expect(t.styleRuns![2].style).toMatchObject({ strikethrough: true, baselineShift: 3 });
    expect(t.styleRuns![3].style).toMatchObject({ fontCaps: 2, horizontalScale: 1.5 });
    expect(t.paragraphStyleRuns!.map((r) => r.length)).toEqual([10, 15]);
    expect(t.paragraphStyleRuns![0].style).toMatchObject({ justification: "center", spaceAfter: 6 });
  });

  it("runs and paragraphs round-trip", async () => {
    const el = rich();
    const { els } = await roundTrip(makeDesign([el]));
    const back = byName(els, "Rich");
    if (back.type !== "text") throw new Error("not text");
    expect(back).toMatchObject({ text: el.text, fontFamily: "Inter", fontSize: 16, align: "left" });
    expectClose(back.runs, el.runs, 0.01);
    expectClose(back.paragraphs, el.paragraphs, 0.01);
    expect(back.x).toBeCloseTo(20, 3);
    expect(back.y).toBeCloseTo(30, 3);
  });

  it("rotated text comes back as rotated editable text", async () => {
    const el = textEl({ name: "Turned", text: "Turned it", x: 60, y: 40, width: 120, rotation: 30, runs: [{ length: 3, fontSize: 36 }, { length: 6 }] });
    const { els } = await roundTrip(makeDesign([el]));
    const back = byName(els, "Turned");
    expect(back.type).toBe("text");
    if (back.type !== "text") return;
    expect(back.rotation).toBeCloseTo(30, 3);
    expect(back.x).toBeCloseTo(60, 3);
    expect(back.y).toBeCloseTo(40, 3);
    expect(back.width).toBeCloseTo(120, 3);
    // The element's own style is what most characters use.
    expect(back.runs).toEqual([{ length: 3, fontSize: 36 }, { length: 6 }]);
  });
});

function write(psd: Awaited<ReturnType<typeof buildPsd>>) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const buf = writePsd(psd, { noBackground: true, invalidateTextLayers: true, logMissingFeatures: true });
  expect([...warn.mock.calls, ...log.mock.calls]).toEqual([]);
  warn.mockRestore();
  log.mockRestore();
  return buf;
}

/** Pages as artboards, written and read back through the importer. */
async function boardsRoundTrip(design: Design, bio: BuildIo = {}) {
  const notes: string[] = [];
  const psd = await buildArtboardPsd(design, design.pages, stubRender, notes, bio);
  const result = await convert(readFixture(write(psd)), () => {}, io);
  const { design: back } = await buildDesignFromPsdResult(result, "x.psd", deps);
  return { psd, back, notes };
}

describe("psd export: adjustments", () => {
  it("adjustments round-trip (each type)", async () => {
    const els = ADJUSTMENT_TYPES.map((t, i) => adjEl({ name: `A${i}`, adjustment: defaultAdjustment(t), opacity: 0.8, blendMode: i % 2 ? "multiply" : undefined }));
    const { psd, els: back } = await roundTrip(makeDesign([rectEl({ name: "Base" }), ...els]));
    expect(psd.children!.slice(2).every((l) => l.adjustment && !l.canvas)).toBe(true);
    ADJUSTMENT_TYPES.forEach((t, i) => {
      const got = byName(back, `A${i}`);
      expect(got.type, t).toBe("adjustment");
      if (got.type !== "adjustment") return;
      // What the importer makes of the exported layer is what it makes of the exported mapping.
      expect(got.adjustment, t).toEqual(psdAdjustmentToModel(modelAdjustmentToPsd(defaultAdjustment(t))));
      expect(got.adjustment.type).toBe(t);
      expect(got.opacity).toBeCloseTo(0.8, 2);
      expect(got.blendMode).toBe(i % 2 ? "multiply" : undefined);
    });
  });

  it("an adjustment keeps its clipping, hidden state and sits inside groups", async () => {
    const g = groupEl({ name: "G" });
    const inner = adjEl({ name: "In", groupId: g.id, hidden: true, clipped: true });
    const { els } = await roundTrip(makeDesign([g, rectEl({ name: "Base", groupId: g.id }), inner]));
    const got = byName(els, "In");
    expect(got).toMatchObject({ type: "adjustment", hidden: true, clipped: true });
    expect(got.groupId).toBe(byName(els, "G").id);
  });

  it("the raster mask is written as the layer mask", async () => {
    const data = new Uint8ClampedArray(6 * 4 * 4);
    for (let i = 0; i < 24; i++) data.set([i * 10, 0, 0, 255], i * 4);
    const loadMask = vi.fn(async (_id: string, width: number, height: number) => ({ width, height, data }));
    const el = adjEl({ name: "M", rasterMask: { assetId: "m1", x: 10, y: 20, width: 6, height: 4, outside: 1 } });
    const { psd, els } = await roundTrip(makeDesign([rectEl({ name: "Base" }), el]), { loadMask });
    expect(loadMask).toHaveBeenCalledWith("m1", 6, 4);
    const layer = psd.children!.find((l) => l.name === "M")!;
    expect(layer.mask).toMatchObject({ left: 10, top: 20, right: 16, bottom: 24, defaultColor: 255 });
    expect(Array.from(layer.mask!.imageData!.data.slice(0, 8))).toEqual([0, 0, 0, 255, 10, 0, 0, 255]);
    const back = byName(els, "M");
    expect(back.type === "adjustment" && back.rasterMask).toMatchObject({ x: 10, y: 20, width: 6, height: 4, outside: 1 });
  });

  it("a mask that can't be read is left out with a note", async () => {
    const el = adjEl({ name: "M", rasterMask: { assetId: "gone", x: 0, y: 0, width: 4, height: 4 } });
    const notes: string[] = [];
    const psd = await buildPsd(makeDesign([el]), makeDesign([el]).pages[0], stubRender, notes, { loadMask: async () => null });
    expect(psd.children![1].mask).toBeUndefined();
    expect(notes.join(" ")).toMatch(/mask/);
  });
});

describe("psd export: filters", () => {
  it("filters baked and noted", async () => {
    calls.length = 0;
    const el = rectEl({ name: "Soft", filters: [defaultFilter("blur")] });
    const notes: string[] = [];
    const d = makeDesign([el]);
    const psd = await buildPsd(d, d.pages[0], stubRender, notes);
    // Rendered with its filters on and effects off, written as a plain pixel layer.
    const call = calls.find((c) => c.id === el.id)!;
    expect(call.effects).toBe(false);
    expect(call.el.filters).toHaveLength(1);
    expect(psd.children![1]).toMatchObject({ name: "Soft" });
    expect(psd.children![1].canvas).toBeTruthy();
    expect(psd.children![1].vectorMask).toBeUndefined();
    expect(notes.filter((n) => /Filters/.test(n))).toHaveLength(1);
  });
});

describe("psd export: artboards", () => {
  const twoPages = () => {
    const d = makeDesign([rectEl({ name: "One", x: 10, y: 20, width: 30, height: 40 })], { width: 200, height: 100, background: "#336699" });
    d.pages.push({
      id: "p2",
      background: "#ffffff",
      width: 120,
      height: 300,
      elements: [rectEl({ name: "Two", x: 5, y: 6, width: 20, height: 30 }), adjEl({ name: "Adj", width: 120, height: 300 })],
    });
    return d;
  };

  it("pages export as artboards and reimport as pages", async () => {
    const d = twoPages();
    const { psd, back, notes } = await boardsRoundTrip(d);
    expect(notes).toEqual([]);
    expect(psd.children).toHaveLength(2);
    expect(back.pages).toHaveLength(2);
    expect(back.pages[0].background).toBe("#336699");
    expect(back.pages[1].background).toBe("#ffffff");
    expect(back.pages[0].elements.map((e) => e.name)).toEqual(["One"]);
    expect(back.pages[1].elements.map((e) => e.name)).toEqual(["Two", "Adj"]);
    expect(back.pages[0].elements[0]).toMatchObject({ x: 10, y: 20, width: 30, height: 40 });
    expect(back.pages[1].elements[0]).toMatchObject({ x: 5, y: 6, width: 20, height: 30 });
    expect(back.pages[1].elements[1].type).toBe("adjustment");
  });

  it("mixed page sizes round-trip per artboard", async () => {
    const d = twoPages();
    const { psd, back } = await boardsRoundTrip(d);
    // A row with gaps, as tall as the tallest page.
    expect(psd.width).toBe(200 + ARTBOARD_GAP + 120);
    expect(psd.height).toBe(300);
    expect(psd.children!.map((l) => l.artboard!.rect)).toEqual([
      { left: 0, top: 0, right: 200, bottom: 100 },
      { left: 300, top: 0, right: 420, bottom: 300 },
    ]);
    expect(pageSize(back, back.pages[0])).toEqual({ width: 200, height: 100 });
    expect(pageSize(back, back.pages[1])).toEqual({ width: 120, height: 300 });
  });

  it("text, vectors and masks move with their artboard", async () => {
    const d = twoPages();
    d.pages[1].elements.push(
      textEl({ name: "Words", text: "Hi there", x: 7, y: 9, width: 90 }),
      vectorEl({ name: "Vec" }),
    );
    const { psd, back } = await boardsRoundTrip(d);
    const words = (psd.children![1].children ?? []).find((l) => l.name === "Words")!;
    expect(words.text!.transform![4]).toBe(307);
    const vec = byName(back.pages[1].elements, "Vec");
    const orig = d.pages[1].elements.find((e) => e.name === "Vec")!;
    expect(vec.x).toBeCloseTo(orig.x, 1);
    expect(vec.y).toBeCloseTo(orig.y, 1);
    expect(byName(back.pages[1].elements, "Words")).toMatchObject({ type: "text", x: 7, y: 9 });
  });
});

describe("psd export: artboard grid and limits", () => {
  const pages = (n: number, w: number, h: number) => {
    const d = makeDesign([rectEl({ name: "P1", x: 10, y: 10, width: 20, height: 20 })], { width: w, height: h });
    for (let i = 1; i < n; i++) d.pages.push({ id: `p${i}`, background: "#ffffff", elements: [rectEl({ name: `P${i + 1}`, x: 10, y: 10, width: 20, height: 20 })] });
    return d;
  };

  it("pages that don't fit one 30000 px row wrap into a grid, in reading order", async () => {
    const d = pages(30, 1080, 1080);
    const { psd, back } = await boardsRoundTrip(d);
    // 30 in a row would be 35,300 px; two rows of 15 are the fewest rows within the caps.
    expect([psd.width, psd.height]).toEqual([15 * 1080 + 14 * ARTBOARD_GAP, 2 * 1080 + ARTBOARD_GAP]);
    const rects = psd.children!.map((l) => l.artboard!.rect);
    expect(rects[1]).toEqual({ left: 1180, top: 0, right: 2260, bottom: 1080 });
    expect(rects[15]).toEqual({ left: 0, top: 1180, right: 1080, bottom: 2260 });
    expect(rects[29]).toEqual({ left: 14 * 1180, top: 1180, right: 14 * 1180 + 1080, bottom: 2260 });
    expect(Math.max(psd.width, psd.height)).toBeLessThanOrEqual(ARTBOARD_MAX_SIDE);
    // Read back as 30 pages in the same order, each element where it was on its page.
    expect(back.pages).toHaveLength(30);
    back.pages.forEach((p, i) => {
      expect(p.elements.map((e) => e.name)).toEqual([`P${i + 1}`]);
      // Vector knots are fixed-point fractions of the document size, so far pages lose a little.
      expect(p.elements[0].x).toBeCloseTo(10, 2);
      expect(p.elements[0].y).toBeCloseTo(10, 2);
      expect(pageSize(back, p)).toEqual({ width: 1080, height: 1080 });
    });
  });

  it("a row that fits stays one row; mixed rows are as tall as their tallest page", () => {
    expect(artboardLayout([{ width: 200, height: 100 }, { width: 120, height: 300 }])).toEqual({
      width: 420,
      height: 300,
      rects: [
        { left: 0, top: 0, right: 200, bottom: 100 },
        { left: 300, top: 0, right: 420, bottom: 300 },
      ],
    });
    const wide = artboardLayout([{ width: 8000, height: 500 }, { width: 8000, height: 900 }, { width: 8000, height: 500 }, { width: 8000, height: 700 }]);
    // One row would be 32,300 px. Of the two-row grids, 2 + 2 is smaller than 3 + 1.
    expect(wide.rects.map((r) => [r.left, r.top])).toEqual([[0, 0], [8100, 0], [0, 1000], [8100, 1000]]);
    expect([wide.width, wide.height]).toEqual([16100, 1700]);
  });

  it("refuses, before rendering anything, when the document would pass 50 M px", async () => {
    calls.length = 0;
    const d = pages(30, 4000, 4000);
    await expect(buildArtboardPsd(d, d.pages, stubRender)).rejects.toThrow(ARTBOARDS_TOO_BIG);
    expect(ARTBOARDS_TOO_BIG).toMatch(/export the current page instead/);
    expect(calls).toHaveLength(0);
    expect(() => artboardLayout(Array.from({ length: 4 }, () => ({ width: 8000, height: 8000 })))).toThrow(ARTBOARDS_TOO_BIG);
    // Just under the budget still exports.
    expect(() => artboardLayout([{ width: 5000, height: 4000 }, { width: 5000, height: 4000 }])).not.toThrow();
    expect(ARTBOARD_MAX_PIXELS).toBe(50_000_000);
  });

  it("an adjustment's layer mask moves with its artboard", async () => {
    const d = makeDesign([rectEl({ name: "One" })], { width: 200, height: 100 });
    d.pages.push({
      id: "p2",
      background: "#ffffff",
      width: 120,
      height: 300,
      elements: [rectEl({ name: "Two" }), adjEl({ name: "Masked", width: 120, height: 300, rasterMask: { assetId: "m1", x: 10, y: 20, width: 6, height: 4, outside: 1 } })],
    });
    const data = new Uint8ClampedArray(6 * 4 * 4).fill(255);
    const { psd, back } = await boardsRoundTrip(d, { loadMask: async (_id, width, height) => ({ width, height, data }) });
    const layer = psd.children![1].children!.find((l) => l.name === "Masked")!;
    expect(layer.mask).toMatchObject({ left: 310, top: 20, right: 316, bottom: 24 });
    const got = byName(back.pages[1].elements, "Masked");
    expect(got.type === "adjustment" && got.rasterMask).toMatchObject({ x: 10, y: 20, width: 6, height: 4, outside: 1 });
  });
});

describe("psd export: composite cap and colorize", () => {
  it("a very wide artboard document is over the composite cap and still writes without one", async () => {
    const d = makeDesign([rectEl({ name: "R", width: 20, height: 20 })], { width: 1080, height: 1920 });
    for (let i = 1; i < 5; i++) d.pages.push({ id: `p${i}`, background: "#ffffff", elements: [] });
    const psd = await buildArtboardPsd(d, d.pages, stubRender);
    expect(psd.width).toBe(5 * 1080 + 4 * ARTBOARD_GAP);
    expect(compositeFits(psd.width, psd.height)).toBe(false);
    expect(compositeFits(4096, 3906)).toBe(true);
    expect(compositeFits(4097, 10)).toBe(false);
    expect(psd.canvas).toBeUndefined();
    const buf = write(psd);
    const back = readFixture(buf);
    expect(back.children).toHaveLength(5);
    expect([back.width, back.height]).toEqual([psd.width, 1920]);
  });

  it("colorize round-trips: the flag and values are in the hue2 record's first words", async () => {
    const tint = adjEl({ name: "Tint", adjustment: { type: "hue-saturation", colorize: true, master: { hue: 300, saturation: 25, lightness: -10 } } });
    const plain = adjEl({ name: "Plain", adjustment: { type: "hue-saturation", colorize: false, master: { hue: -40, saturation: 10, lightness: 0 } } });
    const d = makeDesign([rectEl({ name: "Base" }), tint, plain]);
    const notes: string[] = [];
    const psd = await buildPsd(d, d.pages[0], stubRender, notes);
    expect(notes).toEqual([]);
    const buf = write(psd);
    // The raw records: '8BIM' 'hue2', a 4-byte length, version 2, then colorize byte, pad byte,
    // colorize hue/saturation/lightness, master hue/saturation/lightness (big-endian int16).
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    const records: number[] = [];
    for (let i = 0; i + 8 <= bytes.length; i++) {
      if (String.fromCharCode(...bytes.subarray(i, i + 8)) === "8BIMhue2") records.push(i + 12);
    }
    expect(records).toHaveLength(2);
    const words = (at: number) => Array.from({ length: 8 }, (_, k) => view.getInt16(at + k * 2, false));
    const [first, second] = records.map(words);
    expect(view.getUint32(records[0] - 4, false)).toBe(100);
    expect(first).toEqual([2, 256, 300, 25, -10, 0, 0, 0]);
    expect(bytes[records[0] + 2]).toBe(1);
    expect(second).toEqual([2, 0, 0, 0, 0, -40, 10, 0]);
    // ag-psd reads it back as master.a = flag << 8, and the importer as colorize again.
    const raw = readFixture(buf).children!.find((l) => l.name === "Tint")!.adjustment as { master?: { a?: number } };
    expect(raw.master?.a).toBe(256);
    const { els } = await roundTrip(d);
    expect(byName(els, "Tint")).toMatchObject({ type: "adjustment", adjustment: tint.adjustment });
    expect(byName(els, "Plain")).toMatchObject({ type: "adjustment", adjustment: plain.adjustment });
  });
});

describe("psd export: review fixes", () => {
  it("a translucent fill with an active effect falls back to pixels with live effects", async () => {
    const shadow = EffectsSchema.parse({ dropShadow: [{ color: "#000000", opacity: 0.8, angle: 90, distance: 6, size: 8 }] });
    const off = EffectsSchema.parse({ dropShadow: [{ enabled: false, color: "#000000", opacity: 0.8, angle: 90, distance: 6, size: 8 }] });
    const d = makeDesign([
      rectEl({ name: "Glass", fill: "#33669980", effects: shadow }),
      vectorEl({ name: "Veil", fill: { type: "color", color: "#ff000040" }, stroke: null, strokeWidth: 0, effects: shadow }),
      rectEl({ name: "Off", fill: "#33669980", effects: off }),
      rectEl({ name: "Solid", fill: "#336699", effects: shadow }),
    ]);
    calls.length = 0;
    const { psd, els } = await roundTrip(d);
    for (const i of [1, 2]) {
      expect(psd.children![i].vectorMask).toBeUndefined();
      expect(psd.children![i].canvas).toBeDefined();
      expect(psd.children![i].fillOpacity).toBeUndefined();
      expect(psd.children![i].effects?.dropShadow?.[0].enabled).toBe(true);
    }
    // The translucent colour stays in the pixels, so Photoshop's shadow follows the same alpha.
    expect(calls[0].el).toMatchObject({ type: "shape", fill: "#33669980" });
    expect(byName(els, "Glass").effects?.dropShadow).toHaveLength(1);
    // With no active effect, or an opaque fill, it is still a shape layer.
    expect(psd.children![3].vectorMask).toBeDefined();
    expect(psd.children![3].fillOpacity).toBeCloseTo(128 / 255, 3);
    expect(psd.children![4].vectorMask).toBeDefined();
    expect(psd.children![4].fillOpacity).toBeUndefined();
  });

  it("polygon shapes join round like the editor draws them; rects and ellipses mitre", async () => {
    const kinds = ["rect", "ellipse", "triangle", "hexagon", "star"] as const;
    const d = makeDesign(kinds.map((k) => rectEl({ name: k, shape: k, stroke: "#000000", strokeWidth: 3 })));
    const { psd } = await roundTrip(d);
    expect(psd.children!.slice(1).map((l) => l.vectorStroke?.lineJoinType)).toEqual(["miter", "miter", "round", "round", "round"]);
  });

  it("the filters note skips hidden elements", async () => {
    const d = makeDesign([rectEl({ name: "Gone", hidden: true, filters: [defaultFilter("blur")] })]);
    const notes: string[] = [];
    await buildPsd(d, d.pages[0], stubRender, notes);
    expect(notes).toEqual([]);
  });
});
