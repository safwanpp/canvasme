// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { currentPage, useEditor } from "@/store/editor";
import { groupEl, makeDesign, rectEl } from "../fixtures/design";

const r = (id: string, groupId: string | null = null) => rectEl({ id, groupId, x: 0, y: 0, width: 10, height: 10 });
const page = () => currentPage(useEditor.getState())!.elements;
const st = () => useEditor.getState();

beforeEach(() => {
  // a, [G: b, c], d
  st().load({ ...makeDesign([r("a"), r("b", "G"), r("c", "G"), groupEl({ id: "G" }), r("d")]), version: 3 });
});

describe("adding adjustments", () => {
  it("adding adjustment inserts above selection in same parent", () => {
    st().select(["b"], false, true);
    const id = st().addAdjustment("levels")!;
    const els = page();
    const adj = els.find((e) => e.id === id)!;
    expect(adj.type).toBe("adjustment");
    expect(adj.groupId).toBe("G");
    expect(els.map((e) => e.id)).toEqual(["a", "b", id, "c", "G", "d"]);
    expect(st().selected).toEqual([id]);
  });

  it("with nothing selected it goes on top of the page, covering the page", () => {
    const id = st().addAdjustment("invert")!;
    const els = page();
    expect(els[els.length - 1].id).toBe(id);
    expect(els[els.length - 1]).toMatchObject({ x: 0, y: 0, width: 200, height: 200, groupId: null });
  });

  it("covers a sized page (artboard) at its own size, and undoes in one step", () => {
    st().mutate((d) => {
      d.pages[0].width = 300;
      d.pages[0].height = 120;
    });
    const id = st().addAdjustment("curves")!;
    expect(page().find((e) => e.id === id)).toMatchObject({ width: 300, height: 120 });
    st().undo();
    expect(page().some((e) => e.id === id)).toBe(false);
  });
});
