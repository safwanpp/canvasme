// @vitest-environment jsdom
import Konva from "konva";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effects } from "@/lib/effects";
import type { Element } from "@/lib/model";
import { elementNodes } from "@/lib/render";
import { fxCache } from "@/lib/fx/cache";
import { provideKonva } from "@/lib/fx/fxShape";
import { drawBlended } from "@/lib/fx/readback";
import { useView } from "@/store/view";
import { rectEl } from "../fixtures/design";

vi.mock("@/lib/images", () => ({ loadAssetImage: async () => null, getReadyImage: () => undefined }));
vi.mock("@/lib/fonts", () => ({ ensureFonts: async () => {} }));

provideKonva(Konva);

const shadowed = (p?: Partial<Element>) =>
  rectEl({
    width: 40,
    height: 40,
    effects: Effects.parse({ dropShadow: [{ color: "#000000", angle: 90, distance: 10, size: 4 }] }),
    ...(p as object),
  });

/** Run an editor fx shape's sceneFunc on a canvas at `scale`. */
function draw(el: Element, scale: number, layer = { batchDraw: vi.fn() }) {
  const attrs = elementNodes(el, null, { live: true })[0].attrs as {
    sceneFunc: (k: unknown, s: unknown) => void;
  };
  const c = document.createElement("canvas");
  c.width = 400;
  c.height = 400;
  const ctx = c.getContext("2d")!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  attrs.sceneFunc({ _context: ctx }, { getLayer: () => layer });
  return layer;
}

beforeEach(() => {
  fxCache.clear();
  vi.useFakeTimers();
  useView.getState().set({ transforming: [] });
});
afterEach(() => vi.useRealTimers());

describe("editor fx renders", () => {
  it("first draw renders at once", () => {
    const el = shadowed();
    draw(el, 1);
    expect(fxCache.getStale(el.id)?.ratio).toBe(1);
  });

  it("a zoom keeps drawing the old render and re-renders later", () => {
    const el = shadowed();
    draw(el, 1);
    const layer = draw(el, 2);
    expect(fxCache.getStale(el.id)?.ratio).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(fxCache.getStale(el.id)?.ratio).toBe(2);
    expect(layer.batchDraw).toHaveBeenCalled();
  });

  it("an element being transformed stretches its last render until the transform ends", () => {
    const el = shadowed();
    draw(el, 1);
    useView.getState().set({ transforming: [el.id] });
    const wider = { ...el, width: 80 };
    draw(wider, 1);
    vi.advanceTimersByTime(1000);
    expect(fxCache.getStale(el.id)?.w).toBe(40);
    useView.getState().set({ transforming: [] });
    draw(wider, 1);
    vi.advanceTimersByTime(1000);
    expect(fxCache.getStale(el.id)?.w).toBe(80);
  });

  it("another element's transform doesn't hold this one back", () => {
    const el = shadowed();
    draw(el, 1);
    useView.getState().set({ transforming: ["someone-else"] });
    draw({ ...el, width: 80 }, 1);
    vi.advanceTimersByTime(1000);
    expect(fxCache.getStale(el.id)?.w).toBe(80);
  });
});

describe("readback scratch canvases", () => {
  it("are reused between draws", () => {
    const c = document.createElement("canvas");
    c.width = c.height = 50;
    const ctx = c.getContext("2d")!;
    const src = document.createElement("canvas");
    src.width = src.height = 20;
    drawBlended(ctx, src, 0, 0, 20, 20, "linear-burn");
    const spy = vi.spyOn(document, "createElement");
    drawBlended(ctx, src, 0, 0, 20, 20, "linear-burn");
    expect(spy.mock.calls.filter(([t]) => t === "canvas")).toHaveLength(0);
    spy.mockRestore();
  });
});
