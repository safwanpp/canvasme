// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Element } from "@/lib/model";
import { renderElementsCanvas, renderPageCanvas } from "@/lib/render";
import { fxCache } from "@/lib/fx/cache";
import { adjEl, groupEl, makeDesign, rectEl } from "../fixtures/design";

// A 100×100 mask: white (alpha 255) on the left half, clear on the right.
const masks = new Map<string, HTMLCanvasElement>();
vi.mock("@/lib/images", () => ({
  loadAssetImage: async (id: string) => masks.get(id) ?? null,
  getReadyImage: () => undefined,
}));
vi.mock("@/lib/fonts", () => ({ ensureFonts: async () => {} }));

function halfMask() {
  const c = document.createElement("canvas");
  c.width = 100;
  c.height = 100;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, 50, 100);
  return c;
}

async function pagePx(els: Element[], background = "#ffffff") {
  const d = makeDesign(els, { background });
  const c = await renderPageCanvas(d, d.pages[0], 1);
  const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  return (x: number, y: number) => Array.from(data.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 4));
}
const near = (got: number[], want: number[], tol = 2) =>
  expect(got.every((v, i) => Math.abs(v - want[i]) <= tol), `got ${got}, want ${want}`).toBe(true);

const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
const CYAN = [0, 255, 255, 255];
const BLUE = [0, 0, 255, 255];
const RED = [255, 0, 0, 255];

const red = (p?: Partial<Element>) => rectEl({ id: "red", x: 20, y: 20, width: 60, height: 60, fill: "#ff0000", ...(p as object) });

beforeEach(() => fxCache.clear());

describe("adjustment layers", () => {
  it("invert adjustment inverts layers below only", async () => {
    const at = await pagePx([red(), adjEl(), rectEl({ x: 120, y: 120, width: 40, height: 40, fill: "#0000ff" })]);
    near(at(50, 50), CYAN);
    near(at(140, 140), BLUE);
    near(at(5, 5), BLACK);
  });

  it("hidden adjustment changes nothing", async () => {
    const at = await pagePx([red(), adjEl({ hidden: true })]);
    near(at(50, 50), RED);
    near(at(5, 5), WHITE);
  });

  it("opacity 50% halves", async () => {
    const at = await pagePx([red(), adjEl({ opacity: 0.5 })]);
    near(at(50, 50), [128, 128, 128, 255]);
  });

  it("blend mode applies between the layers below and their adjusted copy", async () => {
    // Invert in multiply over grey 128: 128·127/255 ≈ 64.
    const at = await pagePx([rectEl({ x: 0, y: 0, width: 200, height: 200, fill: "#808080" }), adjEl({ blendMode: "multiply" })]);
    near(at(50, 50), [64, 64, 64, 255]);
  });

  it("adjustment inside an isolated group affects only group content", async () => {
    const g = groupEl({ id: "g", blendMode: "normal" });
    const at = await pagePx([red({ groupId: "g" }), adjEl({ groupId: "g" }), g]);
    near(at(50, 50), CYAN);
    near(at(5, 5), WHITE);
  });

  it("adjustment inside a pass-through group affects everything below", async () => {
    const g = groupEl({ id: "g" });
    const at = await pagePx([red({ groupId: "g" }), adjEl({ groupId: "g" }), g]);
    near(at(50, 50), CYAN);
    near(at(5, 5), BLACK);
  });

  it("clipped adjustment affects base only", async () => {
    const at = await pagePx([red(), adjEl({ clipped: true })]);
    near(at(50, 50), CYAN);
    near(at(5, 5), WHITE);
  });

  it("raster mask limits effect", async () => {
    masks.set("m1", halfMask());
    // Mask over the left 100×200 strip: left half of it (x < 50) inverted, outside the mask hidden.
    const at = await pagePx([adjEl({ rasterMask: { assetId: "m1", x: 0, y: 0, width: 100, height: 200 } })], "#ff0000");
    near(at(20, 100), CYAN);
    near(at(70, 100), RED);
    near(at(150, 100), RED);
    // Outside the mask's rectangle counts as `outside`.
    const at2 = await pagePx([adjEl({ rasterMask: { assetId: "m1", x: 0, y: 0, width: 100, height: 200, outside: 1 } })], "#ff0000");
    near(at2(150, 100), CYAN);
    near(at2(70, 100), RED);
  });

  it("an adjustment's box limits it (rotation included)", async () => {
    const at = await pagePx([adjEl({ x: 0, y: 0, width: 100, height: 200 })], "#ff0000");
    near(at(20, 100), CYAN);
    near(at(150, 100), RED);
  });

  it("rasterizing a selection with an adjustment adjusts only what is selected below it", async () => {
    const { canvas, box } = await renderElementsCanvas([red(), adjEl()]);
    const k = canvas.width / box.width;
    const at = (x: number, y: number) => Array.from(canvas.getContext("2d")!.getImageData(Math.floor((x - box.x) * k), Math.floor((y - box.y) * k), 1, 1).data);
    near(at(50, 50), CYAN);
    expect(at(150, 150)[3]).toBe(0);
  });
});

describe("filters", () => {
  it("blur filter softens an edge", async () => {
    const at = await pagePx([red({ filters: [{ type: "blur", radius: 4 }] })]);
    const edge = at(81, 50);
    expect(edge[1]).toBeLessThan(250); // reddish past the edge
    expect(edge[1]).toBeGreaterThan(30);
    near(at(50, 50), RED, 3);
  });

  it("adjust filter changes the element only", async () => {
    const at = await pagePx([red({ filters: [{ type: "adjust", adjustment: { type: "invert" } }] })]);
    near(at(50, 50), CYAN);
    near(at(5, 5), WHITE);
  });

  it("filters run before effects: a stroke stays sharp around a blurred element", async () => {
    const at = await pagePx([
      red({
        filters: [{ type: "adjust", adjustment: { type: "invert" } }],
        effects: { stroke: [{ enabled: true, blendMode: "normal", opacity: 1, size: 4, position: "outside", paint: { type: "color", color: "#0000ff" } }] },
      }),
    ]);
    near(at(50, 50), CYAN);
    near(at(82, 50), BLUE);
  });
});

describe("page sizes", () => {
  it("page without width/height renders at design size; a sized page at its own", async () => {
    const d = makeDesign([red()]);
    d.pages.push({ id: "p2", background: "#00ff00", elements: [], width: 300, height: 120 });
    const a = await renderPageCanvas(d, d.pages[0], 1);
    expect([a.width, a.height]).toEqual([200, 200]);
    const b = await renderPageCanvas(d, d.pages[1], 1);
    expect([b.width, b.height]).toEqual([300, 120]);
    const px = Array.from(b.getContext("2d")!.getImageData(290, 110, 1, 1).data);
    near(px, [0, 255, 0, 255]);
  });
});
