import type { Paint } from "./effects";
import type { FillRule, PathOp, Subpath, VectorElement, VectorMask } from "./model";
import { sampleGradient } from "./fx/gradient";
import { makeCanvas, toCanvas } from "./fx/raster";
import { DEFAULT_MITER_LIMIT, pathComponents, traceSubpaths } from "./vector";

// Drawing vector elements and vector masks onto a canvas in the element's local units.
//
// A shape made of one component with a solid fill and a centred solid stroke is drawn straight
// onto the target. Anything else (path operations, gradients, inside/outside strokes, masks
// that aren't a plain clip) is drawn into an off-screen canvas at the target's scale: the
// shape's alpha first (each component composited onto the ones below with its operation), then
// the paint laid over it with "source-in".

type Ctx = CanvasRenderingContext2D;

const OP_COMPOSITE: Record<PathOp, GlobalCompositeOperation> = {
  combine: "source-over",
  subtract: "destination-out",
  intersect: "destination-in",
  exclude: "xor",
};

const MAX_SIDE = 4096;
const MAX_PIXELS = 6_000_000;

/** Room left for miter tips, in stroke sides: sharper tips than this are cut off by the drawing's padding. */
const MAX_MITER_REACH = 10;

/** How far a vector's stroke can reach past its path, in local units (miter joins included). */
export function strokeReach(v: Pick<VectorElement, "stroke" | "strokeWidth" | "strokeAlign" | "lineJoin" | "miterLimit">, joins = true): number {
  if (!v.stroke || !(v.strokeWidth > 0)) return 0;
  const side = v.strokeAlign === "inside" ? 0 : v.strokeAlign === "outside" ? v.strokeWidth : v.strokeWidth / 2;
  // A miter tip reaches up to miterLimit × the stroke's side; allow for it where drawing needs room.
  const limit = Math.max(1, Math.min(MAX_MITER_REACH, v.miterLimit ?? DEFAULT_MITER_LIMIT));
  return joins && (v.lineJoin ?? "miter") === "miter" ? side * limit : side;
}

/** Device pixels per local unit the context draws at, rounded up to a step of √2 (fewer re-renders on zoom). */
function deviceRatio(ctx: Ctx) {
  const m = ctx.getTransform();
  const s = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
  const safe = s > 0 && Number.isFinite(s) ? s : 1;
  return 2 ** (Math.ceil(2 * Math.log2(safe) - 1e-9) / 2);
}

/** An off-screen canvas for a w×h local box with `pad` around it, its context mapping local units. */
function offscreen(w: number, h: number, pad: number, want: number) {
  const ratio = cappedRatio(w, h, pad, want);
  const c = makeCanvas(Math.max(1, Math.ceil((w + 2 * pad) * ratio)), Math.max(1, Math.ceil((h + 2 * pad) * ratio)));
  const cx = c.getContext("2d")!;
  cx.setTransform(ratio, 0, 0, ratio, pad * ratio, pad * ratio);
  return { c, cx, ratio, pad };
}
type Off = ReturnType<typeof offscreen>;

/** The combined shape of `subpaths` as opaque alpha on `cx` (which must start empty). */
export function fillShapeAlpha(cx: Ctx, subpaths: Subpath[], rule: FillRule) {
  cx.save();
  cx.fillStyle = "#000000";
  for (const comp of pathComponents(subpaths)) {
    cx.globalCompositeOperation = OP_COMPOSITE[comp.op];
    cx.beginPath();
    traceSubpaths(cx, comp.paths);
    cx.fill(rule);
  }
  cx.restore();
}

/** Lay `paint` over what is already on `o` (source-in), over the element box w×h. */
function applyPaint(o: Off, paint: Paint, w: number, h: number) {
  const { cx, c, ratio, pad } = o;
  cx.save();
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.globalCompositeOperation = "source-in";
  if (paint.type === "color") {
    cx.fillStyle = paint.color;
    cx.fillRect(0, 0, c.width, c.height);
  } else {
    const g = sampleGradient(paint.gradient, { w, h }, c.width, c.height, { x: pad * ratio, y: pad * ratio }, ratio);
    const gc = toCanvas(g);
    cx.drawImage(gc, 0, 0);
    gc.width = gc.height = 0;
  }
  cx.restore();
}

function strokeStyle(cx: Ctx, v: VectorElement, width: number) {
  cx.lineWidth = width;
  cx.lineCap = v.lineCap ?? "butt";
  cx.lineJoin = v.lineJoin ?? "miter";
  cx.miterLimit = v.miterLimit ?? DEFAULT_MITER_LIMIT;
  // Dashes are in stroke widths (the visible width, also for inside/outside drawn at twice it).
  cx.setLineDash(v.dash?.length ? v.dash.map((d) => d * v.strokeWidth) : []);
}

const isSimple = (v: VectorElement) =>
  pathComponents(v.subpaths).length === 1 &&
  (!v.fill || v.fill.type === "color") &&
  (!v.stroke || !(v.strokeWidth > 0) || (v.stroke.type === "color" && (v.strokeAlign ?? "center") === "center"));

/** The fill and stroke layers of a vector, off-screen at `want` px per unit. */
function renderLayers(v: VectorElement, want: number) {
  const w = v.width;
  const h = v.height;
  const pad = strokeReach(v) + 2;
  const rule = v.fillRule ?? "nonzero";
  const alpha = offscreen(w, h, pad, want);
  fillShapeAlpha(alpha.cx, v.subpaths, rule);
  let fill: Off | null = null;
  if (v.fill) {
    fill = offscreen(w, h, pad, want);
    fill.cx.save();
    fill.cx.setTransform(1, 0, 0, 1, 0, 0);
    fill.cx.drawImage(alpha.c, 0, 0);
    fill.cx.restore();
    applyPaint(fill, v.fill, w, h);
  }
  let stroke: Off | null = null;
  if (v.stroke && v.strokeWidth > 0) {
    stroke = offscreen(w, h, pad, want);
    const align = v.strokeAlign ?? "center";
    strokeStyle(stroke.cx, v, align === "center" ? v.strokeWidth : v.strokeWidth * 2);
    stroke.cx.beginPath();
    traceSubpaths(stroke.cx, v.subpaths);
    stroke.cx.strokeStyle = "#000000";
    stroke.cx.stroke();
    if (align !== "center") {
      stroke.cx.save();
      stroke.cx.setTransform(1, 0, 0, 1, 0, 0);
      stroke.cx.globalCompositeOperation = align === "inside" ? "destination-in" : "destination-out";
      stroke.cx.drawImage(alpha.c, 0, 0);
      stroke.cx.restore();
    }
    applyPaint(stroke, v.stroke, w, h);
  }
  alpha.c.width = alpha.c.height = 0;
  return { fill, stroke, ratio: alpha.ratio, pad };
}

// Off-screen renders of vectors and vector-masked content, shared by every draw of the same
// content: edits clone the whole design, so a per-element-object cache would start empty after
// each one. Keyed by a hash of what the pixels depend on plus the device ratio; bounded by entry
// count and device pixels, freeing canvases it lets go of (like fx/cache.ts).

/** Entries the vector render cache keeps at most. */
export const VECTOR_CACHE_ENTRIES = 96;
const VECTOR_CACHE_PIXELS = 24_000_000;

type CacheEntry = { canvases: HTMLCanvasElement[]; pixels: number };

class RenderCache<V extends CacheEntry> {
  private map = new Map<string, V>();
  private pixels = 0;

  constructor(
    private capacity: number,
    private budget: number,
  ) {}

  get size() {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: V) {
    const old = this.map.get(key);
    if (old) this.drop(key, old);
    this.map.set(key, value);
    this.pixels += value.pixels;
    for (const [k, e] of this.map) {
      if (this.map.size <= this.capacity && this.pixels <= this.budget) break;
      if (k !== key) this.drop(k, e);
    }
  }

  /** Every canvas held (for tests). */
  canvases() {
    return [...this.map.values()].flatMap((e) => e.canvases);
  }

  clear() {
    for (const [k, e] of [...this.map]) this.drop(k, e);
  }

  private drop(key: string, e: V) {
    this.map.delete(key);
    this.pixels -= e.pixels;
    for (const c of e.canvases) c.width = c.height = 0;
  }
}

/** Vector renders (fill and stroke layers) and masked-content renders. */
export const vectorRenderCache = new RenderCache<CacheEntry & { draw: (ctx: Ctx) => void }>(VECTOR_CACHE_ENTRIES, VECTOR_CACHE_PIXELS);

function hash32(s: string, seed: number) {
  let h = seed;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const contentKeys = new WeakMap<object, string>();

/** A short, collision-safe enough key for `parts` of `owner` (computed once per owner object). */
export function contentKey(owner: object, parts: () => unknown): string {
  let k = contentKeys.get(owner);
  if (k === undefined) {
    const s = JSON.stringify(parts());
    k = `${hash32(s, 2166136261)}${hash32(s, 0x9747b28c)}${s.length.toString(36)}`;
    contentKeys.set(owner, k);
  }
  return k;
}

const vectorKey = (v: VectorElement) =>
  contentKey(v, () => {
    const { subpaths, fillRule, fill, stroke, strokeWidth, strokeAlign, lineCap, lineJoin, dash, miterLimit, width, height } = v;
    return ["v", subpaths, fillRule, fill, stroke, strokeWidth, strokeAlign, lineCap, lineJoin, dash, miterLimit, width, height];
  });

/** Draw a cached render (made by `make` on a miss) for `key` at the context's device ratio. */
export function drawCached(ctx: Ctx, key: string, make: (want: number) => CacheEntry & { draw: (ctx: Ctx) => void }) {
  const want = deviceRatio(ctx);
  const k = `${key}|${want}`;
  let e = vectorRenderCache.get(k);
  if (!e) {
    e = make(want);
    vectorRenderCache.set(k, e);
  }
  e.draw(ctx);
}

/**
 * A draw function for a vector element in its local units. Its off-screen render is cached per
 * content and scale, so redrawing an unchanged element costs one drawImage per layer.
 */
export function vectorDrawer(v: VectorElement): (ctx: Ctx) => void {
  return (ctx: Ctx) => {
    if (!v.subpaths?.length) return;
    if (isSimple(v)) {
      ctx.save();
      ctx.beginPath();
      traceSubpaths(ctx, v.subpaths);
      if (v.fill?.type === "color") {
        ctx.fillStyle = v.fill.color;
        ctx.fill(v.fillRule ?? "nonzero");
      }
      if (v.stroke?.type === "color" && v.strokeWidth > 0) {
        strokeStyle(ctx, v, v.strokeWidth);
        ctx.strokeStyle = v.stroke.color;
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    drawCached(ctx, vectorKey(v), (want) => {
      const { fill, stroke, ratio, pad } = renderLayers(v, want);
      const canvases = [fill, stroke].filter((o): o is Off => !!o).map((o) => o.c);
      return {
        canvases,
        pixels: canvases.reduce((n, c) => n + c.width * c.height, 0),
        draw: (cx: Ctx) => {
          for (const c of canvases) if (c.width) cx.drawImage(c, -pad, -pad, c.width / ratio, c.height / ratio);
        },
      };
    });
  };
}

/** A plain clip does the mask: one component, not inverted. */
export const maskIsClip = (m: VectorMask) => !m.invert && pathComponents(m.subpaths).length === 1;

/** Clip `ctx` to a mask that `maskIsClip`. */
export function clipToMask(ctx: Ctx, m: VectorMask) {
  ctx.beginPath();
  traceSubpaths(ctx, m.subpaths);
  ctx.clip(m.fillRule ?? "nonzero");
}

/**
 * Keep only the masked part of `content` (an off-screen canvas of a w×h box with `pad` around
 * it, at `ratio` px per unit), in place.
 */
export function maskCanvas(content: HTMLCanvasElement, m: VectorMask, pad: number, ratio: number) {
  const mc = makeCanvas(content.width, content.height);
  const mx = mc.getContext("2d")!;
  mx.setTransform(ratio, 0, 0, ratio, pad * ratio, pad * ratio);
  fillShapeAlpha(mx, m.subpaths, m.fillRule ?? "nonzero");
  const cx = content.getContext("2d")!;
  cx.save();
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.globalCompositeOperation = m.invert ? "destination-out" : "destination-in";
  cx.drawImage(mc, 0, 0);
  cx.restore();
  mc.width = mc.height = 0;
}

/** The ratio actually used for a w×h box with `pad` around it (capped for memory). */
export function cappedRatio(w: number, h: number, pad: number, want: number) {
  const W = Math.max(1e-3, w + 2 * pad);
  const H = Math.max(1e-3, h + 2 * pad);
  return Math.max(1e-3, Math.min(want, MAX_SIDE / W, MAX_SIDE / H, Math.sqrt(MAX_PIXELS / (W * H))));
}

/** The whole device pixels a local w×h box (plus a pixel) covers under ctx's transform, within its canvas. */
function deviceRect(ctx: Ctx, w: number, h: number) {
  const T = ctx.getTransform();
  const pts = [[0, 0], [w, 0], [0, h], [w, h]];
  const xs = pts.map(([x, y]) => T.a * x + T.c * y + T.e);
  const ys = pts.map(([x, y]) => T.b * x + T.d * y + T.f);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1);
  const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs)) + 1);
  const y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys)) + 1);
  return x1 > x0 && y1 > y0 ? { x0, y0, w: x1 - x0, h: y1 - y0 } : null;
}

// One scratch canvas for compound hit areas (hit draws don't nest), grown as needed, cleared per use.
let scratch: HTMLCanvasElement | null = null;
const SCRATCH_KEEP_PIXELS = 4_000_000;

function hitScratch(w: number, h: number) {
  if (!scratch || scratch.width < w || scratch.height < h) {
    const W = Math.max(w, scratch?.width ?? 0);
    const H = Math.max(h, scratch?.height ?? 0);
    if (scratch) scratch.width = scratch.height = 0;
    scratch = makeCanvas(W, H);
  }
  const cx = scratch.getContext("2d")!;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.globalCompositeOperation = "source-over";
  cx.clearRect(0, 0, w, h);
  return scratch;
}

/** Let a huge scratch go once used, so a one-off big hit area doesn't keep its memory. */
function trimScratch() {
  if (scratch && scratch.width * scratch.height > SCRATCH_KEEP_PIXELS) {
    scratch.width = scratch.height = 0;
    scratch = null;
  }
}

/**
 * Draw the hit area of a vector: its fill region (path operations included), and its stroke, or
 * a wide stroke when it has no fill.
 */
export function hitVector(ctx: Ctx, v: VectorElement, color: string) {
  if (v.fill) {
    if (pathComponents(v.subpaths).length === 1) {
      ctx.beginPath();
      traceSubpaths(ctx, v.subpaths);
      ctx.fillStyle = color;
      ctx.fill(v.fillRule ?? "nonzero");
    } else {
      // Path operations need compositing, which would erase other layers' hits: do it off-screen,
      // over the device pixels of the element's box only.
      const r = deviceRect(ctx, v.width, v.height);
      if (r) {
        const { x0, y0, w, h } = r;
        const c = hitScratch(w, h);
        const cx = c.getContext("2d")!;
        const m = ctx.getTransform();
        cx.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
        fillShapeAlpha(cx, v.subpaths, v.fillRule ?? "nonzero");
        cx.setTransform(1, 0, 0, 1, 0, 0);
        cx.globalCompositeOperation = "source-in";
        cx.fillStyle = color;
        cx.fillRect(0, 0, w, h);
        cx.globalCompositeOperation = "source-over";
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(c, 0, 0, w, h, x0, y0, w, h);
        ctx.restore();
        trimScratch();
      }
    }
  }
  if (!v.fill || (v.stroke && v.strokeWidth > 0)) {
    ctx.beginPath();
    traceSubpaths(ctx, v.subpaths);
    ctx.lineWidth = Math.max(v.fill ? 1 : 10, (v.strokeWidth ?? 0) * ((v.strokeAlign ?? "center") === "center" ? 1 : 2));
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}

/**
 * Clip a hit area to a vector mask: the mask's outline, or for an inverted or compound one the
 * outline traced inside the box with even-odd (exact for simple masks, close enough for hits).
 */
export function clipHitToMask(ctx: Ctx, m: VectorMask, w: number, h: number) {
  ctx.beginPath();
  if (m.invert) ctx.rect(-1e5, -1e5, 2e5 + w, 2e5 + h);
  traceSubpaths(ctx, m.subpaths);
  ctx.clip(m.invert ? "evenodd" : (m.fillRule ?? "nonzero"));
}
