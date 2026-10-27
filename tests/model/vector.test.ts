import { describe, expect, it } from "vitest";
import { Design, VectorElement, VectorMask } from "@/lib/model";
import { pathComponents, scalePathFields, scaleSubpaths, transformSubpaths, translateSubpaths, vectorBounds } from "@/lib/vector";
import { corner, imageEl, makeDesign, rectPath, vectorEl } from "../fixtures/design";

describe("vector geometry", () => {
  it("bounds of a cubic include curve extrema, not control points", () => {
    // An arch from (0,0) to (100,0) with both handles 100 up: its top is at y = -75.
    const b = vectorBounds([
      {
        closed: false,
        knots: [
          { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: -100 },
          { x: 100, y: 0, inX: 100, inY: -100, outX: 100, outY: 0 },
        ],
      },
    ]);
    expect(b.x).toBeCloseTo(0, 6);
    expect(b.width).toBeCloseTo(100, 6);
    expect(b.y).toBeCloseTo(-75, 6);
    expect(b.height).toBeCloseTo(75, 6);
  });

  it("bounds of a closed path include its closing segment", () => {
    const b = vectorBounds([
      {
        closed: true,
        knots: [
          { x: 0, y: 0, inX: 0, inY: 40, outX: 0, outY: 0 },
          { x: 100, y: 0, inX: 100, inY: 0, outX: 100, outY: 40 },
        ],
      },
    ]);
    // The closing segment runs back from (100,0) to (0,0) bulging down to y = 30.
    expect(b.height).toBeCloseTo(30, 6);
  });

  it("bounds span every subpath", () => {
    expect(vectorBounds([rectPath(10, 20, 5, 5), rectPath(-5, 0, 2, 50)])).toEqual({ x: -5, y: 0, width: 20, height: 50 });
  });

  it("scale on resize scales anchors and handles", () => {
    const sp = [{ closed: true, knots: [{ x: 10, y: 20, inX: 5, inY: 15, outX: 15, outY: 25 }] }];
    expect(scaleSubpaths(sp, 2, 0.5)[0].knots[0]).toEqual({ x: 20, y: 10, inX: 10, inY: 7.5, outX: 30, outY: 12.5 });
    expect(translateSubpaths(sp, 1, -1)[0].knots[0]).toEqual({ x: 11, y: 19, inX: 6, inY: 14, outX: 16, outY: 24 });
    expect(transformSubpaths(sp, (x, y) => [y, x])[0].knots[0]).toEqual({ x: 20, y: 10, inX: 15, inY: 5, outX: 25, outY: 15 });
    // Input untouched.
    expect(sp[0].knots[0].x).toBe(10);
  });

  it("subpaths without an operation join the component before them", () => {
    const a = rectPath(0, 0, 10, 10, "combine");
    const b = rectPath(2, 2, 2, 2);
    const c = rectPath(5, 5, 2, 2, "subtract");
    const comps = pathComponents([a, b, c]);
    expect(comps.map((x) => [x.op, x.paths.length])).toEqual([
      ["combine", 2],
      ["subtract", 1],
    ]);
  });

  it("the first component always adds, whatever its operation", () => {
    expect(pathComponents([rectPath(0, 0, 1, 1, "subtract")])[0].op).toBe("combine");
  });
});

describe("vector schema", () => {
  it("vector elements and vector masks survive the design schema", () => {
    const v = vectorEl({ dash: [4, 2], stroke: { type: "color", color: "#00ff00" }, strokeWidth: 3, strokeAlign: "outside" });
    const masked = { ...vectorEl({ id: "m" }), vectorMask: { subpaths: [rectPath(0, 0, 10, 10)], fillRule: "evenodd" as const, invert: true } };
    const r = Design.safeParse(makeDesign([v, masked]));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.pages[0].elements[0]).toEqual(v);
    expect(r.data.pages[0].elements[1]).toMatchObject({ vectorMask: { invert: true, fillRule: "evenodd" } });
    expect(VectorElement.safeParse({ ...v, subpaths: [] }).success).toBe(false);
    expect(VectorMask.safeParse({ subpaths: [{ closed: true, knots: [corner(0, 0)] }] }).data).toMatchObject({ fillRule: "nonzero", invert: false });
  });
});

describe("resizing", () => {
  it("scalePathFields scales a vector's subpaths and any element's vector mask; strokes keep their width", () => {
    const v = vectorEl({ strokeWidth: 4, stroke: { type: "color", color: "#000000" }, vectorMask: { subpaths: [rectPath(0, 0, 10, 10)], fillRule: "nonzero", invert: false } });
    const p = scalePathFields(v, 2, 0.5);
    expect(p.subpaths?.[0].knots[2]).toMatchObject({ x: 200, y: 50 });
    expect(p.vectorMask?.subpaths[0].knots[2]).toMatchObject({ x: 20, y: 5 });
    expect(p).not.toHaveProperty("strokeWidth");
    const img = imageEl({ vectorMask: { subpaths: [rectPath(0, 0, 10, 10)], fillRule: "nonzero", invert: true } });
    expect(scalePathFields(img, 3, 3)).toMatchObject({ vectorMask: { invert: true, subpaths: [{ knots: [{}, { x: 30 }, {}, {}] }] } });
    expect(scalePathFields(imageEl(), 2, 2)).toEqual({});
  });
});
