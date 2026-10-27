import { expect } from "vitest";

import type { Raster } from "@/lib/fx/raster";

export type { Raster };

type Px = [number, number, number, number];

/** A raster filled with one colour, given straight (not premultiplied) in 0..1. */
export function solidRaster(w: number, h: number, rgba: Px): Raster {
  const [r, g, b, a] = rgba;
  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r * a, g * a, b * a, a], i);
  return { w, h, data };
}

/** One pixel as straight RGBA in 0..255, rounded. */
export function px(r: Raster, x: number, y: number): Px {
  const i = (y * r.w + x) * 4;
  const a = r.data[i + 3];
  if (a <= 0) return [0, 0, 0, 0];
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v / a)) * 255);
  return [c(r.data[i]), c(r.data[i + 1]), c(r.data[i + 2]), Math.round(a * 255)];
}

/** Each channel within `tol` levels of the expected value. */
export function expectPx(actual: Px, expected: Px, tol = 2) {
  const off = actual.some((v, i) => Math.abs(v - expected[i]) > tol);
  expect(off, `pixel [${actual}] should be within ${tol} of [${expected}]`).toBe(false);
}
