import { describe, expect, it } from "vitest";
import type { LayerEffectsInfo, Layer } from "ag-psd";
import { Design } from "@/lib/model";
import { buildPsd, groupLayer, pixelLayer, readFixture, textLayer } from "./psd";
import { imageEl, makeDesign, rectEl, textEl } from "./design";
import { expectPx, px, solidRaster } from "./raster";

/** Writes one pixel layer carrying `effects` and reads its effects back. */
const roundTripFx = (effects: LayerEffectsInfo) =>
  readFixture(buildPsd([pixelLayer({ w: 10, h: 10, extra: { effects } })])).children![0].effects!;

describe("psd fixtures", () => {
  it("buildPsd keeps effects", () => {
    const fx = roundTripFx({
      dropShadow: [
        {
          enabled: true,
          size: { units: "Pixels", value: 8 },
          distance: { units: "Pixels", value: 5 },
          angle: 120,
          color: { r: 0, g: 0, b: 0 },
          opacity: 0.75,
          blendMode: "multiply",
        },
      ],
    });
    expect(fx.dropShadow![0].size!.value).toBe(8);
    expect(fx.dropShadow![0].blendMode).toBe("multiply");
  });

  it("buildPsd keeps text runs", () => {
    const layer = textLayer({
      text: "Hello world",
      left: 10,
      top: 20,
      runs: [
        { length: 6, style: { fontSize: 24, fillColor: { r: 255, g: 0, b: 0 } } },
        { length: 5, style: { fontSize: 12, fillColor: { r: 0, g: 0, b: 255 } } },
      ],
    });
    const psd = readFixture(buildPsd([layer]));
    expect(psd.children![0].text!.text).toBe("Hello world");
    expect(psd.children![0].text!.styleRuns!.length).toBe(2);
  });

  it("buildPsd keeps nesting", () => {
    const psd = readFixture(buildPsd([groupLayer("A", [groupLayer("B", [pixelLayer({ name: "P", w: 4, h: 4 })])])]));
    const a = psd.children![0];
    expect(a.name).toBe("A");
    expect(a.children![0].name).toBe("B");
    expect(a.children![0].children![0].name).toBe("P");
    expect(a.children![0].children![0].imageData!.width).toBe(4);
  });

  it("pixelLayer fills a solid colour at its position", () => {
    const psd = readFixture(buildPsd([pixelLayer({ left: 3, top: 7, w: 2, h: 2, rgba: [10, 20, 30, 255] })]));
    const l = psd.children![0];
    expect([l.left, l.top, l.right, l.bottom]).toEqual([3, 7, 5, 9]);
    expect(Array.from(l.imageData!.data.slice(0, 4))).toEqual([10, 20, 30, 255]);
    expect([psd.width, psd.height]).toEqual([200, 200]);
  });
});

// Empirical answers to the ag-psd unknowns in docs/plans/psd-effects.md (see "P0 findings").
describe("ag-psd units (P0 findings)", () => {
  it("choke is a UnitsValue holding the percent 0..100, with units Pixels", () => {
    const fx = roundTripFx({
      dropShadow: [{ choke: { units: "Pixels", value: 25 } }],
      innerShadow: [{ choke: { units: "Pixels", value: 40 } }],
      outerGlow: { choke: { units: "Pixels", value: 10 } },
      innerGlow: { choke: { units: "Pixels", value: 100 } },
    });
    expect(fx.dropShadow![0].choke).toEqual({ units: "Pixels", value: 25 });
    expect(fx.innerShadow![0].choke).toEqual({ units: "Pixels", value: 40 });
    expect(fx.outerGlow!.choke).toEqual({ units: "Pixels", value: 10 });
    expect(fx.innerGlow!.choke).toEqual({ units: "Pixels", value: 100 });
  });

  it("choke with Percent units is rejected by the writer", () => {
    expect(() =>
      buildPsd([pixelLayer({ w: 2, h: 2, extra: { effects: { dropShadow: [{ choke: { units: "Percent" as "Pixels", value: 25 } }] } } })]),
    ).toThrow();
  });

  it("gradient stop location and midpoint are 0..1 in the API, quantized to 1/4096 and 1/100", () => {
    const fx = roundTripFx({
      gradientOverlay: [
        {
          gradient: {
            name: "g",
            type: "solid",
            colorStops: [
              { color: { r: 255, g: 0, b: 0 }, location: 0, midpoint: 0.5 },
              { color: { r: 0, g: 0, b: 255 }, location: 0.3, midpoint: 0.25 },
              { color: { r: 0, g: 255, b: 0 }, location: 1, midpoint: 0.5 },
            ],
            opacityStops: [
              { opacity: 1, location: 0, midpoint: 0.5 },
              { opacity: 0.4, location: 0.75, midpoint: 0.6 },
            ],
          },
        },
      ],
    });
    const g = fx.gradientOverlay![0].gradient!;
    if (g.type !== "solid") throw new Error("expected a solid gradient");
    expect(g.colorStops.map((s) => s.location)).toEqual([0, Math.round(0.3 * 4096) / 4096, 1]);
    expect(g.colorStops[1].midpoint).toBe(0.25);
    expect(g.opacityStops[1]).toEqual({ opacity: 0.4, location: 0.75, midpoint: 0.6 });
    expect(g.smoothness).toBe(1);
  });

  it("gradient locations are divided by the smoothness sample count, so they stay 0..1 at any smoothness", () => {
    const fx = roundTripFx({
      gradientOverlay: [
        {
          gradient: {
            name: "g",
            type: "solid",
            smoothness: 0.5,
            colorStops: [
              { color: { r: 0, g: 0, b: 0 }, location: 0, midpoint: 0.5 },
              { color: { r: 255, g: 255, b: 255 }, location: 0.5, midpoint: 0.5 },
            ],
            opacityStops: [{ opacity: 1, location: 0, midpoint: 0.5 }],
          },
        },
      ],
    });
    const g = fx.gradientOverlay![0].gradient!;
    if (g.type !== "solid") throw new Error("expected a solid gradient");
    expect(g.smoothness).toBe(0.5);
    expect(g.colorStops[1].location).toBe(0.5);
  });

  it("overlay scale, offset, opacity and effects.scale are fractions (percent / 100), opacity rounded to 1%", () => {
    const fx = roundTripFx({
      scale: 1.5,
      gradientOverlay: [
        {
          opacity: 0.755,
          scale: 1.25,
          offset: { x: 0.1, y: -0.2 },
          angle: 45,
          type: "radial",
          reverse: true,
          align: false,
          gradient: {
            name: "g",
            type: "solid",
            colorStops: [{ color: { r: 0, g: 0, b: 0 }, location: 0, midpoint: 0.5 }],
            opacityStops: [{ opacity: 1, location: 0, midpoint: 0.5 }],
          },
        },
      ],
    });
    const o = fx.gradientOverlay![0];
    expect(fx.scale).toBe(1.5);
    expect(o.scale).toBe(1.25);
    expect(o.offset).toEqual({ x: 0.1, y: -0.2 });
    expect(o.opacity).toBe(0.76);
    expect([o.angle, o.type, o.reverse, o.align]).toEqual([45, "radial", true, false]);
  });

  it("an effect written without enabled reads back disabled, and effects.scale defaults to 1", () => {
    const fx = roundTripFx({ dropShadow: [{ size: { units: "Pixels", value: 8 } }] });
    expect(fx.dropShadow![0].enabled).toBe(false);
    expect(fx.scale).toBe(1);
  });

  it("Points units are kept as Points (ag-psd does not convert to pixels)", () => {
    const fx = roundTripFx({ dropShadow: [{ size: { units: "Points", value: 10 }, distance: { units: "Points", value: 3 } }] });
    expect(fx.dropShadow![0].size).toEqual({ units: "Points", value: 10 });
  });

  it("useGlobalLight and imageResources.globalAngle survive", () => {
    const psd = readFixture(
      buildPsd([pixelLayer({ w: 2, h: 2, extra: { effects: { dropShadow: [{ useGlobalLight: true, angle: 90 }] } } })], {
        extra: { imageResources: { globalAngle: 30, globalAltitude: 30 } },
      }),
    );
    expect(psd.children![0].effects!.dropShadow![0].useGlobalLight).toBe(true);
    expect(psd.imageResources!.globalAngle).toBe(30);
  });

  it("contour curve points are 0..255", () => {
    const curve = [
      { x: 0, y: 0 },
      { x: 128, y: 200 },
      { x: 255, y: 255 },
    ];
    const fx = roundTripFx({ dropShadow: [{ contour: { name: "c", curve } }] });
    expect(fx.dropShadow![0].contour!.curve).toEqual(curve);
  });

  it("stroke with gradient fill keeps type and stops", () => {
    const fx = roundTripFx({
      stroke: [
        {
          size: { units: "Pixels", value: 3 },
          position: "outside",
          fillType: "gradient",
          gradient: {
            name: "g",
            type: "solid",
            colorStops: [
              { color: { r: 0, g: 0, b: 0 }, location: 0, midpoint: 0.5 },
              { color: { r: 255, g: 255, b: 255 }, location: 1, midpoint: 0.5 },
            ],
            opacityStops: [{ opacity: 1, location: 0, midpoint: 0.5 }],
            style: "linear",
            angle: 90,
            scale: 0.8,
          },
        },
      ],
    });
    const s = fx.stroke![0];
    expect([s.position, s.fillType]).toEqual(["outside", "gradient"]);
    expect(s.gradient!.type).toBe("solid");
    expect(s.gradient!.scale).toBe(0.8);
  });

  it("disabled flag and per-effect enabled survive", () => {
    const fx = roundTripFx({ disabled: true, solidFill: [{ enabled: false, color: { r: 1, g: 2, b: 3 }, opacity: 0.5, blendMode: "screen" }] });
    expect(fx.disabled).toBe(true);
    expect(fx.solidFill![0]).toMatchObject({ enabled: false, color: { r: 1, g: 2, b: 3 }, opacity: 0.5, blendMode: "screen" });
  });

  it("layer blendMode strings survive; opacity and fillOpacity are quantized to 1/255", () => {
    const layers: Layer[] = (["linear dodge", "subtract", "darker color", "multiply"] as const).map((blendMode) =>
      pixelLayer({ w: 2, h: 2, extra: { blendMode, opacity: 0.5, fillOpacity: 0.4 } }),
    );
    const psd = readFixture(buildPsd(layers));
    expect(psd.children!.map((l) => l.blendMode)).toEqual(["linear dodge", "subtract", "darker color", "multiply"]);
    expect(psd.children![0].opacity).toBe(128 / 255);
    expect(psd.children![0].fillOpacity).toBe(102 / 255);
  });

  it("vector mask knots keep points order [p0x,p0y,p1x,p1y,p2x,p2y] in document pixels", () => {
    const points = [10, 20, 30, 40, 50, 60];
    const layer = pixelLayer({
      w: 2,
      h: 2,
      extra: {
        vectorMask: {
          paths: [
            {
              open: false,
              operation: "subtract",
              fillRule: "non-zero",
              knots: [
                { linked: true, points },
                { linked: false, points: [100, 100, 120, 110, 140, 150] },
              ],
            },
          ],
        },
      },
    });
    const path = readFixture(buildPsd([layer])).children![0].vectorMask!.paths[0];
    expect(path.knots[0].points.map((v) => Math.round(v * 1000) / 1000)).toEqual(points);
    expect(path.knots[1].linked).toBe(false);
    expect([path.open, path.operation, path.fillRule]).toEqual([false, "subtract", "non-zero"]);
  });

  it("patterns sit on Psd.patterns, not on the layer", () => {
    const data = new Uint8Array(2 * 2 * 4).fill(200);
    const pattern = { name: "p", id: "pattern-1", x: 0, y: 0, bounds: { x: 0, y: 0, w: 2, h: 2 }, data };
    const psd = readFixture(
      buildPsd([pixelLayer({ w: 2, h: 2, extra: { effects: { patternOverlay: { pattern: { name: "p", id: "pattern-1" }, scale: 2 } } } })], {
        extra: { patterns: [pattern] },
      }),
    );
    expect(psd.patterns?.map((p) => p.id)).toEqual(["pattern-1"]);
    expect(psd.children![0].effects!.patternOverlay!.pattern!.id).toBe("pattern-1");
    expect(psd.children![0].effects!.patternOverlay!.scale).toBe(2);
  });
});

describe("design fixtures", () => {
  it("makeDesign builds a design that passes the schema", () => {
    const d = makeDesign([rectEl(), textEl({ text: "Hi" }), imageEl()], { width: 300, height: 100, background: "#ff0000" });
    expect(Design.safeParse(d).success).toBe(true);
    expect([d.width, d.height, d.pages[0].background]).toEqual([300, 100, "#ff0000"]);
    expect(d.pages[0].elements.map((e) => e.type)).toEqual(["shape", "text", "image"]);
    expect(d.assets[(d.pages[0].elements[2] as { assetId: string }).assetId]).toBeDefined();
  });

  it("element factories give unique ids and accept overrides", () => {
    const a = rectEl({ x: 5, fill: "#00ff00" });
    expect(a.id).not.toBe(rectEl().id);
    expect([a.x, a.fill]).toEqual([5, "#00ff00"]);
  });
});

describe("raster fixtures", () => {
  it("solidRaster stores premultiplied colour and px reads it back straight", () => {
    const r = solidRaster(3, 2, [1, 0.5, 0, 0.5]);
    expect([r.w, r.h, r.data.length]).toEqual([3, 2, 24]);
    expect(Array.from(r.data.slice(0, 4))).toEqual([0.5, 0.25, 0, 0.5]);
    expect(px(r, 2, 1)).toEqual([255, 128, 0, 128]);
  });

  it("px of a fully transparent pixel is all zero", () => {
    expect(px(solidRaster(1, 1, [1, 1, 1, 0]), 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("expectPx passes within tolerance and fails outside it", () => {
    expectPx([100, 100, 100, 255], [101, 99, 102, 255]);
    expect(() => expectPx([100, 100, 100, 255], [104, 100, 100, 255])).toThrow();
    expectPx([100, 100, 100, 255], [104, 100, 100, 255], 4);
  });
});
