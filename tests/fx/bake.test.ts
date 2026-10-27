import { describe, expect, it } from "vitest";
import type { LayerEffectsInfo, PatternInfo } from "ag-psd";
import { bakeEffects, MAX_BAKE_PIXELS, bodyOrderToBake } from "@/lib/fx/bake";
import { createRaster, type Raster } from "@/lib/fx/raster";

const px = (value: number) => ({ units: "Pixels" as const, value });
const white = { r: 255, g: 255, b: 255 };
const black = { r: 0, g: 0, b: 0 };

/** A w×w opaque square of grey 0.5. */
function square(w = 40, v = 0.5): Raster {
  const r = createRaster(w, w);
  for (let i = 0; i < r.data.length; i += 4) r.data.set([v, v, v, 1], i);
  return r;
}
const opts = (o?: Partial<Parameters<typeof bakeEffects>[2]>) => ({ dpi: 72, globalAngle: 120, fillOpacity: 1, seed: 1, ...o });
const at = (r: Raster, x: number, y: number) => {
  const i = (y * r.w + x) * 4;
  const a = r.data[i + 3];
  return { r: a ? r.data[i] / a : 0, g: a ? r.data[i + 1] / a : 0, b: a ? r.data[i + 2] / a : 0, a };
};
const lum = (r: Raster, x0: number, y0: number, x1: number, y1: number) => {
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const p = at(r, x, y);
      s += (p.r + p.g + p.b) / 3;
      n++;
    }
  return s / n;
};
const bevel = (style: "inner bevel" | "outer bevel" | "emboss" | "pillow emboss" | "stroke emboss", extra?: object): LayerEffectsInfo => ({
  bevel: {
    enabled: true,
    style,
    technique: "smooth",
    size: px(8),
    strength: 1,
    angle: 90,
    altitude: 30,
    useGlobalLight: false,
    highlightColor: white,
    highlightOpacity: 0.9,
    highlightBlendMode: "screen",
    shadowColor: black,
    shadowOpacity: 0.9,
    shadowBlendMode: "multiply",
    ...extra,
  },
});

describe("bakeEffects", () => {
  it("inner bevel lightens the lit edge", () => {
    const out = bakeEffects(square(), bevel("inner bevel"), opts());
    const { l, t } = out.pad;
    const top = lum(out.raster, l + 10, t + 1, l + 30, t + 5);
    const bottom = lum(out.raster, l + 10, t + 35, l + 30, t + 39);
    expect(top).toBeGreaterThan(0.6);
    expect(bottom).toBeLessThan(0.4);
    // The middle is flat, so untouched.
    expect(at(out.raster, l + 20, t + 20).r).toBeCloseTo(0.5, 2);
    expect(out.baked).toEqual(["Bevel & emboss"]);
  });

  it("direction down flips the light", () => {
    const out = bakeEffects(square(), bevel("inner bevel", { direction: "down" }), opts());
    const { l, t } = out.pad;
    expect(lum(out.raster, l + 10, t + 1, l + 30, t + 5)).toBeLessThan(lum(out.raster, l + 10, t + 35, l + 30, t + 39));
  });

  it("outer bevel grows the box", () => {
    const out = bakeEffects(square(), bevel("outer bevel"), opts());
    expect(out.pad.l).toBeGreaterThan(0);
    expect(out.raster.w).toBe(40 + out.pad.l + out.pad.r);
    // Something is painted just outside the top edge.
    expect(at(out.raster, out.pad.l + 20, out.pad.t - 2).a).toBeGreaterThan(0);
  });

  it("emboss and pillow emboss shade both sides of the edge", () => {
    for (const s of ["emboss", "pillow emboss"] as const) {
      const out = bakeEffects(square(), bevel(s), opts());
      expect(at(out.raster, out.pad.l + 20, out.pad.t - 2).a, s).toBeGreaterThan(0);
      expect(Math.abs(at(out.raster, out.pad.l + 20, out.pad.t + 2).r - 0.5), s).toBeGreaterThan(0.05);
    }
  });

  it("satin changes interior only", () => {
    const src = square();
    const out = bakeEffects(src, { satin: { enabled: true, color: black, opacity: 1, blendMode: "multiply", size: px(6), distance: px(8), angle: 19 } }, opts());
    expect(out.pad).toEqual({ l: 0, t: 0, r: 0, b: 0 });
    for (let i = 3; i < src.data.length; i += 4) expect(out.raster.data[i]).toBeCloseTo(1, 5);
    let changed = 0;
    for (let i = 0; i < src.data.length; i += 4) if (Math.abs(out.raster.data[i] - 0.5) > 0.02) changed++;
    expect(changed).toBeGreaterThan(0);
  });

  it("pattern overlay tiles", () => {
    // A 2×2 checker: black at (0,0) and (1,1), white elsewhere.
    const data = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    const pattern: PatternInfo = { name: "c", id: "checker", x: 0, y: 0, bounds: { x: 0, y: 0, w: 2, h: 2 }, data };
    const out = bakeEffects(
      square(8),
      { patternOverlay: { enabled: true, opacity: 1, blendMode: "normal", scale: 1, pattern: { name: "c", id: "checker" } } },
      opts({ patterns: [pattern] }),
    );
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) expect(at(out.raster, x, y).r, `${x},${y}`).toBeCloseTo((x + y) % 2 ? 1 : 0, 3);
    expect(out.issues).toEqual([]);
  });

  it("missing pattern falls back to grey with an issue", () => {
    const out = bakeEffects(square(8, 1), { patternOverlay: { enabled: true, opacity: 1, pattern: { name: "gone", id: "nope" } } }, opts());
    expect(at(out.raster, 4, 4).r).toBeCloseTo(0.5, 2);
    expect(out.issues[0]).toMatchObject({ kind: "approximated" });
    expect(out.issues[0].message).toMatch(/pattern/i);
  });

  it("noise gradient overlay is baked as an approximation", () => {
    const out = bakeEffects(
      square(),
      { gradientOverlay: [{ enabled: true, opacity: 1, type: "linear", angle: 0, gradient: { name: "n", type: "noise", randomSeed: 7, min: [0, 0, 0, 0], max: [1, 1, 1, 1] } }] },
      opts(),
    );
    expect(out.baked).toEqual(["Gradient overlay"]);
    expect(out.issues.some((i) => i.kind === "approximated")).toBe(true);
    // Not the original grey everywhere.
    expect(Math.abs(lum(out.raster, 0, 0, 40, 40) - 0.5)).toBeGreaterThan(0.001);
  });

  it("bake folds fillOpacity", () => {
    const out = bakeEffects(square(), bevel("inner bevel"), opts({ fillOpacity: 0.5 }));
    expect(at(out.raster, out.pad.l + 20, out.pad.t + 20).a).toBeCloseTo(0.5, 2);
  });

  it("supported effects above a bake stay editable", () => {
    const fx: LayerEffectsInfo = {
      ...bevel("inner bevel"),
      stroke: [{ enabled: true, size: px(3), color: { r: 255, g: 0, b: 0 } }],
      solidFill: [{ enabled: true, color: { r: 0, g: 0, b: 255 } }],
      dropShadow: [{ enabled: true, size: px(4), distance: px(4) }],
    };
    const out = bakeEffects(square(), fx, opts());
    expect(out.keep?.stroke?.[0].size).toBe(3);
    expect(out.keep?.dropShadow).toHaveLength(1);
    expect(out.keep?.colorOverlay).toBeUndefined();
    expect(out.baked).toContain("Colour overlay");
    expect(out.baked).toContain("Bevel & emboss");
    // The overlay is in the pixels: the flat middle is blue.
    const mid = at(out.raster, out.pad.l + 20, out.pad.t + 20);
    expect(mid.b).toBeCloseTo(1, 2);
    expect(mid.r).toBeCloseTo(0, 2);
  });

  it("with fill below 1 everything is baked, outer effects too", () => {
    const fx: LayerEffectsInfo = { ...bevel("inner bevel"), dropShadow: [{ enabled: true, size: px(2), distance: px(6), angle: 90, color: black, opacity: 1 }] };
    const out = bakeEffects(square(), fx, opts({ fillOpacity: 0.5 }));
    expect(out.keep).toBeUndefined();
    expect(out.baked).toContain("Drop shadow");
    // The shadow is painted below the square.
    expect(at(out.raster, out.pad.l + 20, out.pad.t + 40 + 3).a).toBeGreaterThan(0.5);
  });

  it("stroke emboss bakes the stroke with it", () => {
    const fx: LayerEffectsInfo = { ...bevel("stroke emboss"), stroke: [{ enabled: true, size: px(4), color: { r: 255, g: 0, b: 0 } }] };
    const out = bakeEffects(square(), fx, opts());
    expect(out.keep?.stroke).toBeUndefined();
    expect(out.baked).toContain("Stroke");
    expect(out.pad.l).toBeGreaterThanOrEqual(4);
  });

  it("body order bakes everything up to the top unsupported effect", () => {
    expect(bodyOrderToBake({ satin: { enabled: true }, stroke: [{ enabled: true }], solidFill: [{ enabled: true }] })).toEqual([
      "patternOverlay",
      "gradientOverlay",
      "colorOverlay",
      "satin",
    ]);
    expect(bodyOrderToBake({ stroke: [{ enabled: true }] })).toEqual([]);
  });

  it("refuses rasters past the pixel cap", () => {
    expect(MAX_BAKE_PIXELS).toBeLessThanOrEqual(16_000_000);
    const big = { w: 4000, h: 4000, data: new Float32Array(4) };
    expect(() => bakeEffects(big, bevel("inner bevel"), opts())).toThrow(/too large/);
  });
});
