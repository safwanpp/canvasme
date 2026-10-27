import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({ saveAsset: vi.fn(), saveDesign: vi.fn(), saveThumb: vi.fn() }));
vi.mock("@/lib/render", () => ({ renderThumbnail: vi.fn(() => Promise.reject(new Error("no canvas"))) }));
vi.mock("@/lib/importers/fontMatch", () => ({
  availableFamilies: async () => ["Inter"],
  matchFont: () => ({ family: "Inter", bold: false, italic: false }),
}));

import { Design, type Element } from "@/lib/model";
import { buildDesignFromPsdResult } from "@/lib/importers/psd";
import { convert } from "@/lib/importers/psdConvert";
import { normalizeTree } from "@/lib/tree";
import { buildPsd, groupLayer, pixelLayer, readFixture } from "../fixtures/psd";

const io = { encode: async (rgba: Uint8ClampedArray) => new Blob([rgba as Uint8ClampedArray<ArrayBuffer>]) };
const deps = { saveAsset: async () => {} };
const px = (value: number) => ({ units: "Pixels" as const, value });

async function importLayers(layers: Parameters<typeof buildPsd>[0]) {
  const result = await convert(readFixture(buildPsd(layers)), () => {}, io);
  const { design } = await buildDesignFromPsdResult(result, "nested.psd", deps);
  return { result, design, els: design.pages[0].elements };
}
const byName = (els: Element[], name: string) => els.find((e) => e.name === name)!;

describe("psd structure: groups", () => {
  it("nested groups become nested group elements with opacity on the group", async () => {
    const { els, design } = await importLayers([
      pixelLayer({ name: "Under", w: 4, h: 4 }),
      groupLayer(
        "Outer",
        [
          pixelLayer({ name: "A", left: 10, top: 10, w: 10, h: 10 }),
          groupLayer("Inner", [pixelLayer({ name: "B", left: 30, top: 30, w: 10, h: 10, extra: { opacity: 0.5 } })], { opacity: 0.4 }),
        ],
        { opacity: 0.8 },
      ),
    ]);
    expect(els.map((e) => e.name)).toEqual(["Under", "A", "B", "Inner", "Outer"]);
    const outer = byName(els, "Outer");
    const inner = byName(els, "Inner");
    expect(outer).toMatchObject({ type: "group", groupId: null, x: 10, y: 10, width: 30, height: 30 });
    expect(outer.opacity).toBeCloseTo(0.8, 2);
    expect(inner).toMatchObject({ type: "group", groupId: outer.id });
    expect(inner.opacity).toBeCloseTo(0.4, 2);
    expect(byName(els, "A").groupId).toBe(outer.id);
    expect(byName(els, "B").groupId).toBe(inner.id);
    // Not multiplied into the member any more.
    expect(byName(els, "B").opacity).toBeCloseTo(0.5, 2);
    expect(normalizeTree(els)).toBe(els);
    expect(Design.safeParse(design).success).toBe(true);
  });

  it("group blend multiply kept; pass through default; normal kept as normal", async () => {
    const { els } = await importLayers([
      groupLayer("Mul", [pixelLayer({ name: "a", w: 4, h: 4 })], { blendMode: "multiply" }),
      groupLayer("Pass", [pixelLayer({ name: "b", w: 4, h: 4 })], { blendMode: "pass through" }),
      groupLayer("Norm", [pixelLayer({ name: "c", w: 4, h: 4 })], { blendMode: "normal" }),
    ]);
    expect(byName(els, "Mul").blendMode).toBe("multiply");
    expect(byName(els, "Pass").blendMode).toBeUndefined();
    expect(byName(els, "Norm").blendMode).toBe("normal");
  });

  it("hidden group stays hidden itself; its members keep their own visibility", async () => {
    const { els } = await importLayers([groupLayer("G", [pixelLayer({ name: "a", w: 4, h: 4 })], { hidden: true })]);
    expect(byName(els, "G").hidden).toBe(true);
    expect(byName(els, "a").hidden).toBe(false);
  });

  it("group effects are kept and group fill opacity is noted", async () => {
    const { els, design } = await importLayers([
      groupLayer("G", [pixelLayer({ name: "a", w: 4, h: 4 })], {
        fillOpacity: 0.5,
        effects: { dropShadow: [{ enabled: true, size: px(5), distance: px(4), angle: 90, color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }] },
      }),
    ]);
    const g = byName(els, "G");
    expect(g.effects?.dropShadow?.[0]).toMatchObject({ size: 5, distance: 4 });
    expect(g.fillOpacity).toBeUndefined();
    const item = design.importReport!.items.find((i) => i.elementId === g.id)!;
    expect(item.message).toMatch(/fill/i);
  });

  it("collapsed folders stay collapsed; empty groups are left out", async () => {
    const { els } = await importLayers([
      groupLayer("Closed", [pixelLayer({ name: "a", w: 4, h: 4 })], { opened: false }),
      groupLayer("Empty", []),
    ]);
    expect(byName(els, "Closed")).toMatchObject({ collapsed: true });
    expect(els.some((e) => e.name === "Empty")).toBe(false);
  });

  it("a group of one stays a group (it may carry opacity or effects)", async () => {
    const { els } = await importLayers([groupLayer("Solo", [pixelLayer({ name: "a", w: 4, h: 4 })], { opacity: 0.5 })]);
    expect(byName(els, "a").groupId).toBe(byName(els, "Solo").id);
  });
});

describe("psd structure: clipping", () => {
  it("clipping layer is clipped to base (kept, not released, not lossy)", async () => {
    const { els, result, design } = await importLayers([
      pixelLayer({ name: "Base", w: 10, h: 10 }),
      pixelLayer({ name: "Clip1", w: 20, h: 20, extra: { clipping: true } }),
      pixelLayer({ name: "Clip2", w: 20, h: 20, extra: { clipping: true } }),
      pixelLayer({ name: "Top", w: 4, h: 4 }),
    ]);
    expect(els.map((e) => [e.name, !!e.clipped])).toEqual([
      ["Base", false],
      ["Clip1", true],
      ["Clip2", true],
      ["Top", false],
    ]);
    expect(result.lossy).toBe(false);
    expect(result.notes.join(" ")).not.toMatch(/clipping/i);
    expect(Design.safeParse(design).success).toBe(true);
  });

  it("a layer clipped onto a group base stays clipped; a clipped group too", async () => {
    const { els } = await importLayers([
      groupLayer("G", [pixelLayer({ name: "m", w: 10, h: 10 })]),
      pixelLayer({ name: "c", w: 20, h: 20, extra: { clipping: true } }),
      groupLayer("H", [pixelLayer({ name: "n", w: 10, h: 10 })], { clipping: true }),
    ]);
    expect(byName(els, "c").clipped).toBe(true);
    expect(byName(els, "c").groupId).toBeNull();
    expect(byName(els, "H").clipped).toBe(true);
    expect(normalizeTree(els)).toBe(els);
  });

  it("a clipped layer at the bottom of a group has nothing to clip to and comes in unclipped", async () => {
    const { els } = await importLayers([groupLayer("G", [pixelLayer({ name: "c", w: 4, h: 4, extra: { clipping: true } })])]);
    expect(byName(els, "c").clipped).toBeUndefined();
  });

  it("layers clipped to a base that was left out are released, with a note", async () => {
    const { els, result } = await importLayers([
      pixelLayer({ name: "Under", w: 4, h: 4 }),
      pixelLayer({ name: "Blank", w: 4, h: 4, rgba: [0, 0, 0, 0] }),
      pixelLayer({ name: "c", w: 4, h: 4, extra: { clipping: true } }),
    ]);
    expect(els.some((e) => e.name === "Blank")).toBe(false);
    expect(byName(els, "c").clipped).toBeUndefined();
    expect(result.notes.join(" ")).toMatch(/clip/i);
  });
});

describe("psd structure: clipping and the reference layer", () => {
  it("a clipped bottom layer is not clipped to the hidden flattened reference layer", async () => {
    const { els } = await importLayers([
      pixelLayer({ name: "c", w: 4, h: 4, extra: { clipping: true } }),
      pixelLayer({ name: "adj", w: 4, h: 4, extra: { adjustment: { type: "selective color" } } as never }),
    ]);
    expect(els[0].name).toMatch(/Flattened/);
    expect(byName(els, "c").clipped).toBeUndefined();
  });
});
