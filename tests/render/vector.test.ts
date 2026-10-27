// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Element, VectorMask } from "@/lib/model";
import { renderPageCanvas } from "@/lib/render";
import { fxCache } from "@/lib/fx/cache";
import { strokeReach, VECTOR_CACHE_ENTRIES, vectorRenderCache } from "@/lib/vectorDraw";
import { makeDesign, rectEl, rectPath, vectorEl } from "../fixtures/design";

vi.mock("@/lib/images", () => ({ loadAssetImage: async () => null, getReadyImage: () => undefined }));
vi.mock("@/lib/fonts", () => ({ ensureFonts: async () => {} }));

async function pagePx(els: Element[]) {
  const d = makeDesign(els);
  const c = await renderPageCanvas(d, d.pages[0], 1);
  const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  return (x: number, y: number) => Array.from(data.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 4));
}
const near = (got: number[], want: number[], tol = 2) =>
  expect(got.every((v, i) => Math.abs(v - want[i]) <= tol), `got ${got}, want ${want}`).toBe(true);

const WHITE = [255, 255, 255, 255];
const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const BLACK = [0, 0, 0, 255];

beforeEach(() => fxCache.clear());

describe("vector elements", () => {
  it("a solid fill covers the path only", async () => {
    const at = await pagePx([vectorEl()]);
    near(at(100, 100), RED);
    near(at(40, 100), WHITE);
    near(at(155, 100), WHITE);
  });

  it("a curved path draws its curve", async () => {
    // A half-disc bulging down from the top edge: a point under the chord is filled, a corner isn't.
    const at = await pagePx([
      vectorEl({
        subpaths: [
          {
            closed: true,
            op: "combine",
            knots: [
              { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 133 },
              { x: 100, y: 0, inX: 100, inY: 133, outX: 100, outY: 0 },
            ],
          },
        ],
      }),
    ]);
    near(at(100, 120), RED);
    near(at(53, 140), WHITE);
  });

  it("subtract op leaves a hole (pixel transparent)", async () => {
    const at = await pagePx([vectorEl({ subpaths: [rectPath(0, 0, 100, 100, "combine"), rectPath(25, 25, 50, 50, "subtract")] })]);
    near(at(100, 100), WHITE);
    near(at(60, 60), RED);
  });

  it("intersect keeps only the overlap and exclude drops it", async () => {
    const two = (op: "intersect" | "exclude") => [rectPath(0, 0, 60, 100, "combine"), rectPath(40, 0, 60, 100, op)];
    const inter = await pagePx([vectorEl({ subpaths: two("intersect") })]);
    near(inter(100, 100), RED);
    near(inter(60, 100), WHITE);
    near(inter(140, 100), WHITE);
    const excl = await pagePx([vectorEl({ subpaths: two("exclude") })]);
    near(excl(100, 100), WHITE);
    near(excl(60, 100), RED);
    near(excl(140, 100), RED);
  });

  it("evenodd ring: an inner subpath of the same component is a hole", async () => {
    const ring = [rectPath(0, 0, 100, 100, "combine"), rectPath(25, 25, 50, 50)];
    const eo = await pagePx([vectorEl({ subpaths: ring, fillRule: "evenodd" })]);
    near(eo(100, 100), WHITE);
    near(eo(60, 60), RED);
    // Same winding under nonzero: no hole.
    const nz = await pagePx([vectorEl({ subpaths: ring })]);
    near(nz(100, 100), RED);
  });

  it("outside stroke paints outside only", async () => {
    const at = await pagePx([vectorEl({ stroke: { type: "color", color: "#0000ff" }, strokeWidth: 10, strokeAlign: "outside" })]);
    near(at(52, 100), RED);
    near(at(45, 100), BLUE);
    near(at(38, 100), WHITE);
  });

  it("inside stroke paints inside only", async () => {
    const at = await pagePx([vectorEl({ stroke: { type: "color", color: "#0000ff" }, strokeWidth: 10, strokeAlign: "inside" })]);
    near(at(55, 100), BLUE);
    near(at(65, 100), RED);
    near(at(47, 100), WHITE);
  });

  it("center stroke straddles the edge and dashes leave gaps", async () => {
    // Dashes are in stroke widths: [2, 2] at width 5 is 10 on, 10 off.
    const at = await pagePx([vectorEl({ fill: null, stroke: { type: "color", color: "#000000" }, strokeWidth: 5, dash: [2, 2] })]);
    near(at(100, 100), WHITE); // no fill
    near(at(57, 49), BLACK); // first dash along the top edge
    near(at(62, 49), WHITE); // first gap
  });

  it("miter joins follow the miter limit (default 10)", async () => {
    // A tip whose miter is ~5.1 stroke widths: drawn at the default limit, bevelled at 2.
    const tip = [{ closed: true, op: "combine" as const, knots: [[0, 0], [100, 20], [0, 40]].map(([x, y]) => ({ x, y, inX: x, inY: y, outX: x, outY: y })) }];
    const el = (miterLimit?: number) =>
      vectorEl({ x: 20, y: 50, width: 100, height: 40, subpaths: tip, fill: null, stroke: { type: "color", color: "#000000" }, strokeWidth: 10, ...(miterLimit ? { miterLimit } : {}) });
    near((await pagePx([el()]))(135, 70), BLACK);
    near((await pagePx([el(2)]))(135, 70), WHITE);
  });

  it("strokeReach allows for the miter limit, capped", () => {
    const s = { stroke: { type: "color" as const, color: "#000000" }, strokeWidth: 4, strokeAlign: "center" as const, lineJoin: "miter" as const };
    expect(strokeReach({ ...s, miterLimit: 4 })).toBe(8);
    expect(strokeReach(s)).toBe(20);
    expect(strokeReach({ ...s, miterLimit: 100 })).toBe(20);
    expect(strokeReach({ ...s, lineJoin: "round" })).toBe(2);
  });

  it("gradient fill runs across the box", async () => {
    const at = await pagePx([
      vectorEl({
        fill: {
          type: "gradient",
          gradient: { style: "linear", angle: 0, scale: 1, reverse: false, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] },
        },
      }),
    ]);
    expect(at(52, 100)[0]).toBeLessThan(20);
    expect(at(147, 100)[0]).toBeGreaterThan(235);
    near(at(100, 100), [128, 128, 128, 255], 6);
  });

  it("a resized vector draws its scaled path", async () => {
    const at = await pagePx([vectorEl({ width: 50, subpaths: [rectPath(0, 0, 50, 100, "combine")] })]);
    near(at(90, 100), RED);
    near(at(110, 100), WHITE);
  });

  it("effects and blend modes work on vectors", async () => {
    const at = await pagePx([
      vectorEl({
        effects: { dropShadow: [{ enabled: true, blendMode: "normal", opacity: 1, color: "#0000ff", angle: 90, distance: 20, size: 0, spread: 0, knockout: true }] },
      }),
      // Green multiplied over red is black; over white it stays green.
      vectorEl({ id: "m", x: 0, y: 0, width: 200, height: 20, subpaths: [rectPath(0, 0, 200, 20, "combine")], fill: { type: "color", color: "#00ff00" }, blendMode: "multiply" }),
      vectorEl({ id: "n", x: 120, y: 0, width: 20, height: 200, subpaths: [rectPath(0, 0, 20, 200, "combine")], fill: { type: "color", color: "#00ff00" }, blendMode: "multiply" }),
    ]);
    near(at(100, 160), BLUE); // the shadow, 20 below
    near(at(100, 100), RED);
    near(at(10, 10), [0, 255, 0, 255]);
    near(at(130, 100), BLACK);
  });

  it("a clipped layer clips to the vector's shape", async () => {
    const at = await pagePx([
      vectorEl({ id: "base", subpaths: [rectPath(0, 0, 100, 100, "combine"), rectPath(25, 25, 50, 50, "subtract")] }),
      rectEl({ x: 0, y: 0, width: 200, height: 200, fill: "#0000ff", clipped: true }),
    ]);
    near(at(60, 60), BLUE);
    near(at(100, 100), WHITE);
    near(at(10, 10), WHITE);
  });
});

describe("vector masks", () => {
  const mask = (p?: Partial<VectorMask>): VectorMask => ({ subpaths: [rectPath(0, 0, 50, 100, "combine")], fillRule: "nonzero", invert: false, ...p });

  it("vector mask clips a shape to its path", async () => {
    const at = await pagePx([rectEl({ x: 50, y: 50, width: 100, height: 100, vectorMask: mask() })]);
    near(at(75, 100), RED);
    near(at(125, 100), WHITE);
  });

  it("inverted mask shows outside the path", async () => {
    const at = await pagePx([rectEl({ x: 50, y: 50, width: 100, height: 100, vectorMask: mask({ invert: true }) })]);
    near(at(75, 100), WHITE);
    near(at(125, 100), RED);
  });

  it("a mask with a subtracted component", async () => {
    const at = await pagePx([
      rectEl({ x: 50, y: 50, width: 100, height: 100, vectorMask: mask({ subpaths: [rectPath(0, 0, 100, 100, "combine"), rectPath(25, 25, 50, 50, "subtract")] }) }),
    ]);
    near(at(100, 100), WHITE);
    near(at(60, 60), RED);
  });

  it("effects are computed from the masked content", async () => {
    // A blue shadow straight below (distance 20): the masked-away right half casts none.
    const shadow = { enabled: true, blendMode: "normal" as const, opacity: 1, color: "#0000ff", angle: 90, distance: 20, size: 0, spread: 0, knockout: true };
    const at = await pagePx([rectEl({ x: 50, y: 50, width: 100, height: 100, vectorMask: mask(), effects: { dropShadow: [shadow] } })]);
    near(at(75, 160), BLUE);
    near(at(125, 160), WHITE);
    near(at(125, 100), WHITE);
  });
});

describe("vector render caches", () => {
  const compound = () => vectorEl({ id: "v", subpaths: [rectPath(0, 0, 100, 100, "combine"), rectPath(25, 25, 50, 50, "subtract")] });
  const maskEl = () => rectEl({ id: "m", x: 50, y: 50, width: 100, height: 100, vectorMask: { subpaths: [rectPath(0, 0, 100, 100, "combine"), rectPath(25, 25, 50, 50, "subtract")], fillRule: "nonzero", invert: false } });

  it("an unchanged vector or masked element reuses its render across new element objects (edits clone the design)", async () => {
    vectorRenderCache.clear();
    await pagePx([compound(), maskEl()]);
    expect(vectorRenderCache.size).toBe(2);
    await pagePx([structuredClone(compound()), structuredClone(maskEl())]);
    expect(vectorRenderCache.size).toBe(2);
    await pagePx([vectorEl({ ...compound(), fill: { type: "color", color: "#00ff00" } }), maskEl()]);
    expect(vectorRenderCache.size).toBe(3);
  });

  it("the cache is bounded and releases canvases it lets go of", async () => {
    vectorRenderCache.clear();
    await pagePx([compound()]);
    const held = vectorRenderCache.canvases();
    expect(held.length).toBeGreaterThan(0);
    vectorRenderCache.clear();
    expect(held.every((c) => c.width === 0)).toBe(true);
    expect(VECTOR_CACHE_ENTRIES).toBeLessThanOrEqual(128);
  });
});
