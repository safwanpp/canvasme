import { describe, expect, it } from "vitest";
import { Effects } from "@/lib/effects";
import { fxPaddingUnits, renderEffects } from "@/lib/fx/effects";
import { createRaster, type Raster } from "@/lib/fx/raster";
import { expectPx, px } from "../fixtures/raster";

/** 100×100, a 40×40 opaque white square at (30,30). */
function content(): Raster {
  const r = createRaster(100, 100);
  for (let y = 30; y < 70; y++) for (let x = 30; x < 70; x++) r.data.set([1, 1, 1, 1], (y * 100 + x) * 4);
  return r;
}
const opts = (o?: Partial<{ fillOpacity: number; ratio: number }>) => ({
  ratio: 1,
  fillOpacity: 1,
  box: { x: 30, y: 30, w: 40, h: 40 },
  seed: 1,
  ...o,
});
const fx = (o: unknown) => Effects.parse(o);
const alpha = (r: Raster, x: number, y: number) => r.data[(y * r.w + x) * 4 + 3];

describe("renderEffects", () => {
  it("no effects returns body equal to content and no outer parts", () => {
    const c = content();
    const out = renderEffects(c, undefined, opts());
    expect(out.outer).toEqual([]);
    expect(Array.from(out.body.data)).toEqual(Array.from(c.data));
  });

  it("fillOpacity fades the body", () => {
    const out = renderEffects(content(), undefined, opts({ fillOpacity: 0.5 }));
    expect(alpha(out.body, 50, 50)).toBeCloseTo(0.5, 5);
  });

  it("fillOpacity 0 keeps an outside stroke fully opaque", () => {
    const out = renderEffects(
      content(),
      fx({ stroke: [{ size: 4, paint: { type: "color", color: "#ff0000" } }] }),
      opts({ fillOpacity: 0 }),
    );
    expectPx(px(out.body, 28, 50), [255, 0, 0, 255]);
    expect(alpha(out.body, 50, 50)).toBeLessThan(0.01);
  });

  it("drop shadow offset follows angle", () => {
    const out = renderEffects(content(), fx({ dropShadow: [{ color: "#000000", angle: 90, distance: 10, size: 0 }] }), opts());
    expect(out.outer).toHaveLength(1);
    expect(out.outer[0].blend).toBe("normal");
    expect(alpha(out.outer[0].raster, 50, 75)).toBeCloseTo(1, 3);
    expect(alpha(out.outer[0].raster, 50, 25)).toBe(0);
  });

  it("angle 120 casts down and right", () => {
    const out = renderEffects(content(), fx({ dropShadow: [{ color: "#000000", angle: 120, distance: 10, size: 0 }] }), opts());
    // dx = -cos(120°)·10 = +5, dy = sin(120°)·10 ≈ +8.7
    expect(alpha(out.outer[0].raster, 73, 50)).toBeCloseTo(1, 3);
    expect(alpha(out.outer[0].raster, 50, 77)).toBeCloseTo(1, 3);
    expect(alpha(out.outer[0].raster, 27, 50)).toBe(0);
  });

  it("knockout hides shadow under the layer", () => {
    const sh = (knockout: boolean) =>
      renderEffects(content(), fx({ dropShadow: [{ color: "#000000", angle: 90, distance: 0, size: 0, knockout }] }), opts());
    expect(alpha(sh(true).outer[0].raster, 50, 50)).toBe(0);
    expect(alpha(sh(false).outer[0].raster, 50, 50)).toBeCloseTo(1, 3);
  });

  it("blurred shadow spreads past the edge and fades", () => {
    const out = renderEffects(content(), fx({ dropShadow: [{ color: "#000000", angle: 90, distance: 0, size: 10 }] }), opts());
    const a = (x: number) => alpha(out.outer[0].raster, x, 50);
    expect(a(72)).toBeGreaterThan(a(78));
    expect(a(78)).toBeGreaterThan(0);
    expect(a(95)).toBeLessThan(0.01);
  });

  it("spread grows the shadow", () => {
    const sh = (spread: number) =>
      renderEffects(content(), fx({ dropShadow: [{ color: "#000000", angle: 90, distance: 0, size: 10, spread }] }), opts());
    expect(alpha(sh(0.8).outer[0].raster, 76, 50)).toBeGreaterThan(alpha(sh(0).outer[0].raster, 76, 50));
  });

  it("inner shadow only inside", () => {
    const out = renderEffects(content(), fx({ innerShadow: [{ color: "#000000", angle: 90, distance: 4, size: 0 }] }), opts());
    expect(alpha(out.body, 20, 20)).toBe(0);
    expect(alpha(out.body, 50, 75)).toBe(0);
    expect(px(out.body, 50, 31)[0]).toBeLessThan(20);
    expect(px(out.body, 50, 50)[0]).toBe(255);
    expect(alpha(out.body, 50, 31)).toBeCloseTo(1, 3);
  });

  it("inner glow center vs edge", () => {
    const glow = (source: string) =>
      renderEffects(content(), fx({ innerGlow: { color: "#ff0000", size: 10, source } }), opts()).body;
    const edge = glow("edge");
    const center = glow("center");
    // Red glow over white: less green means more glow.
    expect(px(edge, 31, 50)[1]).toBeLessThan(px(edge, 50, 50)[1]);
    expect(px(center, 50, 50)[1]).toBeLessThan(px(center, 31, 50)[1]);
  });

  it("colour overlay replaces colour, keeps alpha shape", () => {
    const c = content();
    // A soft edge column at x=30.
    for (let y = 30; y < 70; y++) c.data.set([0.5, 0.5, 0.5, 0.5], (y * 100 + 30) * 4);
    const out = renderEffects(c, fx({ colorOverlay: [{ color: "#00ff00" }] }), opts());
    expectPx(px(out.body, 50, 50), [0, 255, 0, 255]);
    expectPx(px(out.body, 30, 50), [0, 255, 0, 128]);
  });

  it("gradient overlay respects element box, not padded raster", () => {
    const out = renderEffects(
      content(),
      fx({
        gradientOverlay: [
          { gradient: { angle: 0, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] } },
        ],
      }),
      opts(),
    );
    expect(px(out.body, 30, 50)[0]).toBeLessThan(10);
    expect(px(out.body, 69, 50)[0]).toBeGreaterThan(245);
  });

  it("stroke center straddles edge", () => {
    const out = renderEffects(
      content(),
      fx({ stroke: [{ size: 4, position: "center", paint: { type: "color", color: "#ff0000" } }] }),
      opts(),
    );
    expectPx(px(out.body, 29, 50), [255, 0, 0, 255]);
    expectPx(px(out.body, 30, 50), [255, 0, 0, 255]);
    expectPx(px(out.body, 33, 50), [255, 255, 255, 255]);
  });

  it("stroke inside never paints outside", () => {
    const out = renderEffects(
      content(),
      fx({ stroke: [{ size: 4, position: "inside", paint: { type: "color", color: "#ff0000" } }] }),
      opts(),
    );
    expect(alpha(out.body, 29, 50)).toBe(0);
    expectPx(px(out.body, 31, 50), [255, 0, 0, 255]);
  });

  it("gradient stroke paints with the gradient", () => {
    const out = renderEffects(
      content(),
      fx({
        stroke: [
          {
            size: 4,
            paint: { type: "gradient", gradient: { angle: 0, stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }] } },
          },
        ],
      }),
      opts(),
    );
    expect(px(out.body, 27, 50)[0]).toBeGreaterThan(240);
    expect(px(out.body, 72, 50)[2]).toBeGreaterThan(240);
  });

  it("order: stroke above overlay", () => {
    const out = renderEffects(
      content(),
      fx({
        colorOverlay: [{ color: "#00ff00" }],
        stroke: [
          { size: 3, position: "outside", paint: { type: "color", color: "#ff0000" } },
          { size: 3, position: "inside", paint: { type: "color", color: "#0000ff" } },
        ],
      }),
      opts(),
    );
    expectPx(px(out.body, 28, 50), [255, 0, 0, 255]);
    expectPx(px(out.body, 31, 50), [0, 0, 255, 255]);
    expectPx(px(out.body, 50, 50), [0, 255, 0, 255]);
  });

  it("precise glow reaches exactly size px", () => {
    const out = renderEffects(content(), fx({ outerGlow: { color: "#ffff00", size: 10, technique: "precise" } }), opts());
    const g = out.outer[0].raster;
    expect(alpha(g, 79, 50)).toBeGreaterThan(0);
    expect(alpha(g, 80, 50)).toBe(0);
  });

  it("softer glow reaches about size px", () => {
    const out = renderEffects(content(), fx({ outerGlow: { color: "#ffff00", size: 10 } }), opts());
    const g = out.outer[0].raster;
    expect(alpha(g, 72, 50)).toBeGreaterThan(0.2);
    expect(alpha(g, 88, 50)).toBeLessThan(0.02);
  });

  it("ratio scales effect sizes", () => {
    const r = createRaster(200, 200);
    for (let y = 60; y < 140; y++) for (let x = 60; x < 140; x++) r.data.set([1, 1, 1, 1], (y * 200 + x) * 4);
    const out = renderEffects(r, fx({ dropShadow: [{ color: "#000000", angle: 90, distance: 10, size: 0 }] }), {
      ...opts(),
      ratio: 2,
      box: { x: 60, y: 60, w: 80, h: 80 },
    });
    expect(alpha(out.outer[0].raster, 100, 158)).toBeCloseTo(1, 3);
    expect(alpha(out.outer[0].raster, 100, 162)).toBe(0);
  });

  it("disabled effects are skipped", () => {
    const out = renderEffects(
      content(),
      fx({ dropShadow: [{ color: "#000000", angle: 90, distance: 10, size: 0, enabled: false }], colorOverlay: [{ color: "#00ff00", enabled: false }] }),
      opts(),
    );
    expect(out.outer).toEqual([]);
    expectPx(px(out.body, 50, 50), [255, 255, 255, 255]);
  });

  it("contour reshapes the shadow alpha", () => {
    const out = renderEffects(
      content(),
      fx({
        dropShadow: [{ color: "#000000", angle: 90, distance: 0, size: 10, contour: [{ x: 0, y: 1 }, { x: 1, y: 0 }] }],
      }),
      opts(),
    );
    // Inverted contour: far from the shape, where the blur gave 0, it now gives 1.
    expect(alpha(out.outer[0].raster, 5, 5)).toBeCloseTo(1, 2);
  });
});

describe("fxPaddingUnits", () => {
  it("is zero without outer effects", () => {
    expect(fxPaddingUnits(undefined)).toEqual({ l: 0, t: 0, r: 0, b: 0 });
    expect(fxPaddingUnits(fx({ colorOverlay: [{ color: "#000" }] }))).toEqual({ l: 0, t: 0, r: 0, b: 0 });
  });

  it("covers an offset shadow on the side it falls", () => {
    const p = fxPaddingUnits(fx({ dropShadow: [{ color: "#000", angle: 90, distance: 20, size: 10 }] }));
    expect(p.b).toBeGreaterThanOrEqual(20 + 15);
    expect(p.t).toBeLessThan(p.b);
  });

  it("covers an outside stroke", () => {
    const p = fxPaddingUnits(fx({ stroke: [{ size: 6, paint: { type: "color", color: "#000" } }] }));
    expect(Math.min(p.l, p.t, p.r, p.b)).toBeGreaterThanOrEqual(6);
  });
});
