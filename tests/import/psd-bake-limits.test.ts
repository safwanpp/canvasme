import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Layer, LayerEffectsInfo, Psd } from "ag-psd";

// Spy on the raster conversion and the bake so the tests can see what ran and make it fail.
const spies = vi.hoisted(() => ({ fromImageData: vi.fn(), bakeError: null as Error | null }));
vi.mock("@/lib/fx/raster", async (orig) => {
  const mod = await orig<typeof import("@/lib/fx/raster")>();
  spies.fromImageData.mockImplementation(mod.fromImageData);
  return { ...mod, fromImageData: spies.fromImageData };
});
vi.mock("@/lib/fx/bake", async (orig) => {
  const mod = await orig<typeof import("@/lib/fx/bake")>();
  return {
    ...mod,
    bakeEffects: (...args: Parameters<typeof mod.bakeEffects>) => {
      if (spies.bakeError) throw spies.bakeError;
      return mod.bakeEffects(...args);
    },
  };
});

import { MAX_BAKE_PIXELS } from "@/lib/fx/bake";
import { convert } from "@/lib/importers/psdConvert";
import { pixelLayer, textLayer } from "../fixtures/psd";

const px = (value: number) => ({ units: "Pixels" as const, value });
const io = { encode: async (rgba: Uint8ClampedArray) => new Blob([rgba as Uint8ClampedArray<ArrayBuffer>]) };
const satin: LayerEffectsInfo = { satin: { enabled: true, size: px(2) } };
const doc = (children: Layer[]): Psd => ({ width: 200, height: 200, children });

beforeEach(() => {
  spies.fromImageData.mockClear();
  spies.bakeError = null;
});

describe("convert bake limits and errors", () => {
  it("a layer past the bake cap is not converted to a float raster at all", async () => {
    const side = Math.ceil(Math.sqrt(MAX_BAKE_PIXELS)) + 1;
    const r = await convert(doc([pixelLayer({ name: "Huge", w: side, h: side, extra: { effects: satin } })]), () => {}, io);
    expect(spies.fromImageData).not.toHaveBeenCalled();
    expect(r.nodes[0].issues).toEqual([{ kind: "dropped", message: "Satin left out: the layer is too large to bake." }]);
  });

  it("other bake failures say the effects couldn't be baked, not that the layer is too large", async () => {
    spies.bakeError = new Error("boom");
    const r = await convert(doc([pixelLayer({ name: "Small", w: 20, h: 20, extra: { effects: satin } })]), () => {}, io);
    expect(r.nodes[0].issues).toEqual([{ kind: "dropped", message: "Couldn't bake Satin; it was left out." }]);
  });

  it("a bake that grows past the cap is still reported as too large", async () => {
    const { BakeTooLargeError } = await import("@/lib/fx/bake");
    spies.bakeError = new BakeTooLargeError();
    const r = await convert(doc([pixelLayer({ w: 20, h: 20, extra: { effects: satin } })]), () => {}, io);
    expect(r.nodes[0].issues?.[0].message).toMatch(/too large to bake/);
  });
});

describe("text layer hostile input", () => {
  it("an unknown justification falls back to left", async () => {
    const layer = textLayer({ text: "Hi", left: 10, top: 10 });
    layer.text!.paragraphStyle = { justification: "constructor" as never };
    const r = await convert(doc([layer]), () => {}, io);
    expect(r.nodes[0].text!.align).toBe("left");
  });

  it("grey text uses the engine-data grey level", async () => {
    const layer = textLayer({ text: "Hi", left: 10, top: 10 });
    layer.text!.style!.fillColor = { k: 204 };
    const r = await convert(doc([layer]), () => {}, io);
    expect(r.nodes[0].text!.fill).toBe("#cccccc");
  });
});
