import { describe, expect, it } from "vitest";
import { createRaster, toPixels } from "@/lib/fx/raster";

describe("toPixels", () => {
  it("rounds alpha to the nearest level, so float residue stays transparent", () => {
    const r = createRaster(3, 1);
    // A blur's running sums leave residue like 1e-8 where it should be 0.
    r.data.set([0, 0, 0, 1e-8, 0.2, 0.2, 0.2, 0.2, 0.5, 0.5, 0.5, 0.5]);
    const px = toPixels(r);
    expect(px[3]).toBe(0);
    expect(px[7]).toBe(51);
    expect(px[11]).toBe(128);
  });
});
