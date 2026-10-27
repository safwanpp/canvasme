import type { BlendMode } from "../effects";
import type { Element } from "../model";

// Rendered effects, keyed by everything that changes the pixels. Position, rotation and
// opacity are applied when drawing, so dragging or fading an element never re-renders it.

const IGNORED = new Set(["id", "x", "y", "rotation", "opacity", "locked", "name", "hidden", "groupId", "collapsed", "clipped"]);

// Elements are immutable in the store, so one stringify per element object is enough.
const keyBases = new WeakMap<Element, string>();

function keyBase(el: Element) {
  let k = keyBases.get(el);
  if (k === undefined) {
    k = JSON.stringify(Object.fromEntries(Object.entries(el).filter(([key]) => !IGNORED.has(key))));
    keyBases.set(el, k);
  }
  return k;
}

/** Cache key for an element's fx render at `ratio` device pixels per unit. */
export const fxKey = (el: Element, ratio: number, fontsVersion: number) => `${ratio}|${fontsVersion}|${keyBase(el)}`;

/** LRU capped by entry count and by total device pixels, with a by-id lookup of the last render. */
export class FxCache<V extends { pixels: number }> {
  private map = new Map<string, { id: string; value: V }>();
  private lastById = new Map<string, string>();
  private pixels = 0;

  constructor(
    private capacity: number,
    private budget: number,
    /** Frees a value's memory once the cache lets go of it. */
    private release: (value: V) => void = () => {},
  ) {}

  /** A cached render; with `id`, it also becomes that element's last render for getStale. */
  get(key: string, id?: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    if (id !== undefined) this.lastById.set(id, key);
    return hit.value;
  }

  set(key: string, id: string, value: V) {
    const old = this.map.get(key);
    if (old) {
      this.pixels -= old.value.pixels;
      this.map.delete(key);
      if (old.value !== value) this.release(old.value);
    }
    this.map.set(key, { id, value });
    this.pixels += value.pixels;
    this.lastById.set(id, key);
    for (const [k, e] of this.map) {
      if (this.map.size <= this.capacity && this.pixels <= this.budget) break;
      if (k === key) continue;
      this.map.delete(k);
      this.pixels -= e.value.pixels;
      if (this.lastById.get(e.id) === k) this.lastById.delete(e.id);
      this.release(e.value);
    }
  }

  /** The most recent render for an element id, whatever its key, if still cached. */
  getStale(id: string): V | undefined {
    const key = this.lastById.get(id);
    return key === undefined ? undefined : this.map.get(key)?.value;
  }

  clear() {
    for (const e of this.map.values()) this.release(e.value);
    this.map.clear();
    this.lastById.clear();
    this.pixels = 0;
  }
}

type Pad = { l: number; t: number; r: number; b: number };

/**
 * One fx render: canvases for the outer parts and the body, around the element box. The
 * outer parts may be at a lower resolution than the body, so each has its own padding and
 * ratio: a far shadow must not blur the element itself.
 */
export type FxEntry = {
  outer: { canvas: HTMLCanvasElement; blend: BlendMode; opacity: number }[];
  /** Padding (element units) and device pixels per unit of the outer canvases. */
  outerPad: Pad;
  outerRatio: number;
  body: HTMLCanvasElement;
  /** Padding around the element box in element units, and the element size it was made for. */
  pad: Pad;
  w: number;
  h: number;
  /** A text element's font size, so a stale render scales by it rather than by the box. */
  fontSize?: number;
  /** Device pixels per element unit the body was made at. */
  ratio: number;
  /** Device pixels the canvases hold, for the cache budget. */
  pixels: number;
};

/** A canvas's memory goes back to the browser once it is 0×0, not when it's collected. */
export function releaseEntry(e: FxEntry) {
  for (const c of [e.body, ...e.outer.map((p) => p.canvas)]) c.width = c.height = 0;
}

/** Device pixels all cached renders may hold together (about 190 MB of RGBA). */
export const FX_CACHE_BUDGET = 48_000_000;

export const fxCache = new FxCache<FxEntry>(64, FX_CACHE_BUDGET, releaseEntry);
