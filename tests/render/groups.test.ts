// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effects } from "@/lib/effects";
import type { Element } from "@/lib/model";
import { renderPageCanvas } from "@/lib/render";
import { fxCache } from "@/lib/fx/cache";
import { groupDrawFor, needsIsolation } from "@/lib/fx/groupDraw";
import { groupEl, makeDesign, rectEl } from "../fixtures/design";

vi.mock("@/lib/images", () => ({ loadAssetImage: async () => null, getReadyImage: () => undefined }));
vi.mock("@/lib/fonts", () => ({ ensureFonts: async () => {} }));

async function pagePx(els: Element[], background = "#ffffff") {
  const d = makeDesign(els, { background });
  const c = await renderPageCanvas(d, d.pages[0], 1);
  const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  return (x: number, y: number) => Array.from(data.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 4));
}
const near = (got: number[], want: number[], tol: number) =>
  expect(got.every((v, i) => Math.abs(v - want[i]) <= tol), `got ${got}, want ${want}`).toBe(true);

const red = (id: string, x: number, p?: Partial<Element>) =>
  rectEl({ id, x, y: 50, width: 60, height: 60, fill: "#ff0000", groupId: "G", ...(p as object) });

beforeEach(() => fxCache.clear());

describe("group rendering", () => {
  it("group opacity isolates overlap", async () => {
    const at = await pagePx([red("a", 20), red("b", 50), groupEl({ id: "G", opacity: 0.5 })]);
    near(at(60, 80), [255, 128, 128, 255], 2); // overlap
    near(at(30, 80), [255, 128, 128, 255], 2); // a alone
    // The same pair ungrouped, each at 50%, darkens where they overlap.
    const flat = await pagePx([red("a", 20, { groupId: null, opacity: 0.5 }), red("b", 50, { groupId: null, opacity: 0.5 })]);
    near(flat(60, 80), [255, 64, 64, 255], 2);
  });

  it("nested group opacities multiply once per level", async () => {
    const at = await pagePx([
      red("a", 20, { groupId: "H" }),
      red("b", 50, { groupId: "H" }),
      groupEl({ id: "H", groupId: "G", opacity: 0.5 }),
      groupEl({ id: "G", opacity: 0.5 }),
    ]);
    near(at(60, 80), [255, 191, 191, 255], 2);
  });

  it("pass-through group lets a member's blend reach the page; a normal group isolates it", async () => {
    const blue = rectEl({ id: "bg", x: 0, y: 0, width: 200, height: 200, fill: "#0000ff" });
    const member = red("a", 20, { blendMode: "multiply" });
    const pass = await pagePx([blue, member, groupEl({ id: "G" })]);
    near(pass(40, 80), [0, 0, 0, 255], 2);
    const normal = await pagePx([blue, member, groupEl({ id: "G", blendMode: "normal" })]);
    near(normal(40, 80), [255, 0, 0, 255], 2);
  });

  it("group multiply blends its composite with the page", async () => {
    const at = await pagePx([red("a", 20), groupEl({ id: "G", blendMode: "multiply" })], "#00ff00");
    near(at(40, 80), [0, 0, 0, 255], 2);
    near(at(150, 150), [0, 255, 0, 255], 1);
  });

  it("group software blend (linear burn) draws via readback", async () => {
    const grey = rectEl({ id: "a", x: 50, y: 50, width: 100, height: 100, fill: "#808080", groupId: "G" });
    const at = await pagePx([grey, groupEl({ id: "G", blendMode: "linear-burn" })], "#c0c0c0");
    near(at(100, 100), [0x41, 0x41, 0x41, 255], 3);
    near(at(20, 20), [0xc0, 0xc0, 0xc0, 255], 1);
  });

  it("group drop shadow wraps children union", async () => {
    const effects = Effects.parse({ dropShadow: [{ color: "#0000ff", angle: 90, distance: 20, size: 0, blendMode: "normal" }] });
    const at = await pagePx([red("a", 20), red("b", 50), groupEl({ id: "G", effects })]);
    near(at(60, 80), [255, 0, 0, 255], 2); // the members, unshadowed by each other
    near(at(60, 125), [0, 0, 255, 255], 2); // the union's shadow below
    near(at(60, 40), [255, 255, 255, 255], 1);
  });

  it("group colour overlay covers its members only", async () => {
    const effects = Effects.parse({ colorOverlay: [{ color: "#00ff00" }] });
    const at = await pagePx([red("a", 20), groupEl({ id: "G", effects })]);
    near(at(40, 80), [0, 255, 0, 255], 2);
    near(at(150, 150), [255, 255, 255, 255], 1);
  });

  it("hidden group hides children", async () => {
    const at = await pagePx([red("a", 20), groupEl({ id: "G", hidden: true })]);
    near(at(40, 80), [255, 255, 255, 255], 0);
  });

  it("pass-through group with opacity 1 renders like ungrouped members, without isolation", async () => {
    expect(needsIsolation(groupEl())).toBe(false);
    expect(needsIsolation(groupEl({ blendMode: "pass-through" }))).toBe(false);
    expect(needsIsolation(groupEl({ blendMode: "normal" }))).toBe(true);
    expect(needsIsolation(groupEl({ opacity: 0.9 }))).toBe(true);
    const grouped = await pagePx([red("a", 20, { opacity: 0.5 }), red("b", 50, { opacity: 0.5 }), groupEl({ id: "G" })]);
    near(grouped(60, 80), [255, 64, 64, 255], 2);
  });

  it("an inner group's shadow is not clipped by the outer group's isolation", async () => {
    const effects = Effects.parse({ dropShadow: [{ color: "#0000ff", angle: 90, distance: 30, size: 0, blendMode: "normal" }] });
    const at = await pagePx([
      red("a", 20, { groupId: "H" }),
      groupEl({ id: "H", groupId: "G", effects }),
      groupEl({ id: "G", opacity: 0.5 }),
    ]);
    near(at(40, 80), [255, 128, 128, 255], 2);
    near(at(40, 135), [128, 128, 255, 255], 2); // the inner shadow, 25 units past the members' box
  });

  it("groupDrawFor reach includes nested groups' effects and their members", () => {
    const effects = Effects.parse({ dropShadow: [{ color: "#0000ff", angle: 90, distance: 30, size: 0 }] });
    const inner = groupEl({ id: "H", groupId: "G", effects });
    const cfg = groupDrawFor(groupEl({ id: "G" }), [red("a", 20, { groupId: "H", strokeWidth: 10, stroke: "#000" } as Partial<Element>), inner]);
    expect(cfg.reach).toBeGreaterThanOrEqual(30 + 15);
  });
});
