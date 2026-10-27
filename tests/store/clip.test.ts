// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { Element } from "@/lib/model";
import { clipBase } from "@/lib/tree";
import { currentPage, useEditor } from "@/store/editor";
import { groupEl, makeDesign, rectEl, imageEl } from "../fixtures/design";

const r = (id: string, p?: Partial<Element>) => rectEl({ id, x: 0, y: 0, width: 10, height: 10, ...(p as object) });
const page = () => currentPage(useEditor.getState())!.elements;
const ids = (els: Element[]) => els.map((e) => e.id);
const clipped = () => page().filter((e) => e.clipped).map((e) => e.id);
const st = () => useEditor.getState();
const load = (els: Element[]) => st().load({ ...makeDesign(els), version: 3 });

describe("store clipping", () => {
  beforeEach(() => load([r("a"), r("b"), r("c"), r("d")]));

  it("clip to layer below and release, one undo step each", () => {
    st().clipToBelow(["c"]);
    expect(clipped()).toEqual(["c"]);
    expect(clipBase(page(), "c")).toBe("b");
    st().clipToBelow(["d"]);
    expect(clipped()).toEqual(["c", "d"]);
    st().releaseClip(["d"]);
    expect(clipped()).toEqual(["c"]);
    st().undo();
    expect(clipped()).toEqual(["c", "d"]);
    st().undo();
    st().undo();
    expect(clipped()).toEqual([]);
  });

  it("does nothing for the bottom layer (no empty undo step)", () => {
    st().clipToBelow(["a"]);
    expect(clipped()).toEqual([]);
    expect(st().past.length).toBe(0);
  });

  it("toggleClip clips, then releases", () => {
    st().toggleClip(["b", "c"]);
    expect(clipped()).toEqual(["c"]);
    st().toggleClip(["c"]);
    expect(clipped()).toEqual([]);
  });

  it("respects locks: a locked layer or one in a locked group isn't clipped or released", () => {
    load([r("a"), r("b", { locked: true }), r("c", { groupId: "G" }), r("x", { groupId: "G" }), groupEl({ id: "G", locked: true })]);
    st().clipToBelow(["b"]);
    st().clipToBelow(["x"]);
    expect(clipped()).toEqual([]);
    load([r("a"), r("b", { clipped: true, locked: true })]);
    st().releaseClip(["b"]);
    expect(clipped()).toEqual(["b"]);
  });

  it("reordering a base above its clipped layer breaks the stack", () => {
    load([r("a"), r("b", { clipped: true }), r("c")]);
    st().reorder(["a"], "up");
    // b is now at the bottom: nothing to clip to.
    expect(ids(page())).toEqual(["b", "a", "c"]);
    expect(clipped()).toEqual([]);
  });

  it("moving a clipped layer over another layer clips it to that one", () => {
    load([r("a"), r("b", { clipped: true }), r("c")]);
    st().reorder(["b"], "up");
    expect(ids(page())).toEqual(["a", "c", "b"]);
    expect(clipBase(page(), "b")).toBe("c");
  });

  it("deleting the base clips the stack to the next layer below, or releases it at the bottom", () => {
    load([r("a"), r("b"), r("c", { clipped: true })]);
    st().remove(["b"]);
    expect(clipBase(page(), "c")).toBe("a");
    st().remove(["a"]);
    expect(clipped()).toEqual([]);
  });

  it("grouping base and clipped keeps the stack; grouping a clipped layer alone releases it", () => {
    load([r("a"), r("b", { clipped: true }), r("c")]);
    st().group(["a", "b"]);
    const g = page().find((e) => e.type === "group")!;
    expect(clipBase(page(), "b")).toBe("a");
    expect(page().find((e) => e.id === "b")!.groupId).toBe(g.id);
    st().ungroup(["a", "b"]);
    expect(clipBase(page(), "b")).toBe("a");

    load([r("a"), r("b", { clipped: true }), r("x"), r("y")]);
    st().group(["b", "x"]);
    expect(clipped()).toEqual([]);
  });

  it("grouping the base alone makes the group the base", () => {
    load([r("a"), r("z"), r("b", { clipped: true })]);
    st().group(["a", "z"]);
    const g = page().find((e) => e.type === "group")!;
    expect(clipBase(page(), "b")).toBe(g.id);
  });

  it("image-to-shape masking keeps the shape's place in a stack, and release puts both back in it", () => {
    load([r("base"), rectEl({ id: "s", clipped: true }), imageEl({ id: "i" })]);
    st().clipToShape("i", "s");
    expect(ids(page())).toEqual(["base", "i"]);
    expect(clipBase(page(), "i")).toBe("base");
    st().releaseMask("i");
    expect(page().length).toBe(3);
    expect(clipped().length).toBe(2);
    expect(page().slice(1).every((e) => clipBase(page(), e.id) === "base")).toBe(true);
  });

  it("duplicate keeps the flag", () => {
    load([r("a"), r("b", { clipped: true })]);
    st().duplicate(["b"]);
    expect(page().filter((e) => e.clipped).length).toBe(2);
  });
});

describe("clip shortcut", () => {
  it("Alt/Option + Cmd/Ctrl + G, matched by the physical key", async () => {
    const { isClipShortcut } = await import("@/components/editor/actions");
    const ev = (p: KeyboardEventInit) => new KeyboardEvent("keydown", { code: "KeyG", key: "g", ...p });
    expect(isClipShortcut(ev({ key: "©", altKey: true, metaKey: true }))).toBe(true);
    expect(isClipShortcut(ev({ altKey: true, ctrlKey: true }))).toBe(true);
    expect(isClipShortcut(ev({ ctrlKey: true }))).toBe(false);
    expect(isClipShortcut(ev({ altKey: true }))).toBe(false);
    expect(isClipShortcut(ev({ altKey: true, ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});
