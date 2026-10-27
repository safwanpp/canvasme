import type { BlendMode, Contour, Effects, Paint } from "../effects";
import { compositeInto } from "./blend";
import { gaussianBlur } from "./blur";
import { signedDistance } from "./distance";
import { parseHex, sampleGradient } from "./gradient";
import { alphaOf, createRaster, type Raster } from "./raster";

// Layer effects on one element's pixels. Everything here is in device pixels: effect sizes
// come in element units and are multiplied by `ratio`. The result is drawn bottom to top:
// the outer parts (drop shadows, then outer glow), each with its own blend, then the body.

export type FxPart = { raster: Raster; blend: BlendMode; opacity: number };
export type FxRender<T = FxPart> = { outer: T[]; body: Raster };
export type FxOptions = {
  /** Device pixels per element unit. */
  ratio: number;
  fillOpacity: number;
  /** The element box inside the padded raster, in device pixels. */
  box: { x: number; y: number; w: number; h: number };
  /** Seeds dissolve's noise so it stays put between renders. */
  seed: number;
  /** Render only the outer effects or only the body (each may need its own resolution). */
  parts?: "all" | "outer" | "body";
};

/** Gaussian sigma for an effect's size (Photoshop's "Size" reaches about 2σ). */
export const SIZE_TO_SIGMA = 0.5;
/** How far a blur of `size` reaches before it rounds to nothing in 8 bits, in sizes (4σ). */
const BLUR_REACH = 4 * SIZE_TO_SIGMA;

const on = <T extends { enabled?: boolean }>(fx: T | undefined): fx is T => !!fx && fx.enabled !== false;
const list = <T extends { enabled?: boolean }>(fxs: T[] | undefined) => (fxs ?? []).filter(on);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Light direction (degrees) and distance to a pixel offset: 90° casts straight down. */
export function lightOffset(angle: number, distance: number) {
  const a = (angle * Math.PI) / 180;
  return { dx: -Math.cos(a) * distance, dy: Math.sin(a) * distance };
}

/** A channel moved by whole pixels; uncovered pixels take `fill`. */
function shift(ch: Float32Array, w: number, h: number, dx: number, dy: number, fill = 0) {
  const sx = Math.round(dx);
  const sy = Math.round(dy);
  if (!sx && !sy) return ch;
  const out = new Float32Array(w * h).fill(fill);
  for (let y = Math.max(0, sy); y < Math.min(h, h + sy); y++) {
    const from = (y - sy) * w;
    const to = y * w;
    for (let x = Math.max(0, sx); x < Math.min(w, w + sx); x++) out[to + x] = ch[from + x - sx];
  }
  return out;
}

/** Remap alpha through a contour curve (piecewise linear), in place. */
function applyContour(ch: Float32Array, contour: Contour | undefined) {
  if (!contour || contour.length < 2) return ch;
  const pts = [...contour].sort((a, b) => a.x - b.x);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let j = 1;
    while (j < pts.length - 1 && pts[j].x < x) j++;
    const a = pts[j - 1];
    const b = pts[j];
    const t = b.x > a.x ? clamp01((x - a.x) / (b.x - a.x)) : 1;
    lut[i] = clamp01(a.y + (b.y - a.y) * t);
  }
  for (let i = 0; i < ch.length; i++) ch[i] = lut[Math.round(clamp01(ch[i]) * 255)];
  return ch;
}

/** A raster of one colour with `alpha` as its coverage. */
function colorize(alpha: Float32Array, w: number, h: number, hex: string): Raster {
  const [r, g, b, a0] = parseHex(hex);
  const out = createRaster(w, h);
  const d = out.data;
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    const a = alpha[i] * a0;
    d[p] = r * a;
    d[p + 1] = g * a;
    d[p + 2] = b * a;
    d[p + 3] = a;
  }
  return out;
}

/** A raster filled with one colour. */
function solid(w: number, h: number, hex: string): Raster {
  const [r, g, b, a] = parseHex(hex);
  const out = createRaster(w, h);
  const d = out.data;
  for (let p = 0; p < d.length; p += 4) {
    d[p] = r * a;
    d[p + 1] = g * a;
    d[p + 2] = b * a;
    d[p + 3] = a;
  }
  return out;
}

/** A paint over the whole raster, then multiplied by `cov`. */
function paintRaster(paint: Paint, cov: Float32Array, w: number, h: number, o: FxOptions): Raster {
  if (paint.type === "color") return colorize(cov, w, h, paint.color);
  const r = sampleGradient(paint.gradient, { w: o.box.w / o.ratio, h: o.box.h / o.ratio }, w, h, o.box, o.ratio);
  const d = r.data;
  for (let i = 0, p = 0; i < cov.length; i++, p += 4) {
    const c = cov[i];
    d[p] *= c;
    d[p + 1] *= c;
    d[p + 2] *= c;
    d[p + 3] *= c;
  }
  return r;
}

/**
 * Run the effects over `content` (premultiplied, padded). `content` is used up: the body is
 * built in its buffer. Each outer part goes through `keep` as soon as it is made, so a caller
 * that turns it into a canvas never holds more than one part's float buffer at a time.
 */
export function renderEffects<T = FxPart>(
  content: Raster,
  fx: Effects | undefined,
  o: FxOptions,
  keep: (p: FxPart) => T = (p) => p as T,
): FxRender<T> {
  const { w, h } = content;
  const fill = clamp01(o.fillOpacity);
  const parts = o.parts ?? "all";
  const empty = createRaster(0, 0);
  if (!fx || w < 1 || h < 1) return { outer: [], body: parts === "outer" ? empty : fadeBy(content, fill) };

  const k = o.ratio;
  const A = alphaOf(content);
  let field: Float32Array | null = null;
  const dist = () => (field ??= signedDistance(A, w, h));
  /** A grown (r > 0) or shrunk (r < 0) by r pixels, antialiased. */
  const grow = (r: number) => {
    if (r === 0) return A;
    const d = dist();
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = clamp01(r - d[i] + 0.5);
    return out;
  };

  const outer: T[] = [];
  for (const s of parts === "body" ? [] : list(fx.dropShadow)) {
    const size = s.size * k;
    const spread = clamp01(s.spread ?? 0);
    let a = gaussianBlur(grow(size * spread), w, h, size * SIZE_TO_SIGMA * (1 - spread));
    a = applyContour(a, s.contour);
    const { dx, dy } = lightOffset(s.angle, s.distance * k);
    a = shift(a, w, h, dx, dy);
    if (s.knockout !== false) {
      // Hidden under the layer even where its fill is faded, as Photoshop does.
      for (let i = 0; i < a.length; i++) a[i] *= 1 - A[i];
    }
    outer.push(keep({ raster: colorize(a, w, h, s.color), blend: s.blendMode ?? "normal", opacity: s.opacity ?? 1 }));
  }
  const og = parts !== "body" && on(fx.outerGlow) ? fx.outerGlow : undefined;
  if (og) {
    const size = og.size * k;
    const spread = clamp01(og.spread ?? 0);
    let a: Float32Array;
    if (og.technique === "precise") {
      const d = dist();
      const dil = size * spread;
      const reach = Math.max(1e-6, size - dil);
      a = new Float32Array(w * h);
      for (let i = 0; i < a.length; i++) a[i] = d[i] <= dil ? 1 : clamp01(1 - (d[i] - dil) / reach);
    } else {
      a = gaussianBlur(grow(size * spread), w, h, size * SIZE_TO_SIGMA * (1 - spread));
    }
    a = applyContour(a, og.contour);
    outer.push(keep({ raster: colorize(a, w, h, og.color), blend: og.blendMode ?? "normal", opacity: og.opacity ?? 1 }));
  }
  if (parts === "outer") return { outer, body: empty };

  // Interior effects are composited in shape-relative space (colour over the shape at full
  // coverage, the content's strength being the fill opacity), then multiplied by A once. So
  // an overlay keeps the content's exact alpha at soft edges, and still shows at fill 0.
  // Built in content's own buffer (A already holds the alpha), saving a full-size raster.
  const rel = content;
  const rd = rel.data;
  for (let i = 0, p = 0; i < A.length; i++, p += 4) {
    const a = A[i];
    const m = a > 0 ? fill / a : 0;
    rd[p] *= m;
    rd[p + 1] *= m;
    rd[p + 2] *= m;
    rd[p + 3] = a > 0 ? fill : 0;
  }
  for (const g of list(fx.gradientOverlay)) {
    const r = sampleGradient(g.gradient, { w: o.box.w / k, h: o.box.h / k }, w, h, o.box, k);
    compositeInto(rel, r, g.blendMode ?? "normal", g.opacity ?? 1, undefined, undefined, o.seed);
  }
  for (const c of list(fx.colorOverlay)) {
    compositeInto(rel, solid(w, h, c.color), c.blendMode ?? "normal", c.opacity ?? 1, undefined, undefined, o.seed);
  }
  const ig = on(fx.innerGlow) ? fx.innerGlow : undefined;
  if (ig) {
    const size = ig.size * k;
    const choke = clamp01(ig.choke ?? 0);
    const ch = size * choke;
    let a: Float32Array;
    if (ig.technique === "precise") {
      const d = dist();
      const reach = Math.max(1e-6, size - ch);
      a = new Float32Array(w * h);
      for (let i = 0; i < a.length; i++) {
        const depth = Math.max(0, -d[i] - ch); // how far inside, past the choke
        a[i] = ig.source === "center" ? clamp01(depth / reach) : clamp01(1 - depth / reach);
      }
    } else {
      a = gaussianBlur(grow(-ch), w, h, size * SIZE_TO_SIGMA * (1 - choke));
      if (ig.source !== "center") for (let i = 0; i < a.length; i++) a[i] = 1 - a[i];
    }
    a = applyContour(a, ig.contour);
    compositeInto(rel, colorize(a, w, h, ig.color), ig.blendMode ?? "normal", ig.opacity ?? 1, undefined, undefined, o.seed);
  }
  for (const s of list(fx.innerShadow)) {
    const size = s.size * k;
    const choke = clamp01(s.choke ?? 0);
    // Blur the shrunk shape rather than its inverse: past the raster's edge counts as empty,
    // which is right for the shape but would lighten an inverse near the border.
    const core = gaussianBlur(grow(-size * choke), w, h, size * SIZE_TO_SIGMA * (1 - choke));
    const { dx, dy } = lightOffset(s.angle, s.distance * k);
    let a = shift(core, w, h, dx, dy);
    for (let i = 0; i < a.length; i++) a[i] = 1 - a[i];
    a = applyContour(a, s.contour);
    compositeInto(rel, colorize(a, w, h, s.color), s.blendMode ?? "normal", s.opacity ?? 1, undefined, undefined, o.seed);
  }
  const body = rel;
  for (let i = 0, p = 0; i < A.length; i++, p += 4) {
    const a = A[i];
    rd[p] *= a;
    rd[p + 1] *= a;
    rd[p + 2] *= a;
    rd[p + 3] *= a;
  }

  // Strokes sit on top and are not clipped to the shape: their own band defines them.
  for (const s of list(fx.stroke)) {
    const size = s.size * k;
    if (size <= 0) continue;
    const d = dist();
    const cov = new Float32Array(w * h);
    const pos = s.position ?? "outside";
    const lo = pos === "outside" ? 0 : pos === "inside" ? -size : -size / 2;
    const hi = lo + size;
    for (let i = 0; i < cov.length; i++) cov[i] = clamp01(hi - d[i] + 0.5) * clamp01(d[i] - lo + 0.5);
    compositeInto(body, paintRaster(s.paint, cov, w, h, o), s.blendMode ?? "normal", s.opacity ?? 1, undefined, undefined, o.seed);
  }
  return { outer, body };
}

function fadeBy(r: Raster, k: number): Raster {
  if (k >= 1) return r;
  const out = createRaster(r.w, r.h);
  for (let i = 0; i < r.data.length; i++) out.data[i] = r.data[i] * k;
  return out;
}

/**
 * How far effects reach past the element box on each side, in element units. With "body",
 * only what the body holds (strokes), leaving out shadows and glows.
 */
export function fxPaddingUnits(
  fx: Effects | undefined,
  which: "all" | "body" = "all",
): { l: number; t: number; r: number; b: number } {
  const p = { l: 0, t: 0, r: 0, b: 0 };
  if (!fx) return p;
  const grow = (l: number, t: number, r: number, b: number) => {
    p.l = Math.max(p.l, l);
    p.t = Math.max(p.t, t);
    p.r = Math.max(p.r, r);
    p.b = Math.max(p.b, b);
  };
  for (const s of which === "body" ? [] : list(fx.dropShadow)) {
    // Blur reach covers the spread too: size·spread + reach·size·(1−spread) ≤ reach·size.
    const reach = s.size * BLUR_REACH + 1;
    const { dx, dy } = lightOffset(s.angle, s.distance);
    grow(Math.max(0, reach - dx), Math.max(0, reach - dy), Math.max(0, reach + dx), Math.max(0, reach + dy));
  }
  if (which !== "body" && on(fx.outerGlow)) {
    const g = fx.outerGlow;
    const reach = (g.technique === "precise" ? g.size : g.size * BLUR_REACH) + 1;
    grow(reach, reach, reach, reach);
  }
  for (const s of list(fx.stroke)) {
    const pos = s.position ?? "outside";
    const reach = pos === "outside" ? s.size + 1 : pos === "center" ? s.size / 2 + 1 : 0;
    grow(reach, reach, reach, reach);
  }
  return p;
}

/** Whether any shadow or glow is drawn outside the body. */
export const hasOuterEffects = (fx: Effects | undefined) => !!fx && (list(fx.dropShadow).length > 0 || on(fx.outerGlow));
