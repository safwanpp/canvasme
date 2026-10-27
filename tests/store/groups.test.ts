// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { Element } from "@/lib/model";
import { currentPage, useEditor } from "@/store/editor";
import { groupEl, makeDesign, rectEl } from "../fixtures/design";

const r = (id: string, groupId: string | null = null, x = 0) => rectEl({ id, groupId, x, y: 0, width: 10, height: 10 });
const page = () => currentPage(useEditor.getState())!.elements;
const ids = (els: Element[]) => els.map((e) => e.id);
const st = () => useEditor.getState();

beforeEach(() => {
  // a, [G: b, [H: c, d]], e
  st().load({ ...makeDesign([r("a"), r("b", "G", 20), r("c", "H", 40), r("d", "H", 60), groupEl({ id: "H", groupId: "G" }), groupEl({ id: "G" }), r("e")]), version: 3 });
});

describe("store groups", () => {
  it("load syncs group bounds", () => {
    expect(page().find((e) => e.id === "G")).toMatchObject({ x: 20, width: 50 });
  });

  it("nested group selection expands to all leaves of outermost", () => {
    st().select(["c"]);
    expect(st().selected).toEqual(["b", "c", "d"]);
    st().select(["c"], false, true);
    expect(st().selected).toEqual(["c"]);
    st().select(["H"], false, true);
    expect(st().selected).toEqual(["c", "d"]);
  });

  it("group then ungroup, with undo and redo", () => {
    st().group(["a", "e"]);
    const g = page().find((e) => e.type === "group" && e.id !== "G" && e.id !== "H")!;
    expect(page().filter((e) => e.groupId === g.id).map((e) => e.id)).toEqual(["a", "e"]);
    expect(ids(page())).toEqual(["b", "c", "d", "H", "G", "a", "e", g.id]);
    expect(page().find((e) => e.id === "a")!.groupId).toBe(g.id);
    st().ungroup(["a", "e"]);
    expect(page().find((e) => e.id === g.id)).toBeUndefined();
    st().undo();
    expect(page().find((e) => e.id === g.id)).toBeTruthy();
    st().undo();
    expect(page().find((e) => e.id === g.id)).toBeUndefined();
    st().redo();
    expect(page().find((e) => e.id === "a")!.groupId).toBe(g.id);
  });

  it("removing every leaf of a group removes the group", () => {
    st().remove(["c", "d"]);
    expect(ids(page())).toEqual(["a", "b", "G", "e"]);
  });

  it("duplicate group copies group element with new ids and remapped children", () => {
    st().duplicate(["b", "c", "d"]);
    const els = page();
    expect(els).toHaveLength(12);
    const copies = els.slice(7);
    expect(copies.map((e) => e.type)).toEqual(["shape", "shape", "shape", "group", "group"]);
    const [b2, c2, d2, h2, g2] = copies;
    expect(g2.id).not.toBe("G");
    expect(g2.groupId).toBeNull();
    expect(b2.groupId).toBe(g2.id);
    expect(h2.groupId).toBe(g2.id);
    expect([c2.groupId, d2.groupId]).toEqual([h2.id, h2.id]);
    expect(st().selected).toEqual([b2.id, c2.id, d2.id]);
  });

  it("reorder moves whole group block", () => {
    st().reorder(["b", "c", "d"], "bottom");
    expect(ids(page())).toEqual(["b", "c", "d", "H", "G", "a", "e"]);
  });

  it("reparent through the store is one undo step", () => {
    st().reparent("a", "H", 0);
    expect(page().find((e) => e.id === "a")!.groupId).toBe("H");
    st().undo();
    expect(page().find((e) => e.id === "a")!.groupId).toBeNull();
  });

  it("a locked group's leaves aren't removed", () => {
    st().update(["G"], { locked: true });
    st().remove(["b"]);
    expect(page().find((e) => e.id === "b")).toBeTruthy();
  });

  it("moving a member re-syncs the group box", () => {
    st().update(["b"], { x: 0 });
    expect(page().find((e) => e.id === "G")).toMatchObject({ x: 0, width: 70 });
  });
});

describe("locks through groups", () => {
  const lockG = () => st().update(["G"], { locked: true });
  const el = (id: string) => page().find((e) => e.id === id)!;

  it("reorder, group and ungroup leave members of a locked group alone", () => {
    lockG();
    const before = page();
    st().reorder(["c"], "down");
    st().group(["c", "d"]);
    st().ungroup(["c", "d"]);
    expect(page()).toBe(before);
  });

  it("reparent refuses moving into, out of or inside a locked group", () => {
    lockG();
    const before = page();
    st().reparent("a", "G", 0);
    st().reparent("c", null, 0);
    st().reparent("b", "H", 0);
    expect(page()).toBe(before);
    st().reparent("a", null, 2); // loose layers still move
    expect(page()).not.toBe(before);
  });

  it("paste of a member of a locked group lands at the page", () => {
    lockG();
    const known = new Set(ids(page()));
    st().paste([el("c")]);
    const copy = page().find((e) => !known.has(e.id))!;
    expect(copy.groupId).toBeNull();
  });

  it("clip to shape and release honor a locked parent", async () => {
    const { imageEl } = await import("../fixtures/design");
    st().load({
      ...makeDesign([imageEl({ id: "img", groupId: "G" }), rectEl({ id: "s", groupId: "G" }), groupEl({ id: "G", locked: true })]),
      version: 3,
    });
    st().clipToShape("img", "s");
    expect(ids(page())).toEqual(["img", "s", "G"]);
    expect(page()[0]).not.toHaveProperty("mask");
  });
});

describe("history details", () => {
  it("reorder that changes nothing adds no undo step", () => {
    const past = st().past.length;
    st().reorder(["e"], "up");
    expect(st().past.length).toBe(past);
  });

  it("undo keeps the current collapsed state of groups", () => {
    st().update(["a"], { x: 100 });
    st().update(["G"], { collapsed: true }, { history: false });
    st().undo();
    expect(page().find((e) => e.id === "a")!.x).toBe(0);
    expect(page().find((e) => e.id === "G")).toMatchObject({ collapsed: true });
    st().update(["G"], { collapsed: undefined }, { history: false });
    st().redo();
    expect(page().find((e) => e.id === "a")!.x).toBe(100);
    expect(page().find((e) => e.id === "G")!.type === "group" && (page().find((e) => e.id === "G") as { collapsed?: boolean }).collapsed).toBeFalsy();
  });
});
