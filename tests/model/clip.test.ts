import { describe, expect, it } from "vitest";
import { Design, type Element } from "@/lib/model";
import { buildRenderTree, clipBase, clipHiddenIds, clipIds, clipStacks, normalizeTree, releaseClipIds } from "@/lib/tree";
import { groupEl, makeDesign, rectEl } from "../fixtures/design";

const r = (id: string, p?: Partial<Element>) => rectEl({ id, ...(p as object) });
const clippedIds = (els: Element[]) => els.filter((e) => e.clipped).map((e) => e.id);

describe("clipping in the tree", () => {
  it("clipped is optional and survives the schema", () => {
    const d = makeDesign([r("a"), r("b", { clipped: true })]);
    const parsed = Design.parse(d);
    expect(parsed.pages[0].elements[1].clipped).toBe(true);
    expect(parsed.pages[0].elements[0].clipped).toBeUndefined();
  });

  it("normalizeTree unclips the bottom layer of each parent and keeps valid lists as they are", () => {
    const ok = [r("a"), r("b", { clipped: true }), r("c", { clipped: true })];
    expect(normalizeTree(ok)).toBe(ok);
    const bad = [r("a", { clipped: true }), r("b", { groupId: "G", clipped: true }), r("c", { groupId: "G", clipped: true }), groupEl({ id: "G", clipped: true })];
    const out = normalizeTree(bad);
    expect(clippedIds(out)).toEqual(["c", "G"]);
  });

  it("clipStacks attaches clipped siblings to the nearest non-clipped one below", () => {
    const els = [r("a"), r("b", { clipped: true }), r("c", { clipped: true }), r("d"), r("e", { clipped: true }), r("f")];
    const stacks = clipStacks(buildRenderTree(els));
    expect(stacks.map((s) => [s.node.el.id, s.clipped.map((c) => c.el.id)])).toEqual([
      ["a", ["b", "c"]],
      ["d", ["e"]],
      ["f", []],
    ]);
  });

  it("a group can be the base, and a group can be clipped", () => {
    const els = [r("m", { groupId: "G" }), groupEl({ id: "G" }), r("n", { groupId: "H" }), groupEl({ id: "H", clipped: true })];
    expect(normalizeTree(els)).toBe(els);
    expect(clipBase(els, "H")).toBe("G");
    const stacks = clipStacks(buildRenderTree(els));
    expect(stacks.map((s) => [s.node.el.id, s.clipped.map((c) => c.el.id)])).toEqual([["G", ["H"]]]);
  });

  it("clipBase stays within the parent", () => {
    const els = [r("a"), r("b", { groupId: "G" }), r("c", { groupId: "G", clipped: true }), groupEl({ id: "G" }), r("d", { clipped: true })];
    expect(clipBase(els, "c")).toBe("b");
    expect(clipBase(els, "d")).toBe("G");
    expect(clipBase(els, "a")).toBeNull();
  });

  it("clipIds clips one layer to the one below, or several to the lowest selected", () => {
    const els = [r("a"), r("b"), r("c"), r("d")];
    expect(clippedIds(clipIds(els, ["c"]))).toEqual(["c"]);
    expect(clippedIds(clipIds(els, ["b", "c", "d"]))).toEqual(["c", "d"]);
    // The bottom layer has nothing below it.
    expect(clipIds(els, ["a"])).toBe(els);
  });

  it("clipIds treats a wholly selected group as one layer", () => {
    const els = [r("a"), r("b", { groupId: "G" }), r("c", { groupId: "G" }), groupEl({ id: "G" })];
    expect(clippedIds(clipIds(els, ["b", "c"]))).toEqual(["G"]);
  });

  it("releasing a layer in a stack releases the clipped layers above it too", () => {
    const els = [r("a"), r("b", { clipped: true }), r("c", { clipped: true }), r("d", { clipped: true }), r("e")];
    expect(clippedIds(releaseClipIds(els, ["c"]))).toEqual(["b"]);
    // Releasing the base releases its whole stack.
    expect(clippedIds(releaseClipIds(els, ["a"]))).toEqual([]);
    expect(releaseClipIds(els, ["e"])).toBe(els);
  });

  it("clipHiddenIds lists layers hidden by a hidden clip base, members of clipped groups included", () => {
    const els = [
      r("a", { hidden: true }),
      r("b", { clipped: true }),
      r("m", { groupId: "G" }),
      groupEl({ id: "G", clipped: true }),
      r("d"),
      r("e", { clipped: true }),
    ];
    expect([...clipHiddenIds(els)].sort()).toEqual(["G", "b", "m"]);
    expect(clipHiddenIds([r("a"), r("b", { clipped: true })]).size).toBe(0);
  });
});
