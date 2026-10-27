// Node env: jsdom's Blob mangles fflate's Uint8Array (cross-realm), node's Blob/File are real.
import { describe, expect, it, vi } from "vitest";
import { Element } from "@/lib/model";
import { Effects, hasActiveEffects } from "@/lib/effects";
import { makeDesign, rectEl } from "../fixtures/design";

const store = new Map<string, unknown>();
vi.mock("@/lib/storage", () => ({
  saveDesign: async (d: { id: string }) => void store.set(`design:${d.id}`, d),
  loadAsset: async (id: string) => store.get(`asset:${id}`),
  saveAsset: async (id: string, b: Blob) => void store.set(`asset:${id}`, b),
  saveThumb: async () => {},
  listFonts: async () => [],
  saveFont: async () => {},
  deleteFont: async () => {},
}));
vi.mock("@/lib/render", () => ({ renderThumbnail: () => Promise.reject(new Error("no thumbnails in tests")) }));

const grad = {
  style: "linear" as const,
  stops: [
    { offset: 0, color: "#000000" },
    { offset: 1, color: "#ffffff" },
  ],
};

export const fullEffects = {
  dropShadow: [{ color: "#000000", angle: 120, distance: 5, size: 8 }],
  innerShadow: [{ color: "#000000", angle: 120, distance: 3, size: 4 }],
  outerGlow: { color: "#ffff00", size: 10 },
  innerGlow: { color: "#ffffff", size: 6 },
  stroke: [{ size: 3, paint: { type: "color" as const, color: "#ff0000" } }],
  colorOverlay: [{ color: "#00ff00" }],
  gradientOverlay: [{ gradient: grad }],
};

describe("effects schema", () => {
  it("element with full effects parses", () => {
    const el = Element.parse(rectEl({ effects: fullEffects } as never));
    expect(el.effects?.dropShadow?.[0].spread).toBe(0);
    expect(el.effects?.dropShadow?.[0].enabled).toBe(true);
    expect(el.effects?.stroke?.[0].position).toBe("outside");
    expect(el.effects?.gradientOverlay?.[0].gradient.angle).toBe(90);
  });

  it("rejects non-hex colours in gradients", () => {
    const bad = { gradientOverlay: [{ gradient: { stops: [{ offset: 0, color: "red" }, { offset: 1, color: "#fff" }] } }] };
    expect(Effects.safeParse(bad).success).toBe(false);
  });

  it("old element without fx fields parses unchanged", () => {
    const el = Element.parse(rectEl());
    expect("effects" in el).toBe(false);
    expect("blendMode" in el).toBe(false);
    expect("fillOpacity" in el).toBe(false);
  });

  it("hasActiveEffects ignores disabled and empty", () => {
    expect(hasActiveEffects(undefined)).toBe(false);
    expect(hasActiveEffects({ stroke: [] })).toBe(false);
    const fx = Effects.parse({ colorOverlay: [{ color: "#000", enabled: false }] });
    expect(hasActiveEffects(fx)).toBe(false);
    expect(hasActiveEffects(Effects.parse({ colorOverlay: [{ color: "#000" }] }))).toBe(true);
  });

  it("workfile keeps effects", async () => {
    const { exportWorkfile, importWorkfile } = await import("@/lib/workfile");
    const effects = Effects.parse(fullEffects);
    const design = makeDesign([rectEl({ effects, blendMode: "multiply", fillOpacity: 0.5 })]);
    const blob = await exportWorkfile(design);
    const back = await importWorkfile(new File([blob], "x.canvasme"));
    const el = back.pages[0].elements[0];
    expect(el.effects).toEqual(effects);
    expect(el.blendMode).toBe("multiply");
    expect(el.fillOpacity).toBe(0.5);
    expect(back.version).toBe(3);
  });
});
