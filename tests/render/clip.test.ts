// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effects } from "@/lib/effects";
import type { Element } from "@/lib/model";
import { renderElementsCanvas, renderPageCanvas } from "@/lib/render";
import { fxCache } from "@/lib/fx/cache";
import { groupEl, imageEl, makeDesign, rectEl } from "../fixtures/design";
import { maskImage } from "@/lib/mask";

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

const WHITE = [255, 255, 255, 255];
const BLUE = [0, 0, 255, 255];
const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];

/** A red circle filling 50..150. */
const circle = (p?: Partial<Element>) => rectEl({ id: "base", shape: "ellipse", x: 50, y: 50, width: 100, height: 100, fill: "#ff0000", ...(p as object) });
/** A clipped rect over the whole page. */
const cover = (id: string, fill: string, p?: Partial<Element>) =>
  rectEl({ id, x: 0, y: 0, width: 200, height: 200, fill, clipped: true, ...(p as object) });

beforeEach(() => fxCache.clear());

describe("clip stacks", () => {
  it("clipped element only shows inside base alpha", async () => {
    const at = await pagePx([circle(), cover("c", "#0000ff")]);
    near(at(100, 100), BLUE, 1);
    near(at(60, 60), WHITE, 1); // inside the circle's box, outside the circle
    near(at(10, 10), WHITE, 1);
    near(at(145, 100), BLUE, 1);
  });

  it("an unclipped element over the same base covers the page as usual", async () => {
    const at = await pagePx([circle(), cover("c", "#0000ff", { clipped: undefined })]);
    near(at(10, 10), BLUE, 1);
  });

  it("hiding the base hides its clipped layers", async () => {
    const at = await pagePx([circle({ hidden: true }), cover("c", "#0000ff")]);
    near(at(100, 100), WHITE, 0);
    near(at(10, 10), WHITE, 0);
  });

  it("a hidden clipped layer is skipped; the base still shows", async () => {
    const at = await pagePx([circle(), cover("c", "#0000ff", { hidden: true })]);
    near(at(100, 100), RED, 1);
  });

  it("clipped layers stack in order inside the base", async () => {
    const at = await pagePx([
      rectEl({ id: "base", x: 50, y: 50, width: 100, height: 100, fill: "#ff0000" }),
      rectEl({ id: "g", x: 40, y: 0, width: 60, height: 200, fill: "#00ff00", clipped: true }),
      rectEl({ id: "b", x: 80, y: 0, width: 100, height: 200, fill: "#0000ff", clipped: true }),
    ]);
    near(at(60, 100), GREEN, 1);
    near(at(90, 100), BLUE, 1);
    near(at(140, 100), BLUE, 1);
    near(at(160, 100), WHITE, 1);
    near(at(90, 20), WHITE, 1);
  });

  it("a clipped layer's blend mode blends with the stack below it, inside the base", async () => {
    const at = await pagePx([
      rectEl({ id: "base", x: 50, y: 50, width: 100, height: 100, fill: "#ffff00" }),
      cover("c", "#00ffff", { blendMode: "multiply" }),
    ]);
    near(at(100, 100), GREEN, 2);
    near(at(20, 20), WHITE, 1);
  });

  it("a clipped layer's software blend reads the stack as its backdrop", async () => {
    const at = await pagePx([
      rectEl({ id: "base", x: 50, y: 50, width: 100, height: 100, fill: "#c0c0c0" }),
      cover("c", "#808080", { blendMode: "linear-burn" }),
    ]);
    near(at(100, 100), [0x41, 0x41, 0x41, 255], 3);
    near(at(20, 20), WHITE, 1);
  });

  it("the base's opacity fades the whole stack", async () => {
    const at = await pagePx([circle({ opacity: 0.5 }), cover("c", "#0000ff")]);
    near(at(100, 100), [128, 128, 255, 255], 2);
  });

  it("the base's fill opacity fades only the base, not the clip", async () => {
    const at = await pagePx([circle({ fillOpacity: 0 }), cover("c", "#0000ff", { opacity: 0.5 })]);
    near(at(100, 100), [128, 128, 255, 255], 2);
    near(at(60, 60), WHITE, 1);
  });

  it("the base's blend mode applies to the whole stack", async () => {
    const at = await pagePx([circle({ blendMode: "multiply" }), cover("c", "#00ffff")], "#ffff00");
    near(at(100, 100), GREEN, 2);
    near(at(10, 10), [255, 255, 0, 255], 1);
  });

  it("clip base outer shadow is not clipped and clipped content casts none", async () => {
    const effects = Effects.parse({ dropShadow: [{ color: "#000000", angle: 90, distance: 30, size: 0, blendMode: "normal" }] });
    const at = await pagePx([
      rectEl({ id: "base", x: 50, y: 50, width: 100, height: 60, fill: "#ff0000", effects }),
      rectEl({ id: "c", x: 0, y: 0, width: 200, height: 80, fill: "#0000ff", clipped: true }),
    ]);
    near(at(100, 60), BLUE, 1);
    near(at(100, 100), RED, 1);
    near(at(100, 130), [0, 0, 0, 255], 1); // the base's shadow, outside the base
    near(at(20, 60), WHITE, 1);
  });

  it("a clipped layer's own effects are clipped to the base too", async () => {
    const effects = Effects.parse({ dropShadow: [{ color: "#00ff00", angle: 90, distance: 40, size: 0, blendMode: "normal" }] });
    const at = await pagePx([
      rectEl({ id: "base", x: 50, y: 50, width: 100, height: 100, fill: "#ff0000" }),
      rectEl({ id: "c", x: 60, y: 30, width: 80, height: 60, fill: "#0000ff", clipped: true, effects }),
    ]);
    near(at(100, 80), BLUE, 1);
    near(at(100, 120), GREEN, 1); // the shadow, inside the base
    near(at(100, 40), WHITE, 1); // the clipped rect outside the base
  });

  it("a group can be the base: its members' pixels are the mask", async () => {
    const at = await pagePx([
      rectEl({ id: "m1", x: 20, y: 20, width: 40, height: 40, groupId: "G" }),
      rectEl({ id: "m2", x: 120, y: 20, width: 40, height: 40, groupId: "G" }),
      groupEl({ id: "G" }),
      cover("c", "#0000ff"),
    ]);
    near(at(40, 40), BLUE, 1);
    near(at(140, 40), BLUE, 1);
    near(at(90, 40), WHITE, 1);
  });

  it("a clipped group is clipped as a whole", async () => {
    const at = await pagePx([
      circle(),
      rectEl({ id: "m", x: 0, y: 0, width: 200, height: 200, fill: "#0000ff", groupId: "H" }),
      groupEl({ id: "H", clipped: true, opacity: 0.5 }),
    ]);
    near(at(100, 100), [128, 0, 128, 255], 2);
    near(at(10, 10), WHITE, 1);
  });

  it("a stack inside an isolated group renders clipped", async () => {
    const at = await pagePx([
      circle({ groupId: "G" }),
      cover("c", "#0000ff", { groupId: "G" }),
      groupEl({ id: "G", opacity: 0.5 }),
    ]);
    near(at(100, 100), [128, 128, 255, 255], 2);
    near(at(10, 10), WHITE, 1);
  });

  it("an image masked to a shape works as a base: the mask's outline is the clip", async () => {
    const masked = maskImage(imageEl({ id: "img", x: 0, y: 0, width: 200, height: 200 }), circle() as never, false);
    const at = await pagePx([masked, cover("c", "#0000ff")]);
    near(at(100, 100), BLUE, 1);
    near(at(60, 60), WHITE, 1);
  });

  it("rasterizing a base with its clipped layer keeps the clip", async () => {
    const { canvas, box } = await renderElementsCanvas([circle(), cover("c", "#0000ff")]);
    const ratio = canvas.width / box.width;
    const ctx = canvas.getContext("2d")!;
    const a = (x: number, y: number) => ctx.getImageData(Math.round((x - box.x) * ratio), Math.round((y - box.y) * ratio), 1, 1).data;
    expect(Array.from(a(100, 100))).toEqual(BLUE);
    expect(a(60, 60)[3]).toBe(0);
  });
});
