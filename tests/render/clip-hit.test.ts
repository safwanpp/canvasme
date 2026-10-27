// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import Konva from "konva";
import type { Element } from "@/lib/model";
import { buildTree } from "@/lib/render";
import { buildRenderTree } from "@/lib/tree";
import { groupEl, rectEl, rectPath, vectorEl } from "../fixtures/design";

vi.mock("@/lib/images", () => ({ loadAssetImage: async () => null, getReadyImage: () => undefined }));
vi.mock("@/lib/fonts", () => ({ ensureFonts: async () => {} }));

/** The id of the element a click at x,y lands on. */
function hitter(els: Element[]) {
  const stage = new Konva.Stage({ container: document.createElement("div"), width: 200, height: 200 });
  const layer = new Konva.Layer();
  stage.add(layer);
  for (const g of buildTree(Konva, buildRenderTree(els), new Map())) layer.add(g);
  layer.draw();
  const ids = new Set(els.map((e) => e.id));
  return (x: number, y: number) => {
    let n: Konva.Node | null = stage.getIntersection({ x, y });
    while (n && !ids.has(n.id())) n = n.getParent();
    return n?.id() ?? null;
  };
}

const under = () => rectEl({ id: "under", x: 0, y: 0, width: 200, height: 200, fill: "#00ff00" });
const circle = () => rectEl({ id: "base", shape: "ellipse", x: 50, y: 50, width: 100, height: 100 });
const cover = (p?: Partial<Element>) => rectEl({ id: "c", x: 0, y: 0, width: 200, height: 200, fill: "#0000ff", clipped: true, ...(p as object) });

describe("clip stack hit testing", () => {
  it("a click on a clipped layer outside its base falls through", () => {
    const hit = hitter([under(), circle(), cover()]);
    expect(hit(100, 100)).toBe("c");
    expect(hit(10, 10)).toBe("under");
    // Inside the base's box but outside its outline.
    expect(hit(55, 55)).toBe("under");
  });

  it("the base itself still takes clicks where nothing clipped covers it", () => {
    const hit = hitter([under(), circle(), cover({ x: 100, width: 100 })]);
    expect(hit(70, 100)).toBe("base");
    expect(hit(130, 100)).toBe("c");
  });

  it("a hole in a vector base lets clicks through", () => {
    const base = vectorEl({ id: "base", subpaths: [rectPath(0, 0, 100, 100, "combine"), rectPath(25, 25, 50, 50, "subtract")] });
    const hit = hitter([under(), base, cover()]);
    expect(hit(60, 60)).toBe("c");
    expect(hit(100, 100)).toBe("under");
  });

  it("a group base clips hits to its members", () => {
    const g = groupEl({ id: "g" });
    const a = rectEl({ id: "a", x: 20, y: 20, width: 40, height: 40, groupId: "g" });
    const b = rectEl({ id: "b", x: 120, y: 120, width: 40, height: 40, groupId: "g" });
    const hit = hitter([under(), a, b, g, cover()]);
    expect(hit(30, 30)).toBe("c");
    expect(hit(140, 140)).toBe("c");
    expect(hit(90, 90)).toBe("under");
  });

  it("nested clip stacks keep their own hit regions (a stack inside a clipped group)", () => {
    // Outer stack: circle base, a clipped group above it. Inside the group: a stack of a left-half
    // base with a layer clipped to it.
    const g = groupEl({ id: "g", clipped: true });
    const ib = rectEl({ id: "ib", x: 0, y: 0, width: 100, height: 200, fill: "#ff00ff", groupId: "g" });
    const ic = rectEl({ id: "ic", x: 0, y: 0, width: 200, height: 200, fill: "#0000ff", clipped: true, groupId: "g" });
    const hit = hitter([under(), circle(), ib, ic, g]);
    // Inside the circle and the inner base: the inner clipped layer.
    expect(hit(80, 100)).toBe("ic");
    // Inside the circle, outside the inner base: nothing of the group there, so the base.
    expect(hit(130, 100)).toBe("base");
    // Inside the inner stack but outside the circle: falls through.
    expect(hit(20, 20)).toBe("under");
    expect(hit(180, 180)).toBe("under");
  });

  it("a small clip stack hits right at its edges (scratch limited to the stack's rect)", () => {
    const hit = hitter([under(), rectEl({ id: "base", x: 150, y: 150, width: 20, height: 20 }), cover()]);
    expect(hit(160, 160)).toBe("c");
    expect(hit(149, 160)).toBe("under");
    expect(hit(171, 160)).toBe("under");
  });
});
