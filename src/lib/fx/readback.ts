import type { BlendMode } from "../effects";
import { blendInto, compositeInto, hash01, isNativeBlend, NATIVE_BLEND, type RGB } from "./blend";
import { createRaster, fromImageData, makeCanvas, toPixels, type Raster } from "./raster";

// Blend modes canvas can't draw natively: read the pixels already drawn under the element,
// blend in software, and write the result back with two compositing draws, so the canvas
// clip (the page edge) and the destination's alpha still apply. putImageData would ignore both.

export type DOMRectLike = { x: number; y: number; width: number; height: number };

type Ctx = CanvasRenderingContext2D;

// Scratch canvases, one per use, kept between draws: a blend redraws every frame, and a new
// canvas per draw is garbage the browser frees late. A big one gives its memory back after use.
const pool = new Map<string, HTMLCanvasElement>();
const KEEP_PIXELS = 1 << 20;

function scratch(slot: string, w: number, h: number) {
  let c = pool.get(slot);
  if (!c) {
    c = makeCanvas(w, h);
    pool.set(slot, c);
  } else if (c.width !== w || c.height !== h) {
    // Resizing clears the canvas and resets its state.
    c.width = w;
    c.height = h;
  } else {
    const x = c.getContext("2d")!;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = "source-over";
    x.clearRect(0, 0, w, h);
  }
  return c;
}

function done(...cs: HTMLCanvasElement[]) {
  for (const c of cs) if (c.width * c.height > KEEP_PIXELS) c.width = c.height = 0;
}

/** The drawn pixels under `rect` (device pixels, whole numbers), or null for an empty rect. */
export function readBackdrop(ctx: Ctx, rect: DOMRectLike): ImageData | null {
  if (!(rect.width >= 1) || !(rect.height >= 1)) return null;
  return ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
}

/**
 * Replace the pixels under `rect` with B·(1−a) + C·a, where `coverage` is a per pixel and
 * `colorPremul` holds C·a as premultiplied RGBA (0..1). Runs under an identity transform.
 */
export function writeBackBlended(ctx: Ctx, rect: DOMRectLike, coverage: Float32Array, colorPremul: Float32Array) {
  const { width: w, height: h } = rect;
  if (!(w >= 1) || !(h >= 1)) return;
  const mask = scratch("mask", w, h);
  const color = scratch("color", w, h);
  const mctx = mask.getContext("2d")!;
  const cctx = color.getContext("2d")!;
  const m = mctx.createImageData(w, h);
  const c = cctx.createImageData(w, h);
  for (let i = 0, p = 0; i < coverage.length; i++, p += 4) {
    const a = coverage[i];
    // ImageData rounds to the nearest level itself.
    m.data[p + 3] = a * 255;
    if (a <= 0) continue;
    const ca = colorPremul[p + 3];
    const k = ca > 0 ? 255 / ca : 0;
    c.data[p] = colorPremul[p] * k;
    c.data[p + 1] = colorPremul[p + 1] * k;
    c.data[p + 2] = colorPremul[p + 2] * k;
    c.data[p + 3] = ca * 255;
  }
  mctx.putImageData(m, 0, 0);
  cctx.putImageData(c, 0, 0);
  drawWriteBack(ctx, rect, mask, color);
  done(mask, color);
}

/**
 * The write-back itself: the pixels under `rect` become B·(1 − mask alpha) + color (premultiplied
 * by its alpha), with two compositing draws under an identity transform, so clips still apply.
 */
export function drawWriteBack(ctx: Ctx, rect: DOMRectLike, mask: CanvasImageSource, color: CanvasImageSource) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(mask, rect.x, rect.y);
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(color, rect.x, rect.y);
  ctx.restore();
}

/** Device-pixel bounds of a local rectangle under the context's transform, clipped to the canvas. */
export function deviceRect(ctx: Ctx, x: number, y: number, w: number, h: number): DOMRectLike | null {
  const m = ctx.getTransform();
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ]) {
    xs.push(m.a * px + m.c * py + m.e);
    ys.push(m.b * px + m.d * py + m.f);
  }
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs)));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys)));
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

const cb: RGB = [0, 0, 0];
const cs: RGB = [0, 0, 0];
const mix: RGB = [0, 0, 0];

/**
 * Draw `src` into the local rectangle (x, y, w, h) with a blend mode canvas lacks, honouring
 * the context's transform and globalAlpha. `seed` keeps dissolve's noise stable.
 */
export function drawBlended(
  ctx: Ctx,
  src: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
  mode: BlendMode,
  seed = 0,
) {
  const R = deviceRect(ctx, x, y, w, h);
  if (!R) return;
  const B = readBackdrop(ctx, R);
  if (!B) return;
  const m = ctx.getTransform();
  const tmp = scratch("tmp", R.width, R.height);
  const t = tmp.getContext("2d")!;
  t.setTransform(m.a, m.b, m.c, m.d, m.e - R.x, m.f - R.y);
  t.drawImage(src, x, y, w, h);
  const S = t.getImageData(0, 0, R.width, R.height).data;
  done(tmp);
  const b = B.data;
  const ga = ctx.globalAlpha;
  const n = R.width * R.height;
  const coverage = new Float32Array(n);
  const color = new Float32Array(n * 4);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let a = (S[p + 3] / 255) * ga;
    if (a <= 0) continue;
    if (mode === "dissolve") {
      a = hash01(R.x + (i % R.width), R.y + Math.floor(i / R.width), seed) < a ? 1 : 0;
      if (!a) continue;
    }
    cs[0] = S[p] / 255;
    cs[1] = S[p + 1] / 255;
    cs[2] = S[p + 2] / 255;
    const ab = b[p + 3] / 255;
    let r = cs[0];
    let g = cs[1];
    let bl = cs[2];
    if (ab > 0) {
      cb[0] = b[p] / 255;
      cb[1] = b[p + 1] / 255;
      cb[2] = b[p + 2] / 255;
      blendInto(mode, cb, cs, mix);
      // Where the backdrop is partly transparent, the plain source shows through in proportion.
      r = (1 - ab) * cs[0] + ab * mix[0];
      g = (1 - ab) * cs[1] + ab * mix[1];
      bl = (1 - ab) * cs[2] + ab * mix[2];
    }
    coverage[i] = a;
    color[p] = r * a;
    color[p + 1] = g * a;
    color[p + 2] = bl * a;
    color[p + 3] = a;
  }
  writeBackBlended(ctx, R, coverage, color);
}

/** One drawn layer of a group: an image in a local rectangle, with its own blend and opacity. */
export type GroupPart = { src: CanvasImageSource; rect: [number, number, number, number]; mode: BlendMode; opacity: number };

/**
 * Draw an element's parts (outer effects, then its body) as one layer with blend `mode`, as
 * Photoshop applies a layer's blend mode to its effects too. Each part first blends with its
 * own mode against what is under it (the drawn backdrop and the parts before it); the group
 * that adds up to that is then drawn with `mode`. With mode normal this equals drawing the
 * parts one by one, so callers only need it for other modes.
 */
export function drawGroupBlended(ctx: Ctx, parts: GroupPart[], mode: BlendMode, seed = 0) {
  let R: DOMRectLike | null = null;
  for (const p of parts) {
    const r = deviceRect(ctx, ...p.rect);
    if (!r || !R) {
      R = R ?? r;
      continue;
    }
    const x0 = Math.min(R.x, r.x);
    const y0 = Math.min(R.y, r.y);
    R = {
      x: x0,
      y: y0,
      width: Math.max(R.x + R.width, r.x + r.width) - x0,
      height: Math.max(R.y + R.height, r.y + r.height) - y0,
    };
  }
  if (!R) return;
  const B = readBackdrop(ctx, R);
  if (!B) return;
  const back = fromImageData(B);
  // `cur` is the backdrop with the parts drawn on it; `group` tracks the parts' own coverage.
  const cur = fromImageData(B);
  const group = createRaster(R.width, R.height);
  const m = ctx.getTransform();
  const tmp = scratch("tmp", R.width, R.height);
  const t = tmp.getContext("2d")!;
  for (const p of parts) {
    if (!(p.opacity > 0)) continue;
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(0, 0, R.width, R.height);
    t.setTransform(m.a, m.b, m.c, m.d, m.e - R.x, m.f - R.y);
    t.drawImage(p.src, ...p.rect);
    const S: Raster = fromImageData(t.getImageData(0, 0, R.width, R.height));
    compositeInto(cur, S, p.mode, p.opacity, undefined, undefined, seed);
    compositeInto(group, S, p.mode === "dissolve" ? "dissolve" : "normal", p.opacity, undefined, undefined, seed);
  }
  done(tmp);
  // The group's colour is whatever, laid over the backdrop at its coverage, gives `cur`.
  const g = group.data;
  const c = cur.data;
  const b = back.data;
  for (let i = 0; i < g.length; i += 4) {
    const k = 1 - g[i + 3];
    g[i] = Math.max(0, c[i] - b[i] * k);
    g[i + 1] = Math.max(0, c[i + 1] - b[i + 1] * k);
    g[i + 2] = Math.max(0, c[i + 2] - b[i + 2] * k);
  }
  const gc = scratch("group", R.width, R.height);
  const gctx = gc.getContext("2d")!;
  const img = gctx.createImageData(R.width, R.height);
  toPixels(group, img.data);
  gctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (isNativeBlend(mode)) {
    ctx.globalCompositeOperation = NATIVE_BLEND[mode] ?? "source-over";
    ctx.drawImage(gc, R.x, R.y);
  } else {
    drawBlended(ctx, gc, R.x, R.y, R.width, R.height, mode, seed);
  }
  ctx.restore();
  done(gc);
}
