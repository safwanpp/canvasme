import { describe, expect, it } from "vitest";
import { dilateAlpha, signedDistance } from "@/lib/fx/distance";

function square(w: number, h: number, x0: number, y0: number, s: number) {
  const a = new Float32Array(w * h);
  for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) a[y * w + x] = 1;
  return a;
}

describe("signedDistance", () => {
  it("distance of a filled 20×20 square in 40×40", () => {
    const a = square(40, 40, 10, 10, 20);
    const d = signedDistance(a, 40, 40);
    // Pixel centres: (19.5, 19.5) is 10 from each edge; (0,0)'s centre is 10 from the corner each way.
    expect(Math.abs(d[20 * 40 + 20] - -10)).toBeLessThan(0.6);
    expect(Math.abs(d[0] - Math.hypot(10, 10))).toBeLessThan(0.6);
    expect(Math.abs(d[20 * 40 + 10])).toBeLessThan(0.6);
  });

  it("empty alpha is far outside everywhere", () => {
    const d = signedDistance(new Float32Array(16), 4, 4);
    expect(d.every((v) => v > 4)).toBe(true);
  });
});

describe("dilateAlpha", () => {
  it("dilate by 3 grows a 10px square to ~16px", () => {
    const a = square(40, 40, 15, 15, 10);
    const out = dilateAlpha(a, 40, 40, 3);
    let n = 0;
    for (const v of out) if (v > 0.5) n++;
    expect(Math.abs(n - 16 * 16)).toBeLessThanOrEqual(20);
  });

  it("uses a precomputed field", () => {
    const a = square(20, 20, 5, 5, 10);
    const d = signedDistance(a, 20, 20);
    expect(Array.from(dilateAlpha(a, 20, 20, 2, d))).toEqual(Array.from(dilateAlpha(a, 20, 20, 2)));
  });
});
