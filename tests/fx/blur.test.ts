import { describe, expect, it } from "vitest";
import { gaussianBlur } from "@/lib/fx/blur";

const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);

describe("gaussianBlur", () => {
  it("blur preserves total mass", () => {
    const w = 64;
    const ch = new Float32Array(w * w);
    ch[32 * w + 32] = 1;
    const sigma = 4;
    const out = gaussianBlur(ch, w, w, sigma);
    expect(Math.abs(sum(out) - 1)).toBeLessThan(1e-3);
    const peak = 1 / (2 * Math.PI * sigma * sigma);
    expect(Math.abs(out[32 * w + 32] - peak) / peak).toBeLessThan(0.15);
  });

  it("blur sigma 0 is identity", () => {
    const ch = Float32Array.from({ length: 100 }, (_, i) => (i % 7) / 7);
    const out = gaussianBlur(ch, 10, 10, 0);
    expect(Array.from(out)).toEqual(Array.from(ch));
    expect(out).not.toBe(ch);
  });

  it("blur of a flat field stays flat (edges clamp to zero outside)", () => {
    const ch = new Float32Array(40 * 40).fill(1);
    const out = gaussianBlur(ch, 40, 40, 2);
    expect(out[20 * 40 + 20]).toBeCloseTo(1, 4);
    expect(out[0]).toBeLessThan(0.9);
  });

  it.skipIf(process.env.CI)("blur of 2000×2000 runs under 400 ms", () => {
    const ch = new Float32Array(2000 * 2000);
    ch[1000 * 2000 + 1000] = 1;
    const t = performance.now();
    gaussianBlur(ch, 2000, 2000, 20);
    expect(performance.now() - t).toBeLessThan(400);
  });
});
