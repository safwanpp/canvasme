// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { blendPixel, compositeInto, isNativeBlend, NATIVE_BLEND } from "@/lib/fx/blend";
import type { BlendMode } from "@/lib/effects";
import { expectPx, px, solidRaster } from "../fixtures/raster";

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as never;
const to255 = (c: number[]) => c.map((v) => Math.round(v * 255));

const NATIVE: BlendMode[] = [
  "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light",
  "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity",
];

/** Modes where Cairo (node-canvas) is known to differ from the W3C formulas browsers follow. */
const ENGINE_DIFF = new Set<BlendMode>();

describe("blend formulas", () => {
  it("native modes match canvas", () => {
    const B = "#3366cc";
    const S = "#cc9933";
    for (const mode of NATIVE) {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = B;
      ctx.fillRect(0, 0, 1, 1);
      ctx.globalCompositeOperation = NATIVE_BLEND[mode]!;
      ctx.fillStyle = S;
      ctx.fillRect(0, 0, 1, 1);
      const got = Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
      const ours = to255(blendPixel(mode, hex(B), hex(S)));
      const off = got.some((v, i) => Math.abs(v - ours[i]) > 2);
      if (off) ENGINE_DIFF.add(mode);
      if (!off) expect(off, `${mode}: canvas ${got} vs ours ${ours}`).toBe(false);
    }
    if (ENGINE_DIFF.size) console.info("cairo differs:", [...ENGINE_DIFF].join(", "));
    // Every engine difference must be a known one, so a broken formula can't hide here.
    expect([...ENGINE_DIFF].filter((m) => !["soft-light", "hue", "saturation", "color", "luminosity"].includes(m))).toEqual([]);
  });

  it("W3C reference values", () => {
    // Hand-computed from the W3C compositing spec for B=#3366cc, S=#cc9933.
    expect(to255(blendPixel("multiply", hex("#3366cc"), hex("#cc9933")))).toEqual([41, 61, 41]);
    expect(to255(blendPixel("screen", hex("#3366cc"), hex("#cc9933")))).toEqual([214, 194, 214]);
    expect(to255(blendPixel("luminosity", hex("#808080"), hex("#ffffff")))).toEqual([255, 255, 255]);
    expect(to255(blendPixel("color", hex("#808080"), hex("#808080")))).toEqual([128, 128, 128]);
  });

  const cases: Record<string, [string, string, number[]][]> = {
    "linear-burn": [
      ["#808080", "#808080", [1, 1, 1]],
      ["#c0c0c0", "#808080", [65, 65, 65]],
      ["#ffffff", "#336699", [51, 102, 153]],
    ],
    "vivid-light": [
      ["#808080", "#ffffff", [255, 255, 255]],
      ["#808080", "#000000", [0, 0, 0]],
      ["#808080", "#c0c0c0", [255, 255, 255]],
    ],
    "pin-light": [
      ["#808080", "#202020", [64, 64, 64]],
      ["#808080", "#e0e0e0", [193, 193, 193]],
      ["#404040", "#808080", [64, 64, 64]],
    ],
    "hard-mix": [
      ["#808080", "#808080", [255, 255, 255]],
      ["#404040", "#404040", [0, 0, 0]],
      ["#c0c0c0", "#606060", [255, 255, 255]],
    ],
    subtract: [
      ["#808080", "#404040", [64, 64, 64]],
      ["#404040", "#808080", [0, 0, 0]],
      ["#ff8000", "#0080ff", [255, 0, 0]],
    ],
    divide: [
      ["#404040", "#808080", [128, 128, 128]],
      ["#808080", "#000000", [255, 255, 255]],
      ["#808080", "#404040", [255, 255, 255]],
    ],
    "darker-color": [
      ["#ff0000", "#00ff00", [255, 0, 0]],
      ["#0000ff", "#ffffff", [0, 0, 255]],
      ["#808080", "#404040", [64, 64, 64]],
    ],
  };
  for (const [mode, rows] of Object.entries(cases)) {
    it(mode.replace("-", " "), () => {
      for (const [b, s, want] of rows) {
        const got = to255(blendPixel(mode as BlendMode, hex(b), hex(s)));
        got.forEach((v, i) => expect(Math.abs(v - want[i]), `${mode}(${b}, ${s}) = ${got}`).toBeLessThanOrEqual(1));
      }
    });
  }

  it("isNativeBlend", () => {
    expect(isNativeBlend(undefined)).toBe(true);
    expect(isNativeBlend("normal")).toBe(true);
    expect(isNativeBlend("linear-dodge")).toBe(true);
    expect(isNativeBlend("linear-burn")).toBe(false);
    expect(isNativeBlend("dissolve")).toBe(false);
  });
});

describe("compositeInto", () => {
  it("compositeInto with opacity 0 is a no-op", () => {
    const dst = solidRaster(4, 4, [0.2, 0.4, 0.6, 1]);
    const before = Float32Array.from(dst.data);
    compositeInto(dst, solidRaster(4, 4, [1, 0, 0, 1]), "multiply", 0);
    expect(Array.from(dst.data)).toEqual(Array.from(before));
  });

  it("normal over opaque replaces", () => {
    const dst = solidRaster(2, 2, [0, 0, 1, 1]);
    compositeInto(dst, solidRaster(2, 2, [1, 0, 0, 1]), "normal", 1);
    expectPx(px(dst, 1, 1), [255, 0, 0, 255]);
  });

  it("mask halves alpha", () => {
    const dst = solidRaster(2, 2, [0, 0, 0, 0]);
    compositeInto(dst, solidRaster(2, 2, [1, 0, 0, 1]), "normal", 1, new Float32Array(4).fill(0.5));
    expectPx(px(dst, 0, 0), [255, 0, 0, 128]);
  });

  it("multiply over transparent shows the source", () => {
    const dst = solidRaster(2, 2, [0, 0, 0, 0]);
    compositeInto(dst, solidRaster(2, 2, [1, 0, 0, 1]), "multiply", 1);
    expectPx(px(dst, 0, 0), [255, 0, 0, 255]);
  });

  it("places src at an offset and clips", () => {
    const dst = solidRaster(4, 4, [0, 0, 0, 0]);
    compositeInto(dst, solidRaster(2, 2, [0, 1, 0, 1]), "normal", 1, undefined, { x: 3, y: -1 });
    expectPx(px(dst, 3, 0), [0, 255, 0, 255]);
    expectPx(px(dst, 2, 0), [0, 0, 0, 0]);
    expectPx(px(dst, 3, 1), [0, 0, 0, 0]);
  });

  it("dissolve keeps alpha binary with about the right coverage", () => {
    const dst = solidRaster(64, 64, [0, 0, 0, 0]);
    compositeInto(dst, solidRaster(64, 64, [1, 1, 1, 1]), "dissolve", 0.5);
    let on = 0;
    for (let i = 3; i < dst.data.length; i += 4) {
      expect(dst.data[i] === 0 || dst.data[i] === 1).toBe(true);
      on += dst.data[i];
    }
    expect(Math.abs(on / 4096 - 0.5)).toBeLessThan(0.05);
  });
});
