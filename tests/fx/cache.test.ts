import { describe, expect, it } from "vitest";
import { FxCache, fxKey } from "@/lib/fx/cache";
import { groupEl, rectEl } from "../fixtures/design";

const v = (pixels: number) => ({ pixels });

describe("fx cache", () => {
  it("key ignores x/y/rotation/opacity", () => {
    const a = rectEl({ id: "a" });
    const b = { ...a, id: "b", x: 50, y: 60, rotation: 30, opacity: 0.4, locked: true, name: "n", hidden: true, groupId: "g" };
    expect(fxKey(a, 1, 0)).toBe(fxKey(b, 1, 0));
  });

  it("key ignores a group's collapsed flag", () => {
    const g = groupEl({ id: "g" });
    expect(fxKey(g, 1, 0)).toBe(fxKey({ ...g, collapsed: true }, 1, 0));
  });

  it("key changes with width and with effects", () => {
    const a = rectEl();
    expect(fxKey(a, 1, 0)).not.toBe(fxKey({ ...a, width: 101 }, 1, 0));
    expect(fxKey(a, 1, 0)).not.toBe(fxKey({ ...a, effects: { colorOverlay: [{ color: "#000", enabled: true, blendMode: "normal", opacity: 1 }] } }, 1, 0));
    expect(fxKey(a, 1, 0)).not.toBe(fxKey(a, 2, 0));
    expect(fxKey(a, 1, 0)).not.toBe(fxKey(a, 1, 1));
  });

  it("LRU evicts oldest past capacity", () => {
    const c = new FxCache<{ pixels: number }>(2, 1e9);
    c.set("k1", "a", v(1));
    c.set("k2", "b", v(1));
    c.get("k1"); // k1 is now the most recent
    c.set("k3", "c", v(1));
    expect(c.get("k2")).toBeUndefined();
    expect(c.get("k1")).toBeDefined();
    expect(c.get("k3")).toBeDefined();
  });

  it("pixel budget evicts", () => {
    const c = new FxCache<{ pixels: number }>(10, 100);
    c.set("k1", "a", v(60));
    c.set("k2", "b", v(60));
    expect(c.get("k1")).toBeUndefined();
    expect(c.get("k2")).toBeDefined();
  });

  it("getStale returns last by id", () => {
    const c = new FxCache<{ pixels: number }>(10, 1e9);
    const first = v(1);
    const second = v(2);
    c.set("k1", "a", first);
    c.set("k2", "a", second);
    expect(c.getStale("a")).toBe(second);
    expect(c.getStale("zz")).toBeUndefined();
    c.clear();
    expect(c.getStale("a")).toBeUndefined();
  });
});

describe("fx cache bookkeeping", () => {
  it("a hit makes that key the element's last render", () => {
    const c = new FxCache<{ pixels: number }>(10, 1e9);
    const first = v(1);
    c.set("k1", "a", first);
    c.set("k2", "a", v(2));
    expect(c.get("k1", "a")).toBe(first);
    expect(c.getStale("a")).toBe(first);
  });

  it("evicted, replaced and cleared values are released", () => {
    const released: number[] = [];
    const c = new FxCache<{ pixels: number }>(1, 1e9, (val) => released.push(val.pixels));
    c.set("k1", "a", v(1));
    c.set("k2", "b", v(2));
    expect(released).toEqual([1]);
    c.set("k2", "b", v(3));
    expect(released).toEqual([1, 2]);
    c.clear();
    expect(released).toEqual([1, 2, 3]);
  });

  it("the shared cache budget is modest", async () => {
    const { FX_CACHE_BUDGET } = await import("@/lib/fx/cache");
    expect(FX_CACHE_BUDGET).toBeLessThanOrEqual(64_000_000);
  });
});
