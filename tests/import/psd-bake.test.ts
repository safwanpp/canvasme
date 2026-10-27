import { describe, expect, it } from "vitest";
import type { LayerEffectsInfo, Psd } from "ag-psd";
import { convert } from "@/lib/importers/psdConvert";
import { buildPsd, groupLayer, pixelLayer, readFixture, textLayer } from "../fixtures/psd";

const px = (value: number) => ({ units: "Pixels" as const, value });
const io = { encode: async (rgba: Uint8ClampedArray, w: number, h: number) => Object.assign(new Blob([rgba as Uint8ClampedArray<ArrayBuffer>]), { w, h }) };
const run = (psd: Psd) => convert(psd, () => {}, io);
const outerBevel: LayerEffectsInfo = { bevel: { enabled: true, style: "outer bevel", size: px(6), angle: 90, altitude: 30, strength: 1 } };

describe("convert bakes unsupported effects", () => {
  it("outer bevel grows the node box and names the effect", async () => {
    const r = await run(readFixture(buildPsd([pixelLayer({ name: "Btn", left: 50, top: 60, w: 20, h: 20, extra: { effects: outerBevel } })])));
    const n = r.nodes[0];
    expect(n.left).toBeLessThan(50);
    expect(n.top).toBeLessThan(60);
    expect(n.width).toBeGreaterThan(20);
    expect((n.png as Blob & { w: number }).w).toBe(n.width);
    expect(n.pad!.l).toBe(50 - n.left);
    expect(n.issues?.[0]).toMatchObject({ kind: "baked" });
    expect(n.issues?.[0].message).toMatch(/Bevel/);
    expect(n.effects).toBeUndefined();
    // Baking alone is faithful enough: no reference composite needed.
    expect(r.lossy).toBe(false);
  });

  it("keeps supported effects above the bake and folds fill opacity", async () => {
    const fx: LayerEffectsInfo = {
      satin: { enabled: true, size: px(4), distance: px(4) },
      stroke: [{ enabled: true, size: px(2), color: { r: 0, g: 0, b: 0 } }],
      solidFill: [{ enabled: true, color: { r: 0, g: 255, b: 0 } }],
    };
    const r = await run(readFixture(buildPsd([pixelLayer({ w: 20, h: 20, extra: { effects: fx } })])));
    const n = r.nodes[0];
    expect(n.effects?.stroke?.[0].size).toBe(2);
    expect(n.effects?.colorOverlay).toBeUndefined();
    expect(n.issues?.[0].message).toMatch(/Satin.*Colour overlay|Colour overlay.*Satin/);
  });

  it("fill opacity is folded into baked pixels", async () => {
    const r = await run(readFixture(buildPsd([pixelLayer({ w: 20, h: 20, extra: { fillOpacity: 0.5, effects: { satin: { enabled: true, size: px(2) } } } })])));
    expect(r.nodes[0].fillOpacity).toBeUndefined();
  });

  it("disabled layer effects are not baked", async () => {
    const r = await run(readFixture(buildPsd([pixelLayer({ w: 20, h: 20, extra: { effects: { ...outerBevel, disabled: true } } })])));
    expect(r.nodes[0].width).toBe(20);
    expect(r.nodes[0].issues).toBeUndefined();
  });

  it("hidden layers are baked and stay hidden", async () => {
    const r = await run(readFixture(buildPsd([pixelLayer({ w: 20, h: 20, extra: { hidden: true, effects: outerBevel } })])));
    expect(r.nodes[0].hidden).toBe(true);
    expect(r.nodes[0].width).toBeGreaterThan(20);
  });

  it("text keeps its editable text; unsupported effects on it are dropped and noted", async () => {
    const fx: LayerEffectsInfo = { ...outerBevel, stroke: [{ enabled: true, size: px(2), color: { r: 0, g: 0, b: 0 } }] };
    const r = await run(readFixture(buildPsd([textLayer({ text: "Hey", left: 10, top: 10, extra: { effects: fx } })])));
    const n = r.nodes[0];
    expect(n.text?.text).toBe("Hey");
    expect(n.effects?.stroke).toHaveLength(1);
    expect(n.issues?.[0]).toMatchObject({ kind: "dropped" });
    expect(n.issues?.[0].message).toMatch(/Bevel/);
    expect(r.lossy).toBe(true);
  });

  it("glow noise is noted as approximated", async () => {
    const fx: LayerEffectsInfo = { outerGlow: { enabled: true, size: px(4), noise: 0.4 } };
    const r = await run(readFixture(buildPsd([pixelLayer({ w: 20, h: 20, extra: { effects: fx } })])));
    expect(r.nodes[0].effects?.outerGlow?.size).toBe(4);
    expect(r.nodes[0].issues?.[0]).toMatchObject({ kind: "approximated" });
  });

  it("effects and blend modes on groups stay on the group; ones it can't draw are reported on it", async () => {
    const psd = readFixture(
      buildPsd([
        groupLayer("Card", [pixelLayer({ w: 4, h: 4 })], {
          blendMode: "multiply",
          effects: {
            dropShadow: [{ enabled: true, size: px(3), distance: px(3) }],
            bevel: { enabled: true, style: "inner bevel", size: px(4) },
          },
        }),
      ]),
    );
    const r = await run(psd);
    const g = r.nodes.find((n) => n.kind === "group")!;
    expect(g.blendMode).toBe("multiply");
    expect(g.effects?.dropShadow?.[0]).toMatchObject({ size: 3, distance: 3 });
    expect(g.issues).toEqual([expect.objectContaining({ kind: "dropped" })]);
    expect(r.layerIssues).toEqual([]);
    expect(r.lossy).toBe(true);
  });
});
