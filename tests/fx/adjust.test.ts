import { describe, expect, it } from "vitest";
import type { Adjustment } from "@/lib/adjustments";
import { Adjustment as AdjustmentSchema, defaultAdjustment, ADJUSTMENT_TYPES } from "@/lib/adjustments";
import { applyAdjustment, applyFilter, luma, monotoneCurve } from "@/lib/fx/adjust";
import { px, solidRaster } from "../fixtures/raster";

type RGB = [number, number, number];

/** Run an adjustment over one straight 8-bit pixel. */
function run(a: Adjustment, rgb: RGB, alpha = 255): number[] {
  const data = new Uint8ClampedArray([...rgb, alpha]);
  applyAdjustment({ data, width: 1, height: 1 }, a);
  return Array.from(data);
}
const near = (got: number[], want: number[], tol = 1) =>
  expect(got.every((v, i) => Math.abs(v - want[i]) <= tol), `got ${got}, want ${want}`).toBe(true);

const SAMPLES: RGB[] = [
  [200, 100, 50],
  [20, 140, 230],
  [128, 128, 128],
];
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

describe("adjustment schema", () => {
  it("has a default for every type that parses", () => {
    expect(ADJUSTMENT_TYPES.length).toBe(14);
    for (const t of ADJUSTMENT_TYPES) expect(AdjustmentSchema.safeParse(defaultAdjustment(t)).success, t).toBe(true);
  });

  it("every default is the identity, except the ones that are meant to change colours", () => {
    const changes = new Set(["invert", "posterize", "threshold", "gradient-map", "black-white", "photo-filter"]);
    for (const t of ADJUSTMENT_TYPES) {
      if (changes.has(t)) continue;
      for (const s of SAMPLES) near(run(defaultAdjustment(t), s), [...s, 255], 1);
    }
  });
});

describe("per-channel adjustments", () => {
  it("invert: 255 − x; twice is the identity; alpha untouched", () => {
    for (const s of SAMPLES) {
      near(run({ type: "invert" }, s, 77), [255 - s[0], 255 - s[1], 255 - s[2], 77], 0);
      const once = run({ type: "invert" }, s);
      near(run({ type: "invert" }, once.slice(0, 3) as RGB), [...s, 255], 0);
    }
  });

  it("posterize: round(x/255·(n−1))/(n−1)·255; 2 levels gives 0/255", () => {
    for (const s of SAMPLES) {
      const q = (v: number, n: number) => clamp((Math.round((v / 255) * (n - 1)) / (n - 1)) * 255);
      near(run({ type: "posterize", levels: 4 }, s), [q(s[0], 4), q(s[1], 4), q(s[2], 4), 255], 0);
      for (const v of run({ type: "posterize", levels: 2 }, s).slice(0, 3)) expect([0, 255]).toContain(v);
    }
  });

  it("levels: outB + (outW−outB)·((x−inB)/(inW−inB))^(1/γ)", () => {
    const ch = { inBlack: 20, inWhite: 220, gamma: 1.6, outBlack: 10, outWhite: 240 };
    const f = (x: number) => clamp(10 + 230 * Math.pow(Math.max(0, Math.min(1, (x - 20) / 200)), 1 / 1.6));
    for (const s of SAMPLES) near(run({ type: "levels", channels: { rgb: ch } }, s), [f(s[0]), f(s[1]), f(s[2]), 255]);
    // A single channel only touches its own.
    near(run({ type: "levels", channels: { r: ch } }, [200, 100, 50]), [f(200), 100, 50, 255]);
  });

  it("levels identity is identity", () => {
    const id = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
    for (const s of SAMPLES) near(run({ type: "levels", channels: { rgb: id, r: id, g: id, b: id } }, s), [...s, 255], 0);
  });

  it("curves identity is identity, and a straight curve through points is linear", () => {
    const id = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    for (const s of SAMPLES) near(run({ type: "curves", channels: { rgb: id } }, s), [...s, 255], 0);
    const flat = [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ];
    near(run({ type: "curves", channels: { g: flat } }, [200, 100, 50]), [200, 128, 50, 255]);
  });

  it("monotone curve passes through its points and stays monotone", () => {
    const c = monotoneCurve([
      { x: 0, y: 0 },
      { x: 0.25, y: 0.5 },
      { x: 0.5, y: 0.6 },
      { x: 1, y: 1 },
    ]);
    expect(c(0.25)).toBeCloseTo(0.5, 6);
    expect(c(0.5)).toBeCloseTo(0.6, 6);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = c(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    // Flat outside the end points.
    expect(monotoneCurve([{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.9 }])(0.05)).toBeCloseTo(0.1, 6);
  });

  it("exposure: linear light x·2^e + offset, then ^(1/γ), back to sRGB", () => {
    const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const srgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    const f = (x: number) => clamp(srgb(Math.pow(Math.max(0, Math.min(1, lin(x / 255) * 2 ** 1 + 0.01)), 1 / 1.2)) * 255);
    for (const s of SAMPLES) near(run({ type: "exposure", exposure: 1, offset: 0.01, gamma: 1.2 }, s), [f(s[0]), f(s[1]), f(s[2]), 255]);
  });

  it("brightness/contrast legacy: x + b, then (x − 0.5)·(1 + c) + 0.5", () => {
    const f = (x: number) => clamp(((x + 30) / 255 - 0.5) * (1 + 0.5) * 255 + 127.5);
    for (const s of SAMPLES) near(run({ type: "brightness-contrast", brightness: 30, contrast: 50, legacy: true }, s), [f(s[0]), f(s[1]), f(s[2]), 255]);
  });

  it("brightness (non-legacy) lifts midtones and keeps black and white", () => {
    const a: Adjustment = { type: "brightness-contrast", brightness: 100, contrast: 0, legacy: false };
    near(run(a, [0, 255, 128]).slice(0, 2), [0, 255], 0);
    expect(run(a, [0, 255, 128])[2]).toBeGreaterThan(150);
    const c: Adjustment = { type: "brightness-contrast", brightness: 0, contrast: 60, legacy: false };
    // Contrast pushes away from the middle and keeps it.
    expect(run(c, [60, 128, 200])[0]).toBeLessThan(60);
    expect(run(c, [60, 128, 200])[2]).toBeGreaterThan(200);
    near([run(c, [60, 128, 200])[1]], [128], 1);
  });
});

describe("luma-based adjustments", () => {
  it("threshold 128 splits", () => {
    for (const s of SAMPLES) {
      const v = Math.round(luma(s[0], s[1], s[2])) >= 128 ? 255 : 0;
      near(run({ type: "threshold", level: 128 }, s), [v, v, v, 255], 0);
    }
  });

  it("gradient map black→white equals grayscale luminance ±1", () => {
    const g: Adjustment = {
      type: "gradient-map",
      reverse: false,
      gradient: { style: "linear", angle: 90, scale: 1, reverse: false, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] },
    };
    for (const s of SAMPLES) {
      const y = luma(s[0], s[1], s[2]);
      near(run(g, s), [y, y, y, 255], 1);
    }
    // Reversed: white→black.
    const y = luma(200, 100, 50);
    near(run({ ...g, reverse: true } as Adjustment, [200, 100, 50]), [255 - y, 255 - y, 255 - y, 255], 1);
  });

  it("gradient map maps luma onto the stops", () => {
    const g: Adjustment = {
      type: "gradient-map",
      reverse: false,
      gradient: { style: "linear", angle: 90, scale: 1, reverse: false, stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }] },
    };
    const t = luma(128, 128, 128) / 255;
    near(run(g, [128, 128, 128]), [255 * (1 - t), 0, 255 * t, 255], 1);
  });
});

describe("colour adjustments", () => {
  it("hue/saturation master hue +120 turns red green, saturation −100 is grey, lightness +100 is white", () => {
    const hs = (hue: number, saturation: number, lightness: number): Adjustment => ({ type: "hue-saturation", colorize: false, master: { hue, saturation, lightness } });
    near(run(hs(120, 0, 0), [255, 0, 0]), [0, 255, 0, 255], 1);
    near(run(hs(-120, 0, 0), [255, 0, 0]), [0, 0, 255, 255], 1);
    // HSL saturation 0 keeps HSL lightness (max+min)/2.
    for (const s of SAMPLES) {
      const l = (Math.max(...s) + Math.min(...s)) / 2;
      near(run(hs(0, -100, 0), s), [l, l, l, 255], 1);
    }
    near(run(hs(0, 0, 100), [20, 140, 230]), [255, 255, 255, 255], 0);
    near(run(hs(0, 0, -100), [20, 140, 230]), [0, 0, 0, 255], 0);
  });

  it("hue/saturation ranges weight by hue (a..b ramps in, b..c full, c..d ramps out)", () => {
    const a: Adjustment = {
      type: "hue-saturation",
      colorize: false,
      master: { hue: 0, saturation: 0, lightness: 0 },
      // Reds: full between 345° and 15°.
      ranges: [{ range: "reds", a: 315, b: 345, c: 15, d: 45, hue: 0, saturation: -100, lightness: 0 }],
    };
    // Pure red is desaturated, pure blue untouched.
    near(run(a, [255, 0, 0]), [128, 128, 128, 255], 1);
    near(run(a, [0, 0, 255]), [0, 0, 255, 255], 0);
    // Hue 30° sits halfway down the ramp: half the change.
    const half = run(a, [255, 128, 0]);
    expect(half[0]).toBeLessThan(250);
    expect(half[0]).toBeGreaterThan(150);
  });

  it("colorize uses the master hue and saturation with the pixel's lightness", () => {
    const a: Adjustment = { type: "hue-saturation", colorize: true, master: { hue: 240, saturation: 100, lightness: 0 } };
    const out = run(a, [128, 128, 128]);
    expect(out[2]).toBeGreaterThan(out[0] + 100);
    near([out[0], out[1]], [out[0], out[0]], 1);
  });

  it("vibrance raises low saturation more than high and saturation −100 is grey", () => {
    const v = (vibrance: number, saturation: number): Adjustment => ({ type: "vibrance", vibrance, saturation });
    const dull = run(v(100, 0), [140, 120, 110]);
    const vivid = run(v(100, 0), [20, 140, 230]);
    expect(dull[0] - dull[2]).toBeGreaterThan(30 + 5);
    expect(Math.abs(vivid[2] - 230)).toBeLessThan(15);
    const l = (230 + 20) / 2;
    near(run(v(0, -100), [20, 140, 230]), [l, l, l, 255], 1);
  });

  it("colour balance shifts channels by tone and can keep luminosity", () => {
    const zero = { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 };
    const a: Adjustment = { type: "color-balance", shadows: zero, midtones: { cyanRed: 100, magentaGreen: 0, yellowBlue: -100 }, highlights: zero, preserveLuminosity: false };
    const out = run(a, [128, 128, 128]);
    expect(out[0]).toBeGreaterThan(128 + 30);
    expect(out[2]).toBeLessThan(128 - 30);
    near([out[1]], [128], 0);
    const kept = run({ ...a, preserveLuminosity: true } as Adjustment, [128, 128, 128]);
    near([luma(kept[0], kept[1], kept[2])], [128], 2);
  });

  it("black & white: min + (mid−min)·secondary + (max−mid)·primary", () => {
    const w = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 };
    const a: Adjustment = { type: "black-white", weights: w };
    // [200, 100, 50]: max red, mid green → secondary yellow.
    const g = clamp(50 + (100 - 50) * 0.6 + (200 - 100) * 0.4);
    near(run(a, [200, 100, 50]), [g, g, g, 255]);
    const g2 = clamp(20 + (140 - 20) * 0.6 + (230 - 140) * 0.2); // max blue, mid green → cyan
    near(run(a, [20, 140, 230]), [g2, g2, g2, 255]);
    near(run(a, [128, 128, 128]), [128, 128, 128, 255]);
  });

  it("black & white tint keeps black and white and tints the middle", () => {
    const w = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 };
    const a: Adjustment = { type: "black-white", weights: w, tint: "#ff8000" };
    near(run(a, [0, 0, 0]), [0, 0, 0, 255], 0);
    near(run(a, [255, 255, 255]), [255, 255, 255, 255], 0);
    const mid = run(a, [128, 128, 128]);
    expect(mid[0]).toBeGreaterThan(mid[2] + 50);
  });

  it("photo filter: lerp(c, c·F, density), optionally keeping luma", () => {
    const a: Adjustment = { type: "photo-filter", color: "#ff8000", density: 0.5, preserveLuminosity: false };
    for (const s of SAMPLES) {
      const F = [1, 128 / 255, 0];
      near(run(a, s), [s[0] + (s[0] * F[0] - s[0]) * 0.5, s[1] + (s[1] * F[1] - s[1]) * 0.5, s[2] + (s[2] * F[2] - s[2]) * 0.5, 255].map(clamp), 1);
    }
    const kept = run({ ...a, preserveLuminosity: true } as Adjustment, [128, 128, 128]);
    near([luma(kept[0], kept[1], kept[2])], [128], 2);
  });

  it("channel mixer: out = Σ in·weight% + constant%", () => {
    const a: Adjustment = {
      type: "channel-mixer",
      monochrome: false,
      r: { r: 0, g: 100, b: 0, constant: 0 },
      g: { r: 100, g: 0, b: 0, constant: 0 },
      b: { r: 0, g: 0, b: 50, constant: 10 },
    };
    near(run(a, [200, 100, 50]), [100, 200, clamp(25 + 25.5), 255]);
    const mono: Adjustment = { type: "channel-mixer", monochrome: true, r: a.r, g: a.g, b: a.b, gray: { r: 40, g: 40, b: 20, constant: 0 } };
    const v = clamp(200 * 0.4 + 100 * 0.4 + 50 * 0.2);
    near(run(mono, [200, 100, 50]), [v, v, v, 255]);
  });
});

describe("filters", () => {
  it("blur keeps premultiplied edges (no dark halo)", () => {
    // A white square on transparent: every blurred pixel stays white, only alpha fades.
    const r = solidRaster(30, 30, [0, 0, 0, 0]);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) r.data.set([1, 1, 1, 1], (y * 30 + x) * 4);
    const out = applyFilter(r, { type: "blur", radius: 3 }, 1);
    const edge = px(out, 9, 15);
    expect(edge[3]).toBeGreaterThan(20);
    expect(edge[3]).toBeLessThan(250);
    expect(edge.slice(0, 3)).toEqual([255, 255, 255]);
    expect(px(out, 15, 15)[3]).toBeGreaterThan(200);
  });

  it("blur radius scales with the ratio", () => {
    const r = solidRaster(40, 40, [1, 0, 0, 0]);
    for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) r.data.set([1, 0, 0, 1], (y * 40 + x) * 4);
    const a = applyFilter(r, { type: "blur", radius: 2 }, 1);
    const b = applyFilter(r, { type: "blur", radius: 2 }, 2);
    expect(px(b, 30, 20)[3]).toBeGreaterThan(px(a, 30, 20)[3]);
  });

  it("adjust filter applies an adjustment to the element's own pixels", () => {
    const out = applyFilter(solidRaster(2, 2, [1, 0, 0, 0.5]), { type: "adjust", adjustment: { type: "invert" } }, 1);
    expect(px(out, 0, 0)).toEqual([0, 255, 255, 128]);
  });

  it("sharpen raises local contrast and leaves flat areas alone", () => {
    const r = solidRaster(20, 1, [0.5, 0.5, 0.5, 1]);
    for (let x = 10; x < 20; x++) r.data.set([0.8, 0.8, 0.8, 1], x * 4);
    const out = applyFilter(r, { type: "sharpen", amount: 1, radius: 2 }, 1);
    expect(px(out, 9, 0)[0]).toBeLessThan(126);
    expect(px(out, 10, 0)[0]).toBeGreaterThan(206);
    expect(px(out, 0, 0)[0]).toBe(128);
  });

  it("noise is deterministic, changes pixels and keeps alpha", () => {
    const f = { type: "noise" as const, amount: 0.3, mono: true };
    const a = applyFilter(solidRaster(8, 8, [0.5, 0.5, 0.5, 1]), f, 1);
    const b = applyFilter(solidRaster(8, 8, [0.5, 0.5, 0.5, 1]), f, 1);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    const vals = new Set<number>();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const p = px(a, x, y);
      expect(p[3]).toBe(255);
      expect(p[0]).toBe(p[1]);
      vals.add(p[0]);
    }
    expect(vals.size).toBeGreaterThan(5);
  });
});
