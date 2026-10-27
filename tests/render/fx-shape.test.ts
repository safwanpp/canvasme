// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effects } from "@/lib/effects";
import type { Element } from "@/lib/model";
import { elementNodes, renderElementLayer, renderPageCanvas } from "@/lib/render";
import { fxCache } from "@/lib/fx/cache";
import { fxPadding, fxRatio, needsFx, visualBounds } from "@/lib/fx/fxShape";
import { makeDesign, rectEl, textEl } from "../fixtures/design";

vi.mock("@/lib/images", () => ({ loadAssetImage: async () => null, getReadyImage: () => undefined }));
vi.mock("@/lib/fonts", () => ({ ensureFonts: async () => {} }));

const fx = (o: unknown) => Effects.parse(o);

async function pagePx(els: Element[], background = "#ffffff") {
  const d = makeDesign(els, { background });
  const c = await renderPageCanvas(d, d.pages[0], 1);
  const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  return (x: number, y: number) => Array.from(data.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 4));
}
const near = (got: number[], want: number[], tol: number) =>
  expect(got.every((v, i) => Math.abs(v - want[i]) <= tol), `got ${got}, want ${want}`).toBe(true);

const shadowRect = (shadow: Record<string, unknown>, p?: Partial<Element>) =>
  rectEl({
    x: 80,
    y: 80,
    width: 40,
    height: 40,
    fill: "#000000",
    effects: fx({ dropShadow: [{ color: "#ff0000", angle: 90, distance: 20, size: 0, ...shadow }] }),
    ...(p as object),
  });

beforeEach(() => fxCache.clear());

describe("fx shape", () => {
  it("element without fx uses plain nodes", () => {
    expect(needsFx(rectEl())).toBe(false);
    expect(elementNodes(rectEl())[0].kind).toBe("Rect");
    expect(needsFx(rectEl({ blendMode: "multiply" }))).toBe(false);
    expect(needsFx(rectEl({ blendMode: "linear-burn" }))).toBe(true);
    expect(needsFx(rectEl({ fillOpacity: 0.5 }))).toBe(false);
  });

  it("element with effects is one Shape", () => {
    const nodes = elementNodes(shadowRect({}));
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("Shape");
    expect(nodes[0].attrs.width).toBe(40);
  });

  it("drop shadow appears in page render", async () => {
    const at = await pagePx([shadowRect({})]);
    near(at(100, 130), [255, 0, 0, 255], 10);
    near(at(100, 100), [0, 0, 0, 255], 10);
    near(at(100, 70), [255, 255, 255, 255], 10);
  });

  it("multiply shadow multiplies backdrop", async () => {
    const at = await pagePx([shadowRect({ blendMode: "multiply" })], "#00ff00");
    near(at(100, 130), [0, 0, 0, 255], 10);
  });

  it("non-native blend linear-burn on element draws via readback", async () => {
    const el = rectEl({ x: 50, y: 50, width: 100, height: 100, fill: "#808080", blendMode: "linear-burn" });
    const at = await pagePx([el], "#c0c0c0");
    near(at(100, 100), [0x41, 0x41, 0x41, 255], 3);
    near(at(20, 20), [0xc0, 0xc0, 0xc0, 255], 1);
  });

  it("native blend without effects uses the group", async () => {
    const el = rectEl({ x: 50, y: 50, width: 100, height: 100, fill: "#ff0000", blendMode: "multiply" });
    const at = await pagePx([el], "#00ff00");
    near(at(100, 100), [0, 0, 0, 255], 2);
  });

  it("fill opacity without effects fades the element", async () => {
    const el = rectEl({ x: 50, y: 50, width: 100, height: 100, fill: "#000000", fillOpacity: 0.5 });
    const at = await pagePx([el]);
    near(at(100, 100), [128, 128, 128, 255], 2);
  });

  it("fill opacity 0 keeps the stroke effect", async () => {
    const el = rectEl({
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      fill: "#000000",
      fillOpacity: 0,
      effects: fx({ stroke: [{ size: 4, paint: { type: "color", color: "#0000ff" } }] }),
    });
    const at = await pagePx([el]);
    near(at(100, 100), [255, 255, 255, 255], 2);
    near(at(48, 100), [0, 0, 255, 255], 2);
  });

  it("element opacity applies to effects too", async () => {
    const at = await pagePx([shadowRect({}, { opacity: 0.5 })]);
    near(at(100, 130), [255, 128, 128, 255], 3);
  });

  it("zero-size element renders nothing and does not throw", async () => {
    const el = textEl({ width: 0.1, height: 0, effects: fx({ dropShadow: [{ color: "#000", angle: 90, distance: 5, size: 3 }] }) });
    await expect(pagePx([el])).resolves.toBeTypeOf("function");
  });

  it("renderElementLayer box includes shadow", async () => {
    const el = shadowRect({ size: 10, distance: 20 });
    const d = makeDesign([el]);
    const out = await renderElementLayer(d, el);
    expect(out!.box.height).toBeGreaterThanOrEqual(el.height + 20);
  });

  it("renderElementLayer with effects:false excludes shadow and does not apply fillOpacity", async () => {
    const el = shadowRect({ size: 10, distance: 20 }, { fillOpacity: 0.2 });
    const d = makeDesign([el]);
    const out = await renderElementLayer(d, el, 1, { effects: false });
    expect(out!.box.height).toBeLessThanOrEqual(el.height + 2);
    const ctx = out!.canvas.getContext("2d")!;
    const mid = ctx.getImageData(Math.floor(out!.canvas.width / 2), Math.floor(out!.canvas.height / 2), 1, 1).data;
    expect(mid[3]).toBe(255);
  });

  it("renderElementLayer without effects keeps its exact box", async () => {
    const el = rectEl({ x: 10, y: 10, width: 40, height: 30 });
    const out = await renderElementLayer(makeDesign([el]), el);
    expect(out!.box).toEqual({ x: 10, y: 10, width: 40, height: 30 });
  });

  it("fxRatio caps total pixels", () => {
    const r = fxRatio(8, 4000, 4000);
    expect(r * r * 4000 * 4000).toBeLessThanOrEqual(16e6);
    expect(fxRatio(8, 100, 100)).toBe(8);
    expect(fxRatio(1.1, 100, 100)).toBe(1);
    expect(fxRatio(1.3, 100, 100)).toBeCloseTo(Math.SQRT2, 6);
    expect(r * 4000).toBeLessThanOrEqual(4096);
  });

  it("fxPadding and visualBounds include the shadow", () => {
    const el = shadowRect({ size: 10, distance: 20 });
    const p = fxPadding(el);
    expect(p.b).toBeGreaterThanOrEqual(35);
    const vb = visualBounds(el);
    expect(vb.y + vb.height).toBeGreaterThanOrEqual(el.y + el.height + 35);
    const rot = visualBounds({ ...el, rotation: 90 });
    // Rotated a quarter turn about (x, y): the shadow now falls to the left.
    expect(rot.x).toBeLessThanOrEqual(el.x - el.height - 35);
  });
});

describe("every P1 effect through renderPageCanvas", () => {
  it("renders non-trivially and pads the bounds", async () => {
    const text = textEl({
      x: 20,
      y: 20,
      width: 160,
      height: 60,
      text: "FX",
      fontSize: 48,
      bold: true,
      fill: "#2244ff",
      effects: fx({ stroke: [{ size: 3, position: "outside", paint: { type: "color", color: "#ff00ff" } }] }),
    });
    const box = rectEl({
      x: 40,
      y: 100,
      width: 60,
      height: 50,
      fill: "#ffffff",
      blendMode: "multiply",
      effects: fx({
        dropShadow: [{ color: "#000000", angle: 120, distance: 12, size: 6, blendMode: "multiply", opacity: 0.8 }],
        outerGlow: { color: "#ffcc00", size: 10 },
        innerShadow: [{ color: "#000000", angle: 90, distance: 5, size: 3 }],
        colorOverlay: [{ color: "#33aa55", opacity: 0.5 }],
        gradientOverlay: [
          { gradient: { angle: 0, stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }] }, opacity: 0.6 },
        ],
      }),
    });
    const d = makeDesign([text, box], { background: "#e0e0e0" });
    const c = await renderPageCanvas(d, d.pages[0], 1);
    const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const at = (x: number, y: number) => Array.from(data.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 4));
    const bg = [0xe0, 0xe0, 0xe0, 255];
    const differs = (p: number[]) => p.some((v, i) => Math.abs(v - bg[i]) > 8);

    // Some stroke-magenta pixels around the text.
    let magenta = 0;
    for (let y = 15; y < 90; y++)
      for (let x = 15; x < 190; x++) {
        const [r, g, b] = at(x, y);
        if (r > 200 && g < 80 && b > 200) magenta++;
      }
    expect(magenta).toBeGreaterThan(20);

    // Body: overlays tint it (not white, not the backdrop); left reddish, right bluish.
    const left = at(45, 130);
    const right = at(95, 130);
    expect(differs(left) && differs(right)).toBe(true);
    expect(left[0]).toBeGreaterThan(right[0]);
    expect(right[2]).toBeGreaterThan(left[2]);
    // Inner shadow darkens the top inside edge relative to the middle.
    expect(at(70, 102)[1]).toBeLessThan(at(70, 125)[1]);
    // Drop shadow below-right of the box; glow just left of it (yellowish).
    expect(at(80, 158)[0]).toBeLessThan(150);
    const glow = at(34, 110);
    expect(glow[0]).toBeGreaterThan(glow[2] + 20);

    // Bounds: the padded box covers the shadow and glow.
    const vb = visualBounds(box);
    expect(vb.y + vb.height).toBeGreaterThanOrEqual(box.y + box.height + 12 * Math.sin((120 * Math.PI) / 180) + 9);
    expect(vb.x).toBeLessThanOrEqual(box.x - 15);
    const layer = await renderElementLayer(d, box);
    expect(layer!.box.height).toBeGreaterThan(box.height + 20);
  });
});

describe("P1 review fixes", () => {
  it("the blur tail fades to nothing inside the padded box", async () => {
    const el = textEl({
      x: 100,
      y: 100,
      width: 300,
      height: 58,
      text: "Glow",
      fontSize: 48,
      bold: true,
      effects: fx({
        outerGlow: { color: "#ffcc00", size: 24, spread: 0.2 },
        dropShadow: [{ color: "#000000", angle: 120, distance: 14, size: 8 }],
      }),
    });
    const d = makeDesign([el], { width: 600, height: 400 });
    for (const pr of [1, 2]) {
      const out = await renderElementLayer(d, el, pr);
      const c = out!.canvas;
      const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let edge = 0;
      for (let x = 0; x < c.width; x++) {
        edge = Math.max(edge, data[x * 4 + 3], data[((c.height - 1) * c.width + x) * 4 + 3]);
      }
      for (let y = 0; y < c.height; y++) {
        edge = Math.max(edge, data[y * c.width * 4 + 3], data[(y * c.width + c.width - 1) * 4 + 3]);
      }
      expect(edge, `pixelRatio ${pr}`).toBe(0);
    }
  });

  it("text pads for italic overhang", () => {
    const el = textEl({ fontSize: 100, italic: true, effects: fx({ colorOverlay: [{ color: "#ff0000" }] }) });
    const p = fxPadding(el);
    expect(Math.min(p.l, p.t, p.r, p.b)).toBeGreaterThanOrEqual(20);
  });

  it("exports render at the exact ratio, not the editor's quantized one", async () => {
    const el = shadowRect({ size: 4 });
    const d = makeDesign([el]);
    await renderPageCanvas(d, d.pages[0], 0.3);
    expect(fxCache.getStale(el.id)!.ratio).toBeCloseTo(0.3, 6);
  });

  it("dissolve seeds by element id, so twins don't share a render", async () => {
    const effects = fx({ colorOverlay: [{ color: "#00ff00", blendMode: "dissolve", opacity: 0.5 }] });
    const a = rectEl({ x: 10, y: 10, width: 40, height: 40, effects });
    const b = { ...a, id: "twin" };
    const d = makeDesign([a, b]);
    await renderPageCanvas(d, d.pages[0], 1);
    expect(fxCache.getStale(a.id)).toBeDefined();
    expect(fxCache.getStale(b.id)).toBeDefined();
    expect(fxCache.getStale(b.id)).not.toBe(fxCache.getStale(a.id));
  });

  it("a far shadow doesn't lower the body's resolution", async () => {
    const el = shadowRect({ distance: 6000, size: 10 }, { x: 10, y: 10, width: 100, height: 100 });
    const d = makeDesign([el], { width: 200, height: 200 });
    await renderPageCanvas(d, d.pages[0], 1);
    const e = fxCache.getStale(el.id)!;
    expect(e.ratio).toBe(1);
    expect(e.outerRatio).toBeLessThan(1);
  });

  it("the layer's blend mode applies to its shadow too", async () => {
    // Screen: a black shadow screened over grey leaves the grey.
    const el = shadowRect({ color: "#000000" }, { fill: "#ffffff", blendMode: "screen" });
    const at = await pagePx([el], "#808080");
    near(at(100, 130), [128, 128, 128, 255], 3);
    near(at(100, 100), [255, 255, 255, 255], 3);
  });

  it("a non-native layer blend applies to its shadow too", async () => {
    // Linear burn (b + s − 1) of a white shadow onto grey changes nothing.
    const el = shadowRect({ color: "#ffffff" }, { fill: "#e0e0e0", blendMode: "linear-burn" });
    const at = await pagePx([el], "#808080");
    near(at(100, 130), [128, 128, 128, 255], 3);
    near(at(100, 100), [97, 97, 97, 255], 3);
  });
});
