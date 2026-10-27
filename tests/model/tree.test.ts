import { describe, expect, it } from "vitest";
import type { Element } from "@/lib/model";
import {
  buildRenderTree,
  coveredElements,
  descendants,
  effectiveFlags,
  expandToLeaves,
  groupIds,
  leafIds,
  MAX_DEPTH,
  normalizeTree,
  outermostGroup,
  parentChain,
  reorderTree,
  reparentTree,
  selectedGroup,
  selectedGroups,
  syncGroupBounds,
  tidyTree,
  ungroupIds,
} from "@/lib/tree";
import { groupEl, rectEl } from "../fixtures/design";

const ids = (els: Element[]) => els.map((e) => e.id);
const r = (id: string, groupId: string | null = null, x = 0) => rectEl({ id, groupId, x, y: 0, width: 10, height: 10 });
const g = (id: string, groupId: string | null = null) => groupEl({ id, groupId });

// Bottom first. Page: a, [G: b, [H: c, d]], e
const sample = () => [r("a"), r("b", "G"), r("c", "H"), r("d", "H"), g("H", "G"), g("G"), r("e")];

describe("tree helpers", () => {
  it("parent chain, outermost group and descendants", () => {
    const els = sample();
    expect(parentChain(els, "c")).toEqual(["H", "G"]);
    expect(outermostGroup(els, "c")).toBe("G");
    expect(outermostGroup(els, "a")).toBeNull();
    expect(ids(descendants(els, "G"))).toEqual(["b", "c", "d", "H"]);
  });

  it("leafIds expands groups; expandToLeaves goes to the outermost group", () => {
    const els = sample();
    expect(leafIds(els, ["H", "a"])).toEqual(["a", "c", "d"]);
    expect(expandToLeaves(els, ["c"])).toEqual(["b", "c", "d"]);
    expect(expandToLeaves(els, ["e"])).toEqual(["e"]);
  });

  it("buildRenderTree nests children bottom first", () => {
    const t = buildRenderTree(sample());
    expect(t.map((n) => n.el.id)).toEqual(["a", "G", "e"]);
    expect(t[1].children!.map((n) => n.el.id)).toEqual(["b", "H"]);
    expect(t[1].children![1].children!.map((n) => n.el.id)).toEqual(["c", "d"]);
  });

  it("normalizeTree repairs non-contiguous children", () => {
    // b belongs to G but sits below a stranger, and G's other child is above G.
    const els = [r("b", "G"), r("x"), g("G"), r("c", "G")];
    expect(ids(normalizeTree(els))).toEqual(["x", "b", "c", "G"]);
  });

  it("normalizeTree places the block where the group element sits", () => {
    const els = [r("b", "G"), r("x"), g("G"), r("y")];
    expect(ids(normalizeTree(els))).toEqual(["x", "b", "G", "y"]);
    const out = ids(normalizeTree([r("x"), r("b", "G"), r("y"), g("G"), r("c", "G")]));
    expect(out).toEqual(["x", "y", "b", "c", "G"]);
  });

  it("normalizeTree drops empty groups and nulls dangling groupId", () => {
    const out = normalizeTree([r("a", "missing"), g("E"), g("F", "E"), r("b")]);
    expect(ids(out)).toEqual(["a", "b"]);
    expect(out[0].groupId).toBeNull();
  });

  it("normalizeTree breaks a parent cycle", () => {
    const out = normalizeTree([r("a", "G"), g("G", "H"), g("H", "G")]);
    expect(out.every((e) => e.groupId === null || out.some((p) => p.id === e.groupId))).toBe(true);
    expect(out.find((e) => e.id === "a")).toBeTruthy();
  });

  it("normalizeTree returns the same array when already valid", () => {
    const els = sample();
    expect(normalizeTree(els)).toBe(els);
  });

  it("syncGroupBounds unions descendants", () => {
    const els = syncGroupBounds([r("b", "G", 0), rectEl({ id: "c", groupId: "G", x: 50, y: 20, width: 10, height: 30 }), g("G")]);
    expect(els[2]).toMatchObject({ x: 0, y: 0, width: 60, height: 50 });
  });

  it("effective hidden and locked come from ancestors", () => {
    const els = sample().map((e) => (e.id === "G" ? { ...e, hidden: true } : e.id === "H" ? { ...e, locked: true } : e));
    const f = effectiveFlags(els);
    expect(f.get("b")).toEqual({ hidden: true, locked: false });
    expect(f.get("c")).toEqual({ hidden: true, locked: true });
    expect(f.get("a")).toEqual({ hidden: false, locked: false });
  });

  it("selectedGroup is the outermost group whose leaves equal the selection", () => {
    const els = sample();
    expect(selectedGroup(els, ["b", "c", "d"])?.id).toBe("G");
    expect(selectedGroup(els, ["c", "d"])?.id).toBe("H");
    expect(selectedGroup(els, ["c"])).toBeNull();
    expect(selectedGroup(els, ["a", "b", "c", "d"])).toBeNull();
  });

  it("selectedGroups lists every group whose leaves equal the selection, outermost first", () => {
    // [O: [I: x, y]] — O wraps only I.
    const els = [r("x", "I"), r("y", "I"), g("I", "O"), g("O"), r("z")];
    expect(selectedGroups(els, ["x", "y"]).map((e) => e.id)).toEqual(["O", "I"]);
    expect(selectedGroups(sample(), ["c", "d"]).map((e) => e.id)).toEqual(["H"]);
    expect(selectedGroups(sample(), ["c"])).toEqual([]);
  });
});

describe("tree edits", () => {
  it("group nests a selection inside its common parent", () => {
    const { els, id } = groupIds(sample(), ["c", "b"], "N");
    expect(id).toBe("N");
    const n = els.find((e) => e.id === "N")!;
    expect(n.groupId).toBe("G");
    expect(els.find((e) => e.id === "b")!.groupId).toBe("N");
    // c alone is selected, not all of H, so c moves out of H into N.
    expect(els.find((e) => e.id === "c")!.groupId).toBe("N");
    expect(normalizeTree(els)).toBe(els);
  });

  it("group of a whole group's leaves wraps the group block", () => {
    const { els } = groupIds(sample(), ["c", "d", "e"], "N");
    expect(els.find((e) => e.id === "H")!.groupId).toBe("N");
    expect(els.find((e) => e.id === "e")!.groupId).toBe("N");
  });

  it("ungroup removes one level only", () => {
    const els = ungroupIds(sample(), ["b", "c", "d"]);
    expect(els.find((e) => e.id === "G")).toBeUndefined();
    expect(els.find((e) => e.id === "H")!.groupId).toBeNull();
    expect(els.find((e) => e.id === "c")!.groupId).toBe("H");
    expect(els.find((e) => e.id === "b")!.groupId).toBeNull();
    expect(ids(els)).toEqual(["a", "b", "c", "d", "H", "e"]);
  });

  it("reorder moves whole group block", () => {
    expect(ids(reorderTree(sample(), ["b", "c", "d"], "down"))).toEqual(["b", "c", "d", "H", "G", "a", "e"]);
    expect(ids(reorderTree(sample(), ["b", "c", "d"], "top"))).toEqual(["a", "e", "b", "c", "d", "H", "G"]);
    expect(ids(reorderTree(sample(), ["e"], "down"))).toEqual(["a", "e", "b", "c", "d", "H", "G"]);
  });

  it("reorder within a group stays inside the group", () => {
    expect(ids(reorderTree(sample(), ["b"], "top"))).toEqual(["a", "c", "d", "H", "b", "G", "e"]);
    expect(ids(reorderTree(sample(), ["d"], "bottom"))).toEqual(["a", "b", "d", "c", "H", "G", "e"]);
  });

  it("reparent into group keeps tree valid", () => {
    const els = reparentTree(sample(), "a", "H", 1);
    expect(ids(els)).toEqual(["b", "c", "a", "d", "H", "G", "e"]);
    expect(els.find((e) => e.id === "a")!.groupId).toBe("H");
    expect(normalizeTree(els)).toBe(els);
  });

  it("reparent to the root and out of a group", () => {
    const els = reparentTree(sample(), "c", null, 3);
    expect(ids(els)).toEqual(["a", "b", "d", "H", "G", "e", "c"]);
  });

  it("reparent group into its own descendant is rejected", () => {
    const els = sample();
    expect(reparentTree(els, "G", "H", 0)).toBe(els);
    expect(reparentTree(els, "G", "G", 0)).toBe(els);
  });

  it("reparent preserves z among siblings", () => {
    const els = reparentTree(sample(), "H", null, 0);
    expect(ids(els)).toEqual(["c", "d", "H", "a", "b", "G", "e"]);
  });
});

describe("tree performance", () => {
  it("tidies 1000 layers in nested groups quickly", async () => {
    const { tidyTree } = await import("@/lib/tree");
    const els: Element[] = [];
    for (let g = 0; g < 50; g++) {
      for (let i = 0; i < 19; i++) els.push(r(`e${g}-${i}`, i < 10 ? `in${g}` : `out${g}`, i));
      els.splice(els.length - 9, 0, g === 0 ? g_("in0", "out0") : g_(`in${g}`, `out${g}`));
      els.push(g_(`out${g}`));
    }
    expect(els.length).toBe(1050);
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) tidyTree(els.map((e) => ({ ...e })));
    expect((performance.now() - t0) / 10).toBeLessThan(30);
    expect(normalizeTree(els)).toBe(els);
  });
});
function g_(id: string, groupId: string | null = null) {
  return groupEl({ id, groupId });
}

/** A leaf inside `depth` nested groups: [leaf, g1, g2, …], g{depth} at the page. */
function chain(depth: number): Element[] {
  const els: Element[] = [r("leaf", "g1")];
  for (let i = 1; i <= depth; i++) els.push(g_(`g${i}`, i < depth ? `g${i + 1}` : null));
  return els;
}

describe("deep nesting", () => {
  it("survives a 10000-deep chain (depth is capped, nothing overflows)", () => {
    const els = chain(10000);
    const tidy = tidyTree(els);
    // The levels cut loose hold no leaf, so they are dropped as empty groups.
    expect(tidy.length).toBeLessThanOrEqual(MAX_DEPTH + 2);
    expect(tidy[0].id).toBe("leaf");
    expect(buildRenderTree(els).length).toBeGreaterThan(0);
    expect(effectiveFlags(els).size).toBe(els.length);
    expect(leafIds(els, ["g10000"]).length).toBeLessThanOrEqual(1);
    expect(parentChain(els, "leaf").length).toBeLessThanOrEqual(MAX_DEPTH);
    expect(parentChain(tidy, "leaf").length).toBeLessThanOrEqual(MAX_DEPTH);
    expect(expandToLeaves(els, ["leaf"])).toEqual(["leaf"]);
    expect(selectedGroup(els, ["leaf"])).not.toBeNull();
    expect(descendants(els, "g1").map((e) => e.id)).toEqual(["leaf"]);
    expect(coveredElements(els, ["leaf"]).length).toBeGreaterThan(0);
    expect(() => reorderTree(els, ["leaf"], "up")).not.toThrow();
    expect(() => reparentTree(els, "leaf", null, 0)).not.toThrow();
    expect(() => groupIds(els, ["leaf"], "N")).not.toThrow();
    expect(() => ungroupIds(els, ["leaf"])).not.toThrow();
  });

  it("nesting deeper than MAX_DEPTH is cut: the levels past it start at the page", () => {
    const out = normalizeTree(chain(MAX_DEPTH + 5));
    const tree = buildRenderTree(out);
    let depth = 0;
    for (let n = tree.find((t) => t.children); n?.children?.length; n = n.children.find((c) => c.children)) depth++;
    expect(depth).toBeLessThanOrEqual(MAX_DEPTH + 1);
  });
});

describe("tree performance at 5000 layers", () => {
  // 1000 groups of 4 leaves, each group inside a 2-deep wrapper chain.
  function big(): Element[] {
    const els: Element[] = [];
    for (let k = 0; k < 1000; k++) {
      for (let i = 0; i < 4; i++) els.push(r(`l${k}-${i}`, `a${k}`, i));
      els.push(g_(`a${k}`, `b${k}`), g_(`b${k}`));
    }
    return els;
  }
  const time = (f: () => unknown) => {
    const t0 = performance.now();
    f();
    return performance.now() - t0;
  };

  it("selection and edits over every layer stay fast", () => {
    const els = big();
    const leaves = els.filter((e) => e.type !== "group").map((e) => e.id);
    const deep = chain(5000);
    time(() => expandToLeaves(els, leaves)); // warm up
    expect(time(() => expandToLeaves(els, leaves))).toBeLessThan(50);
    expect(time(() => selectedGroup(els, leaves.slice(0, 4)))).toBeLessThan(50);
    expect(time(() => groupIds(els, leaves, "N"))).toBeLessThan(50);
    expect(time(() => coveredElements(els, leaves))).toBeLessThan(50);
    expect(time(() => reorderTree(els, leaves.slice(0, 2), "up"))).toBeLessThan(50);
    expect(time(() => effectiveFlags(deep))).toBeLessThan(50);
    expect(time(() => expandToLeaves(deep, ["leaf"]))).toBeLessThan(50);
    expect(time(() => groupIds(deep, ["leaf", "g3"], "N"))).toBeLessThan(50);
  });
});

describe("reorder no-op", () => {
  it("returns the same array when nothing moves", () => {
    const els = sample();
    expect(reorderTree(els, ["e"], "up")).toBe(els);
    expect(reorderTree(els, ["a"], "bottom")).toBe(els);
  });
});
