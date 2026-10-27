import { describe, expect, it } from "vitest";
import type { LayerEffectsInfo, Psd } from "ag-psd";
import { Effects, type Effects as Fx } from "@/lib/effects";
import {
  BLEND_TO_PSD,
  colorHex,
  textColorHex,
  mapBlendMode,
  modelEffectsToPsd,
  PSD_TO_BLEND,
  psdEffectsToModel,
  scaleEffects,
  unitsToPx,
} from "@/lib/importers/psdEffects";
import { convert } from "@/lib/importers/psdConvert";
import { buildPsd, pixelLayer, readFixture, textLayer } from "../fixtures/psd";

const px = (value: number) => ({ units: "Pixels" as const, value });
const ctx = { dpi: 72, globalAngle: 120 };
const io = { encode: async (rgba: Uint8ClampedArray) => new Blob([rgba as Uint8ClampedArray<ArrayBuffer>]) };
const run = (psd: Psd) => convert(psd, () => {}, io);
const black = { r: 0, g: 0, b: 0 };

/** Deep-equal with a numeric tolerance. */
function near(a: unknown, b: unknown, tol = 1e-3, path = "$"): void {
  if (typeof a === "number" && typeof b === "number") {
    expect(Math.abs(a - b), `${path}: ${a} vs ${b}`).toBeLessThanOrEqual(tol);
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tol, `${path}.${k}`);
    return;
  }
  expect(a, path).toEqual(b);
}

describe("units and blend modes", () => {
  it("points convert at 144 dpi", () => {
    expect(unitsToPx({ units: "Points", value: 10 }, 144)).toBeCloseTo(20);
    expect(unitsToPx(px(7), 144)).toBe(7);
    expect(unitsToPx(undefined, 72)).toBe(0);
  });

  it("every PSD blend mode maps, with the PSD-only ones to their model names", () => {
    expect(PSD_TO_BLEND["linear dodge"]).toBe("linear-dodge");
    expect(PSD_TO_BLEND["subtraction"]).toBe("subtract");
    expect(PSD_TO_BLEND["vivid light"]).toBe("vivid-light");
    expect(BLEND_TO_PSD["linear-dodge"]).toBe("linear dodge");
    expect(BLEND_TO_PSD["pass-through"]).toBe("pass through");
  });

  it("layer blend: pass through on a layer is normal, height modes are approximated", () => {
    expect(mapBlendMode("multiply")).toEqual({ mode: "multiply" });
    expect(mapBlendMode("normal")).toEqual({});
    expect(mapBlendMode(undefined)).toEqual({});
    expect(mapBlendMode("pass through")).toEqual({});
    expect(mapBlendMode("linear height").mode).toBeUndefined();
    expect(mapBlendMode("linear height").approximated).toBe(true);
  });
});

describe("psdEffectsToModel", () => {
  it("drop shadow maps with global light", () => {
    const { effects } = psdEffectsToModel(
      { dropShadow: [{ enabled: true, useGlobalLight: true, angle: 90, size: px(8), distance: px(5), color: { r: 255, g: 0, b: 0 }, opacity: 0.5, blendMode: "screen" }] },
      { dpi: 72, globalAngle: 30 },
    );
    expect(effects!.dropShadow![0]).toMatchObject({ angle: 30, size: 8, distance: 5, color: "#ff0000", opacity: 0.5, blendMode: "screen", enabled: true });
  });

  it("shadow without a blend mode defaults to multiply, glow to screen", () => {
    const { effects } = psdEffectsToModel({ dropShadow: [{ enabled: true, size: px(1) }], outerGlow: { enabled: true, size: px(1) } }, ctx);
    expect(effects!.dropShadow![0].blendMode).toBe("multiply");
    expect(effects!.outerGlow!.blendMode).toBe("screen");
  });

  it("choke percent to spread and choke", () => {
    const { effects } = psdEffectsToModel(
      {
        dropShadow: [{ enabled: true, choke: px(25), layerConceals: false }],
        innerShadow: [{ enabled: true, choke: px(40) }],
        outerGlow: { enabled: true, choke: px(10) },
        innerGlow: { enabled: true, choke: px(60), source: "center", technique: "precise" },
      },
      ctx,
    );
    expect(effects!.dropShadow![0].spread).toBeCloseTo(0.25);
    expect(effects!.dropShadow![0].knockout).toBe(false);
    expect(effects!.innerShadow![0].choke).toBeCloseTo(0.4);
    expect(effects!.outerGlow!.spread).toBeCloseTo(0.1);
    expect(effects!.innerGlow).toMatchObject({ choke: 0.6, source: "center", technique: "precise" });
  });

  it("points convert at the file's dpi and effects.scale multiplies sizes", () => {
    const { effects } = psdEffectsToModel(
      { scale: 2, dropShadow: [{ enabled: true, size: { units: "Points", value: 10 }, distance: px(3) }], stroke: [{ enabled: true, size: px(2), color: black }] },
      { dpi: 144, globalAngle: 120 },
    );
    expect(effects!.dropShadow![0].size).toBeCloseTo(40);
    expect(effects!.dropShadow![0].distance).toBeCloseTo(6);
    expect(effects!.stroke![0].size).toBeCloseTo(4);
  });

  it("multiple drop shadows and strokes keep their order", () => {
    const { effects } = psdEffectsToModel(
      {
        dropShadow: [
          { enabled: true, size: px(1), color: { r: 255, g: 0, b: 0 } },
          { enabled: false, size: px(2), color: { r: 0, g: 255, b: 0 } },
        ],
        stroke: [
          { enabled: true, size: px(3), position: "inside", color: black },
          { enabled: true, size: px(6), position: "center", color: { r: 0, g: 0, b: 255 } },
        ],
      },
      ctx,
    );
    expect(effects!.dropShadow!.map((s) => [s.color, s.enabled])).toEqual([
      ["#ff0000", true],
      ["#00ff00", false],
    ]);
    expect(effects!.stroke!.map((s) => [s.size, s.position])).toEqual([
      [3, "inside"],
      [6, "center"],
    ]);
  });

  it("solidFill maps to colorOverlay array", () => {
    const { effects } = psdEffectsToModel({ solidFill: [{ enabled: true, color: { r: 0, g: 0, b: 255 }, opacity: 0.6, blendMode: "multiply" }] }, ctx);
    expect(effects!.colorOverlay).toEqual([{ enabled: true, color: "#0000ff", opacity: 0.6, blendMode: "multiply" }]);
  });

  it("stroke gradient maps; pattern stroke reported unsupported", () => {
    const { effects, unsupported } = psdEffectsToModel(
      {
        stroke: [
          {
            enabled: true,
            size: px(4),
            fillType: "gradient",
            gradient: {
              name: "g",
              type: "solid",
              colorStops: [
                { color: black, location: 0, midpoint: 0.5 },
                { color: { r: 255, g: 255, b: 255 }, location: 1, midpoint: 0.5 },
              ],
              opacityStops: [],
              style: "radial",
              scale: 1.5,
              angle: 45,
            },
          },
          { enabled: true, size: px(2), fillType: "pattern", pattern: { name: "p", id: "x" } },
        ],
      },
      ctx,
    );
    expect(effects!.stroke).toHaveLength(1);
    const paint = effects!.stroke![0].paint;
    expect(paint.type).toBe("gradient");
    if (paint.type === "gradient") expect(paint.gradient).toMatchObject({ style: "radial", scale: 1.5, angle: 45 });
    expect(unsupported).toContain("patternStroke");
  });

  it("disabled fx imports as enabled:false", () => {
    const { effects } = psdEffectsToModel(
      { disabled: true, dropShadow: [{ enabled: true, size: px(2) }], solidFill: [{ enabled: true, color: black }], outerGlow: { enabled: true } },
      ctx,
    );
    expect(effects!.dropShadow![0].enabled).toBe(false);
    expect(effects!.colorOverlay![0].enabled).toBe(false);
    expect(effects!.outerGlow!.enabled).toBe(false);
  });

  it("gradient locations normalized 0..1, taken as-is", () => {
    const { effects } = psdEffectsToModel(
      {
        gradientOverlay: [
          {
            enabled: true,
            type: "linear",
            angle: 0,
            scale: 1.5,
            offset: { x: 0.2, y: -0.1 },
            reverse: true,
            align: false,
            gradient: {
              name: "g",
              type: "solid",
              colorStops: [
                { color: black, location: 0, midpoint: 0.5 },
                { color: { r: 255, g: 0, b: 0 }, location: 0.25, midpoint: 0.3 },
                { color: { r: 255, g: 255, b: 255 }, location: 1, midpoint: 0.5 },
              ],
              opacityStops: [
                { opacity: 1, location: 0, midpoint: 0.5 },
                { opacity: 0.2, location: 1, midpoint: 0.5 },
              ],
            },
          },
        ],
      },
      ctx,
    );
    const g = effects!.gradientOverlay![0];
    expect(g.alignWithLayer).toBe(false);
    expect(g.gradient.stops.map((s) => s.offset)).toEqual([0, 0.25, 1]);
    expect(g.gradient.stops[1].midpoint).toBeCloseTo(0.3);
    expect(g.gradient.stops[0].midpoint).toBeUndefined();
    expect(g.gradient.opacityStops!.map((s) => s.opacity)).toEqual([1, 0.2]);
    expect(g.gradient).toMatchObject({ style: "linear", angle: 0, scale: 1.5, reverse: true, offset: { x: 0.2, y: -0.1 } });
  });

  it("noise gradients, bevel, satin and pattern overlay are unsupported", () => {
    const { effects, unsupported } = psdEffectsToModel(
      {
        gradientOverlay: [{ enabled: true, gradient: { name: "n", type: "noise", min: [0, 0, 0, 0], max: [1, 1, 1, 1] } }],
        bevel: { enabled: true, style: "inner bevel" },
        satin: { enabled: true },
        patternOverlay: { enabled: true, pattern: { name: "p", id: "x" } },
      },
      ctx,
    );
    expect(effects).toBeUndefined();
    expect(unsupported.sort()).toEqual(["bevel", "noiseGradient", "patternOverlay", "satin"]);
  });

  it("disabled unsupported effects are not reported", () => {
    const { unsupported } = psdEffectsToModel({ bevel: { enabled: false } }, ctx);
    expect(unsupported).toEqual([]);
  });

  it("glow noise and jitter are approximated, not baked", () => {
    const r = psdEffectsToModel({ outerGlow: { enabled: true, size: px(4), noise: 0.3 } }, ctx);
    expect(r.unsupported).toEqual([]);
    expect(r.approximated).toEqual(["glowNoise"]);
    expect(r.effects!.outerGlow!.size).toBe(4);
  });

  it("a non-linear contour maps to 0..1, a linear one is dropped", () => {
    const { effects } = psdEffectsToModel(
      {
        dropShadow: [
          { enabled: true, contour: { name: "c", curve: [{ x: 0, y: 0 }, { x: 128, y: 255 }, { x: 255, y: 0 }] } },
          { enabled: true, contour: { name: "Linear", curve: [{ x: 0, y: 0 }, { x: 255, y: 255 }] } },
        ],
      },
      ctx,
    );
    expect(effects!.dropShadow![0].contour).toEqual([
      { x: 0, y: 0 },
      { x: 128 / 255, y: 1 },
      { x: 1, y: 0 },
    ]);
    expect(effects!.dropShadow![1].contour).toBeUndefined();
  });

  it("output always parses with the model schema", () => {
    const { effects } = psdEffectsToModel(
      { dropShadow: [{ enabled: true, size: px(900), distance: px(-3), opacity: 2 }], stroke: [{ enabled: true, size: px(400) }] },
      ctx,
    );
    expect(Effects.safeParse(effects).success).toBe(true);
    expect(effects!.dropShadow![0].size).toBe(250);
  });
});

const ALL: Fx = {
  dropShadow: [
    { enabled: true, blendMode: "multiply", opacity: 0.75, color: "#102030", angle: 120, distance: 5, size: 8, spread: 0.2, knockout: true },
    { enabled: false, blendMode: "normal", opacity: 0.5, color: "#ff0000", angle: 30, distance: 2, size: 3, spread: 0, knockout: false },
  ],
  innerShadow: [{ enabled: true, blendMode: "multiply", opacity: 0.5, color: "#000000", angle: 90, distance: 4, size: 6, choke: 0.1 }],
  outerGlow: { enabled: true, blendMode: "screen", opacity: 0.8, color: "#ffd54a", size: 12, spread: 0.3, technique: "precise" },
  innerGlow: { enabled: true, blendMode: "screen", opacity: 0.6, color: "#ffffff", size: 9, choke: 0.2, technique: "softer", source: "center" },
  stroke: [
    { enabled: true, blendMode: "normal", opacity: 1, size: 4, position: "outside", paint: { type: "color", color: "#00ff00" } },
    {
      enabled: true,
      blendMode: "normal",
      opacity: 1,
      size: 2,
      position: "inside",
      paint: {
        type: "gradient",
        gradient: { style: "reflected", angle: 45, scale: 1.2, reverse: false, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] },
      },
    },
  ],
  colorOverlay: [{ enabled: true, blendMode: "color", opacity: 0.4, color: "#3e3aa8" }],
  gradientOverlay: [
    {
      enabled: true,
      blendMode: "overlay",
      opacity: 0.9,
      alignWithLayer: true,
      gradient: {
        style: "linear",
        angle: 90,
        scale: 1,
        reverse: true,
        offset: { x: 0.1, y: 0.2 },
        stops: [
          { offset: 0, color: "#3e3aa8" },
          { offset: 0.4, color: "#ff0000", midpoint: 0.3 },
          { offset: 1, color: "#0e1530" },
        ],
        opacityStops: [
          { offset: 0, opacity: 1 },
          { offset: 1, opacity: 0.5 },
        ],
      },
    },
  ],
};

describe("modelEffectsToPsd", () => {
  it("export writes enabled explicitly on every effect", () => {
    const out = modelEffectsToPsd(ALL)!;
    expect(out.dropShadow!.map((s) => s.enabled)).toEqual([true, false]);
    expect(out.innerShadow![0].enabled).toBe(true);
    expect(out.outerGlow!.enabled).toBe(true);
    expect(out.innerGlow!.enabled).toBe(true);
    expect(out.stroke!.every((s) => s.enabled === true)).toBe(true);
    expect(out.solidFill![0].enabled).toBe(true);
    expect(out.gradientOverlay![0].enabled).toBe(true);
    expect(modelEffectsToPsd(undefined)).toBeUndefined();
  });

  it("round trip model→psd→model is identity for every supported kind", () => {
    const back = psdEffectsToModel(modelEffectsToPsd(ALL), ctx);
    expect(back.unsupported).toEqual([]);
    near(back.effects, ALL);
  });

  it("round trip survives a binary .psd write and read", () => {
    const psd = readFixture(buildPsd([pixelLayer({ w: 10, h: 10, extra: { effects: modelEffectsToPsd(ALL) as LayerEffectsInfo } })]));
    const back = psdEffectsToModel(psd.children![0].effects, ctx);
    // Percentages quantize to whole percent, stop locations to 1/4096.
    near(back.effects, ALL, 1e-2);
  });
});

describe("calibration with generated fixtures", () => {
  it("gradient stops keep 0..1 locations at smoothness below 100% (Intr < 4096)", () => {
    const g = modelEffectsToPsd(ALL)!.gradientOverlay![0];
    g.gradient = { ...(g.gradient as object), smoothness: 0.5 } as typeof g.gradient;
    const psd = readFixture(buildPsd([pixelLayer({ w: 10, h: 10, extra: { effects: { gradientOverlay: [g] } } })]));
    const back = psdEffectsToModel(psd.children![0].effects, ctx).effects!.gradientOverlay![0].gradient;
    expect(back.stops.map((s) => s.offset)).toEqual([0, expect.closeTo(0.4, 2), 1]);
  });
});

describe("scaleEffects", () => {
  it("scales sizes and distances, not spreads or opacities", () => {
    const s = scaleEffects(ALL, 0.5)!;
    expect(s.dropShadow![0]).toMatchObject({ size: 4, distance: 2.5, spread: 0.2, opacity: 0.75 });
    expect(s.stroke![0].size).toBe(2);
    expect(s.outerGlow!.size).toBe(6);
    expect(scaleEffects(ALL, 1)).toBe(ALL);
    expect(scaleEffects(undefined, 0.5)).toBeUndefined();
  });
});

describe("convert keeps effects, blend modes and fill opacity", () => {
  it("fillOpacity kept separate from opacity", async () => {
    const r = await run(readFixture(buildPsd([pixelLayer({ w: 4, h: 4, extra: { opacity: 0.5, fillOpacity: 0.4 } })])));
    expect(r.nodes[0].opacity).toBeCloseTo(0.5, 2);
    expect(r.nodes[0].fillOpacity).toBeCloseTo(0.4, 2);
  });

  it("fill opacity of 1 is omitted", async () => {
    const r = await run(readFixture(buildPsd([pixelLayer({ w: 4, h: 4 })])));
    expect(r.nodes[0].fillOpacity).toBeUndefined();
  });

  it("blend mode kept: native, software and linear dodge", async () => {
    const modes = ["multiply", "vivid light", "linear dodge", "pass through", "normal"] as const;
    const r = await run(readFixture(buildPsd(modes.map((m) => pixelLayer({ name: m, w: 4, h: 4, extra: { blendMode: m } })))));
    expect(r.nodes.map((n) => n.blendMode)).toEqual(["multiply", "vivid-light", "linear-dodge", undefined, undefined]);
    expect(r.notes.join(" ")).not.toMatch(/Blend modes/);
    expect(r.lossy).toBe(false);
  });

  it("height blend modes come in as normal with an issue", async () => {
    // ag-psd writes "linear height" as normal, so this builds the parsed object directly.
    const r = await run({ width: 10, height: 10, children: [pixelLayer({ w: 4, h: 4, extra: { blendMode: "linear height" } })] });
    expect(r.nodes[0].blendMode).toBeUndefined();
    expect(r.nodes[0].issues?.[0]).toMatchObject({ kind: "approximated" });
    expect(r.lossy).toBe(true);
  });

  it("supported effects come through editable, without the old note", async () => {
    const fx: LayerEffectsInfo = { dropShadow: [{ enabled: true, size: px(4), distance: px(3), angle: 90, color: black, opacity: 0.5 }] };
    const r = await run(readFixture(buildPsd([pixelLayer({ w: 4, h: 4, extra: { effects: fx } })])));
    expect(r.nodes[0].effects!.dropShadow![0]).toMatchObject({ size: 4, distance: 3, angle: 90 });
    expect(r.notes.join(" ")).not.toMatch(/Layer effects/);
    expect(r.lossy).toBe(false);
  });

  it("global light comes from the file", async () => {
    const fx: LayerEffectsInfo = { dropShadow: [{ enabled: true, useGlobalLight: true, angle: 10, size: px(2), distance: px(2) }] };
    const r = await run(readFixture(buildPsd([pixelLayer({ w: 4, h: 4, extra: { effects: fx } })], { extra: { imageResources: { globalAngle: 45 } } })));
    expect(r.nodes[0].effects!.dropShadow![0].angle).toBe(45);
  });

  it("hidden layers keep their effects and stay hidden", async () => {
    const fx: LayerEffectsInfo = { stroke: [{ enabled: true, size: px(2), color: black }] };
    const r = await run(readFixture(buildPsd([pixelLayer({ w: 4, h: 4, extra: { hidden: true, effects: fx } })])));
    expect(r.nodes[0].hidden).toBe(true);
    expect(r.nodes[0].effects!.stroke![0].size).toBe(2);
  });

  it("text layers with effects keep editable text and effects", async () => {
    const fx: LayerEffectsInfo = { stroke: [{ enabled: true, size: px(3), color: { r: 255, g: 255, b: 255 } }], solidFill: [{ enabled: true, color: black }] };
    const layer = textLayer({ text: "Hi", left: 10, top: 10, extra: { effects: fx, blendMode: "screen", fillOpacity: 0 } });
    const r = await run(readFixture(buildPsd([layer])));
    expect(r.nodes[0].text?.text).toBe("Hi");
    expect(r.nodes[0].effects!.stroke![0].size).toBe(3);
    expect(r.nodes[0].effects!.colorOverlay![0].color).toBe("#000000");
    expect(r.nodes[0].blendMode).toBe("screen");
    expect(r.nodes[0].fillOpacity).toBe(0);
  });
});

describe("hostile and unusual input", () => {
  it("descriptor CMYK is percent ink", () => {
    expect(colorHex({ c: 0, m: 0, y: 0, k: 0 })).toBe("#ffffff");
    expect(colorHex({ c: 0, m: 0, y: 0, k: 100 })).toBe("#000000");
    expect(colorHex({ c: 100, m: 0, y: 0, k: 0 })).toBe("#00ffff");
    expect(colorHex({ c: 0, m: 0, y: 0, k: 50 })).toBe("#808080");
  });

  it("descriptor grey is percent ink", () => {
    expect(colorHex({ k: 0 })).toBe("#ffffff");
    expect(colorHex({ k: 75 })).toBe("#404040");
  });

  it("text colours use ag-psd's 0..255 engine-data scale", () => {
    // Engine data grey is the grey level: 0 black, 255 white.
    expect(textColorHex({ k: 255 })).toBe("#ffffff");
    expect(textColorHex({ k: 204 })).toBe("#cccccc");
    expect(textColorHex({ k: 0 })).toBe("#000000");
    expect(textColorHex({ c: 0, m: 0, y: 0, k: 255 })).toBe("#000000");
    expect(textColorHex({ c: 255, m: 0, y: 0, k: 0 })).toBe("#00ffff");
    expect(textColorHex({ r: 10, g: 20, b: 30 })).toBe("#0a141e");
  });

  it("non-numeric channels never give NaN in a colour", () => {
    expect(colorHex({ r: NaN, g: 0, b: Infinity })).toBe("#0000ff");
    expect(colorHex({ fr: NaN, fg: 1, fb: 0 })).toBe("#00ff00");
    expect(textColorHex({ k: NaN })).toBe("#000000");
    expect(colorHex({ k: undefined as unknown as number })).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("prototype keys are not blend modes", () => {
    for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty"]) expect(mapBlendMode(k)).toEqual({ approximated: true });
    const { effects } = psdEffectsToModel({ solidFill: [{ enabled: true, color: black, blendMode: "constructor" as never }] }, ctx);
    expect(effects!.colorOverlay![0].blendMode).toBe("normal");
    expect(() => Effects.parse(effects)).not.toThrow();
  });

  it("NaN and infinite numbers come out finite", () => {
    const nan = NaN;
    const { effects } = psdEffectsToModel(
      {
        dropShadow: [
          {
            enabled: true,
            color: black,
            opacity: nan,
            angle: nan,
            distance: px(nan),
            size: px(Infinity),
            choke: px(nan),
            contour: { name: "c", curve: [{ x: 0, y: nan }, { x: 128, y: 200 }, { x: nan, y: 255 }] },
          },
        ],
        gradientOverlay: [
          {
            enabled: true,
            angle: nan,
            scale: nan,
            gradient: {
              name: "g",
              type: "solid",
              colorStops: [
                { color: black, location: nan, midpoint: nan },
                { color: { r: 255, g: 255, b: 255 }, location: 1, midpoint: nan },
              ],
              opacityStops: [
                { opacity: 0.5, location: nan, midpoint: 0.5 },
                { opacity: nan, location: 1, midpoint: nan },
              ],
            },
          },
        ],
      },
      ctx,
    );
    const finite = (v: unknown): void => {
      if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
      else if (v && typeof v === "object") Object.values(v).forEach(finite);
    };
    finite(effects);
    expect(() => Effects.parse(effects)).not.toThrow();
  });

  it("outer glow technique survives a binary write and read (ag-psd's generic descriptor parser handles GlwT)", () => {
    const fx = modelEffectsToPsd({ outerGlow: { color: "#ffffff", size: 4, technique: "precise" } } as Fx) as LayerEffectsInfo;
    const psd = readFixture(buildPsd([pixelLayer({ w: 10, h: 10, extra: { effects: fx } })]));
    expect(psdEffectsToModel(psd.children![0].effects, ctx).effects!.outerGlow!.technique).toBe("precise");
  });
});
