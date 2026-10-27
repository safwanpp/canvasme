import type Konva from "konva";
import type { AdjustmentElement } from "../model";
import { applyAdjustment } from "./adjust";
import { blendInto, type RGB } from "./blend";
import { fxGeneration } from "./fxShape";
import { makeCanvas } from "./raster";
import { deviceRect, drawWriteBack, readBackdrop, type DOMRectLike } from "./readback";

// An adjustment layer is one Konva Shape that draws nothing of its own: it reads what is already
// drawn under its box in the current context (the page so far; inside an isolated group or a
// clip stack, that group's or stack's off-screen canvas), adjusts a copy, mixes the two with its
// blend mode, and writes the result back over the box, scaled by its opacity and raster mask.
// The editor and every export draw through this, so they match.
//
// Cost: one getImageData of the box's visible device pixels, the kernel, and two drawImage
// calls. In the editor (live) the result is kept per adjustment and reused while nothing drawn
// before it changed (dragging a layer above it, hovering, the transformer), so only a change
// below it (or a zoom or pan) recomputes.

type Bitmap = HTMLImageElement | HTMLCanvasElement;
type Ctx = CanvasRenderingContext2D;

type Entry = { key: string; rect: DOMRectLike; mask: HTMLCanvasElement; color: HTMLCanvasElement; pixels: number };

// Live results, most recent last. A page rarely has many adjustments; each entry holds two
// canvases the size of the adjustment's visible box.
const live = new Map<string, Entry>();
const LIVE_ENTRIES = 12;
const LIVE_PIXELS = 24_000_000;
let livePixels = 0;

function release(e: Entry) {
  e.mask.width = e.mask.height = 0;
  e.color.width = e.color.height = 0;
  livePixels -= e.pixels;
}

function remember(id: string, e: Entry) {
  const old = live.get(id);
  if (old) {
    live.delete(id);
    release(old);
  }
  live.set(id, e);
  livePixels += e.pixels;
  while (live.size > LIVE_ENTRIES || (livePixels > LIVE_PIXELS && live.size > 1)) {
    const [k, v] = live.entries().next().value!;
    live.delete(k);
    release(v);
  }
}

/** Drop every kept live result (tests; a design switch). */
export function clearAdjustmentCache() {
  for (const e of live.values()) release(e);
  live.clear();
}

// Object identities as small numbers, for the stamp of what was drawn before an adjustment.
const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object) => {
  let i = ids.get(o);
  if (i === undefined) ids.set(o, (i = nextId++));
  return i;
};

type AnyNode = Konva.Node & { _id: number; attrs: Record<string, unknown>; cmGroup?: object; cmClip?: object };

/**
 * A stamp of every node drawn before `shape` in its layer (depth first, the drawing order): ids
 * and attributes, objects (images, draw functions, group configs) by identity. React-konva sets
 * new attributes on every edit and Konva on every drag, so the stamp changes exactly when
 * something below the adjustment may draw differently.
 */
function stampBefore(shape: Konva.Node): string | null {
  const layer = shape.getLayer();
  if (!layer) return null;
  const parts: string[] = [];
  let found = false;
  const visit = (n: AnyNode) => {
    if (found) return;
    if ((n as Konva.Node) === shape) {
      found = true;
      return;
    }
    let s = `${n._id}`;
    for (const k in n.attrs) {
      const v = n.attrs[k];
      s += `,${k}:${v !== null && (typeof v === "object" || typeof v === "function") ? `#${idOf(v as object)}` : String(v)}`;
    }
    if (n.cmGroup) s += `,g#${idOf(n.cmGroup)}`;
    if (n.cmClip) s += `,c#${idOf(n.cmClip)}`;
    parts.push(s);
    const kids = (n as unknown as { getChildren?: () => AnyNode[] }).getChildren?.();
    if (kids) for (const c of kids) visit(c);
  };
  visit(layer as unknown as AnyNode);
  return found ? parts.join(";") : null;
}

const cb: RGB = [0, 0, 0];
const cs: RGB = [0, 0, 0];
const mixed: RGB = [0, 0, 0];

/**
 * The coverage (0..255) of the adjustment over R: its box under the transform, with its raster
 * mask, or null when it covers R uniformly (no rotation and no mask).
 */
function coverage(ctx: Ctx, el: AdjustmentElement, mask: Bitmap | null | undefined, R: DOMRectLike): Uint8ClampedArray | null {
  const m = ctx.getTransform();
  if (!el.rasterMask && m.b === 0 && m.c === 0) return null;
  const c = makeCanvas(R.width, R.height);
  const x = c.getContext("2d")!;
  x.setTransform(m.a, m.b, m.c, m.d, m.e - R.x, m.f - R.y);
  x.fillStyle = "#000";
  const rm = el.rasterMask;
  if (rm && mask) {
    x.save();
    x.beginPath();
    x.rect(0, 0, el.width, el.height);
    x.clip();
    const outside = rm.outside ?? 0;
    if (outside > 0) {
      x.globalAlpha = outside;
      x.fillRect(0, 0, el.width, el.height);
      x.globalAlpha = 1;
      x.clearRect(rm.x, rm.y, rm.width, rm.height);
    }
    x.drawImage(mask, rm.x, rm.y, rm.width, rm.height);
    x.restore();
  } else {
    x.fillRect(0, 0, el.width, el.height);
  }
  const a = x.getImageData(0, 0, R.width, R.height).data;
  c.width = c.height = 0;
  return a;
}

/** Adjust what's drawn under the adjustment's box in `ctx`; see the top of this file. */
function drawAdjustment(ctx: Ctx, el: AdjustmentElement, mask: Bitmap | null | undefined, opts: { live?: boolean; key: string; shape?: Konva.Node }) {
  if (!(el.width > 0) || !(el.height > 0)) return;
  // A mask that hasn't loaded yet: draw nothing rather than the adjustment unmasked.
  if (el.rasterMask && !mask) return;
  const ga = ctx.globalAlpha;
  if (!(ga > 0)) return;
  const R = deviceRect(ctx, 0, 0, el.width, el.height);
  if (!R) return;
  let key = "";
  if (opts.live && opts.shape) {
    const stamp = stampBefore(opts.shape);
    const m = ctx.getTransform();
    if (stamp !== null) {
      key = `${opts.key}|${idOf(ctx.canvas)}:${ctx.canvas.width}x${ctx.canvas.height}|${R.x},${R.y},${R.width},${R.height}|${[m.a, m.b, m.c, m.d, m.e, m.f].join(",")}|${ga}|${mask ? idOf(mask) : 0}|${fxGeneration}|${stamp}`;
      const hit = live.get(el.id);
      if (hit && hit.key === key) {
        drawWriteBack(ctx, R, hit.mask, hit.color);
        return;
      }
    }
  }
  const B = readBackdrop(ctx, R);
  if (!B) return;
  const cov = coverage(ctx, el, mask, R);
  const back = B.data;
  // The adjusted copy, which becomes the colour written back.
  const out = new Uint8ClampedArray(back);
  applyAdjustment({ data: out, width: R.width, height: R.height }, el.adjustment);
  const mode = el.blendMode ?? "normal";
  const plain = mode === "normal" || mode === "pass-through";
  const n = R.width * R.height;
  const maskCanvas = makeCanvas(R.width, R.height);
  const colorCanvas = makeCanvas(R.width, R.height);
  const mctx = maskCanvas.getContext("2d")!;
  const cctx = colorCanvas.getContext("2d")!;
  const uniform = cov === null;
  const maskData = uniform ? null : mctx.createImageData(R.width, R.height);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const ab = back[p + 3];
    const k = uniform ? ga : (cov![p + 3] / 255) * ga;
    if (maskData) maskData.data[p + 3] = k * 255;
    if (ab === 0 || k <= 0) {
      out[p + 3] = 0;
      continue;
    }
    if (!plain) {
      cb[0] = back[p] / 255;
      cb[1] = back[p + 1] / 255;
      cb[2] = back[p + 2] / 255;
      cs[0] = out[p] / 255;
      cs[1] = out[p + 1] / 255;
      cs[2] = out[p + 2] / 255;
      blendInto(mode, cb, cs, mixed);
      out[p] = mixed[0] * 255;
      out[p + 1] = mixed[1] * 255;
      out[p + 2] = mixed[2] * 255;
    }
    // Written back over B·(1 − k): the backdrop's own alpha, so only its colours change.
    out[p + 3] = ab * k;
  }
  if (maskData) mctx.putImageData(maskData, 0, 0);
  else {
    mctx.globalAlpha = ga;
    mctx.fillRect(0, 0, R.width, R.height);
  }
  const img = cctx.createImageData(R.width, R.height);
  img.data.set(out);
  cctx.putImageData(img, 0, 0);
  drawWriteBack(ctx, R, maskCanvas, colorCanvas);
  if (key) remember(el.id, { key, rect: R, mask: maskCanvas, color: colorCanvas, pixels: n * 2 });
  else maskCanvas.width = maskCanvas.height = colorCanvas.width = colorCanvas.height = 0;
}

/**
 * Konva Shape attrs for an adjustment element. `mask` is its raster mask's bitmap. `live` marks
 * the editor, which keeps results between redraws (see the top of this file).
 */
export function adjustmentAttrs(el: AdjustmentElement, mask: Bitmap | null | undefined, opts?: { live?: boolean }): Record<string, unknown> {
  const key = JSON.stringify([el.adjustment, el.blendMode ?? "", el.rasterMask ?? null, el.width, el.height]);
  return {
    width: el.width,
    height: el.height,
    listening: false,
    sceneFunc: (kctx: Konva.Context, shape?: Konva.Shape) =>
      drawAdjustment(kctx._context as Ctx, el, mask, { live: opts?.live, key, shape }),
  };
}
