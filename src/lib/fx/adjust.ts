import type { Adjustment, Filter, HueRange, LevelsChannel, MixChannel } from "../adjustments";
import { hash01 } from "./blend";
import { gaussianBlur } from "./blur";
import { GRADIENT_LUT, gradientLut, parseHex } from "./gradient";
import { createRaster, fromImageData, toPixels, type Raster } from "./raster";

// Adjustment and filter pixel operations, our own formulas (documented per type below). They
// approximate Photoshop's look; exact fidelity is not the goal (see the plan's P5 notes).
//
// An adjustment is compiled once into one of three kernels: a lookup table per channel (levels,
// curves, exposure, invert, posterize, brightness/contrast), a table indexed by luma (threshold,
// gradient map), or a per-pixel function on 0..1 floats (the colour ones). Kernels are cached by
// the adjustment's JSON, because every edit clones the design.

type Px = { data: Uint8ClampedArray; width: number; height: number };
type Fn = (r: number, g: number, b: number, out: Float32Array) => void;
type Kernel = { kind: "lut"; r: Uint8Array; g: Uint8Array; b: Uint8Array } | { kind: "luma"; lut: Float32Array } | { kind: "px"; fn: Fn };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Rec. 601 luma, in the same units as its inputs (Photoshop's grey conversion is close to it). */
export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** A per-channel table from a 0..1 → 0..1 function. */
function table(f: (x: number) => number): Uint8Array {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = Math.round(clamp01(f(i / 255)) * 255);
  return t;
}

const identity = (x: number) => x;
const compose = (inner: (x: number) => number, outer: (x: number) => number) => (x: number) => outer(inner(x));

/**
 * Levels: out = outB + (outW − outB)·t^(1/γ), t = (x − inB)/(inW − inB) clamped, all in 0..255.
 */
function levelsFn(c: LevelsChannel | undefined): (x: number) => number {
  if (!c) return identity;
  const span = c.inWhite - c.inBlack;
  const g = 1 / Math.max(0.01, c.gamma);
  return (x) => {
    const v = x * 255;
    const t = span > 0 ? clamp01((v - c.inBlack) / span) : v >= c.inBlack ? 1 : 0;
    return (c.outBlack + (c.outWhite - c.outBlack) * Math.pow(t, g)) / 255;
  };
}

/**
 * Monotone cubic interpolation through the points (Fritsch–Carlson): tangents start as the
 * average of the neighbouring secants (0 at a local extremum), then are limited so no segment
 * overshoots. Flat beyond the end points; clamped to 0..1.
 */
export function monotoneCurve(points: { x: number; y: number }[]): (x: number) => number {
  const pts = [...points].sort((a, b) => a.x - b.x).filter((p, i, a) => i === 0 || p.x - a[i - 1].x > 1e-6);
  const n = pts.length;
  if (n === 0) return identity;
  if (n === 1) return () => clamp01(pts[0].y);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = m[k + 1] = 0;
      continue;
    }
    const a = m[k] / d[k];
    const b = m[k + 1] / d[k];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[k] = tau * a * d[k];
      m[k + 1] = tau * b * d[k];
    }
  }
  return (x) => {
    if (x <= xs[0]) return clamp01(ys[0]);
    if (x >= xs[n - 1]) return clamp01(ys[n - 1]);
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k];
    const t = (x - xs[k]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
    return clamp01(y);
  };
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

// RGB ↔ HSL (h in degrees 0..360, s and l 0..1).
function rgbToHsl(r: number, g: number, b: number, out: Float32Array) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const c = mx - mn;
  let h = 0;
  let s = 0;
  if (c > 1e-9) {
    s = c / (1 - Math.abs(2 * l - 1));
    if (mx === r) h = 60 * (((g - b) / c) % 6);
    else if (mx === g) h = 60 * ((b - r) / c + 2);
    else h = 60 * ((r - g) / c + 4);
    if (h < 0) h += 360;
  }
  out[0] = h;
  out[1] = clamp01(s);
  out[2] = l;
}

function hslToRgb(h: number, s: number, l: number, out: Float32Array) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g] = [c, x];
  else if (hh < 2) [r, g] = [x, c];
  else if (hh < 3) [g, b] = [c, x];
  else if (hh < 4) [g, b] = [x, c];
  else if (hh < 5) [r, b] = [x, c];
  else [r, b] = [c, x];
  const m = l - c / 2;
  out[0] = clamp01(r + m);
  out[1] = clamp01(g + m);
  out[2] = clamp01(b + m);
}

/**
 * How much a Hue/Saturation range applies to hue `h`: 1 from b to c, ramping from 0 at a and
 * back to 0 at d, measured upwards from a with wrap-around at 360.
 */
export function rangeWeight(r: Pick<HueRange, "a" | "b" | "c" | "d">, h: number) {
  const rel = (x: number) => (((x - r.a) % 360) + 360) % 360;
  const B = rel(r.b);
  const C = Math.max(B, rel(r.c));
  const D = Math.max(C, rel(r.d));
  const H = rel(h);
  if (H < B) return B > 0 ? H / B : 1;
  if (H <= C) return 1;
  if (H < D) return (D - H) / (D - C);
  return 0;
}

/** Saturation scaled by k (−1..1): down to grey at −1, up by (1 + k) clamped. */
const scaleSat = (s: number, k: number) => clamp01(s * (1 + k));
/** Lightness moved by k (−1..1): towards white for k > 0, black for k < 0. */
const moveLight = (l: number, k: number) => (k >= 0 ? l + (1 - l) * k : l * (1 + k));

/**
 * Hue/Saturation in HSL. The master values and every range (weighted by the pixel's original
 * hue, and by its chroma so greys belong to no range) add up into one hue shift, saturation and
 * lightness change. Colorize: the master hue and saturation replace the pixel's, its lightness stays.
 */
function hueSatFn(a: Extract<Adjustment, { type: "hue-saturation" }>): Fn {
  const hsl = new Float32Array(3);
  const ranges = a.ranges ?? [];
  return (r, g, b, out) => {
    rgbToHsl(r, g, b, hsl);
    let [h, s, l] = hsl;
    let dh = a.colorize ? 0 : a.master.hue;
    let ds = a.colorize ? 0 : a.master.saturation;
    let dl = a.master.lightness;
    if (!a.colorize && ranges.length) {
      const chroma = Math.min(1, 4 * (Math.max(r, g, b) - Math.min(r, g, b)));
      for (const rg of ranges) {
        const w = rangeWeight(rg, h) * chroma;
        if (w <= 0) continue;
        dh += w * rg.hue;
        ds += w * rg.saturation;
        dl += w * rg.lightness;
      }
    }
    if (a.colorize) {
      h = a.master.hue;
      s = clamp01(a.master.saturation / 100);
    } else {
      h += dh;
      s = scaleSat(s, Math.max(-1, Math.min(1, ds / 100)));
    }
    l = clamp01(moveLight(l, Math.max(-1, Math.min(1, dl / 100))));
    hslToRgb(h, s, l, out);
  };
}

/**
 * Vibrance: raises saturation by vibrance·(1 − s)², so muted colours gain far more than vivid
 * ones, and by half as much on skin hues (0..50°). Negative vibrance scales saturation down.
 * Then `saturation` scales it like Hue/Saturation does.
 */
function vibranceFn(a: Extract<Adjustment, { type: "vibrance" }>): Fn {
  const hsl = new Float32Array(3);
  const v = a.vibrance / 100;
  const k = a.saturation / 100;
  return (r, g, b, out) => {
    rgbToHsl(r, g, b, hsl);
    const [h, s0, l] = hsl;
    let s = s0;
    if (v > 0) s = clamp01(s + v * (1 - s) * (1 - s) * (h <= 50 ? 0.5 : 1));
    else if (v < 0) s = s * (1 + v);
    s = scaleSat(s, k);
    hslToRgb(h, s, l, out);
  };
}

const keepLuma = (r: number, g: number, b: number, out: Float32Array) => {
  const d = luma(r, g, b) - luma(out[0], out[1], out[2]);
  out[0] = clamp01(out[0] + d);
  out[1] = clamp01(out[1] + d);
  out[2] = clamp01(out[2] + d);
};

/** The most a ±100 colour balance moves a channel, as a fraction of full scale. */
const BALANCE_SCALE = 0.4;

/**
 * Colour balance: each tonal range shifts red, green and blue by its values, weighted by the
 * pixel's luma L: shadows 1 − 2L, midtones 1 − |2L − 1|, highlights 2L − 1 (each clamped to 0..1).
 * Preserve luminosity adds back the luma difference.
 */
function balanceFn(a: Extract<Adjustment, { type: "color-balance" }>): Fn {
  return (r, g, b, out) => {
    const L = luma(r, g, b);
    const ws = clamp01(1 - 2 * L);
    const wm = 1 - Math.abs(2 * L - 1);
    const wh = clamp01(2 * L - 1);
    const shift = (k: "cyanRed" | "magentaGreen" | "yellowBlue") =>
      ((ws * a.shadows[k] + wm * a.midtones[k] + wh * a.highlights[k]) / 100) * BALANCE_SCALE;
    out[0] = clamp01(r + shift("cyanRed"));
    out[1] = clamp01(g + shift("magentaGreen"));
    out[2] = clamp01(b + shift("yellowBlue"));
    if (a.preserveLuminosity) keepLuma(r, g, b, out);
  };
}

/**
 * Black & white: a colour is its smallest channel (white) plus (mid − min) of its secondary
 * colour (yellow, cyan or magenta, from the two largest channels) plus (max − mid) of its primary
 * (the largest channel); each part counts by that colour's weight (percent). The tint maps the
 * grey onto black → tint → white (2·g·t below the middle, 1 − 2(1 − g)(1 − t) above).
 */
function blackWhiteFn(a: Extract<Adjustment, { type: "black-white" }>): Fn {
  const w = a.weights;
  const tint = a.tint ? parseHex(a.tint) : null;
  const primary = [w.reds, w.greens, w.blues];
  // Secondary by the pair of top channels: r+g yellow, g+b cyan, r+b magenta.
  const secondary = (i: number, j: number) => (i + j === 1 ? w.yellows : i + j === 3 ? w.cyans : w.magentas);
  const ch = [0, 0, 0];
  return (r, g, b, out) => {
    ch[0] = r;
    ch[1] = g;
    ch[2] = b;
    const iMax = r >= g ? (r >= b ? 0 : 2) : g >= b ? 1 : 2;
    const iMin = r < g ? (r < b ? 0 : 2) : g < b ? 1 : 2;
    const iMid = iMax === iMin ? (iMax + 1) % 3 : 3 - iMax - iMin;
    const mx = ch[iMax];
    const md = ch[iMid];
    const mn = ch[iMin];
    const grey = clamp01(mn + ((md - mn) * secondary(iMax, iMid)) / 100 + ((mx - md) * primary[iMax]) / 100);
    for (let i = 0; i < 3; i++) {
      out[i] = !tint ? grey : grey < 0.5 ? 2 * grey * tint[i] : 1 - 2 * (1 - grey) * (1 - tint[i]);
    }
  };
}

/** Photo filter: towards the colour multiplied in, by density; preserve luminosity adds back the luma lost. */
function photoFilterFn(a: Extract<Adjustment, { type: "photo-filter" }>): Fn {
  const [fr, fg, fb] = parseHex(a.color);
  const d = a.density;
  return (r, g, b, out) => {
    out[0] = r + (r * fr - r) * d;
    out[1] = g + (g * fg - g) * d;
    out[2] = b + (b * fb - b) * d;
    if (a.preserveLuminosity) keepLuma(r, g, b, out);
  };
}

/** Channel mixer: each output is Σ input × percent / 100, plus the constant percent of full scale. */
function mixerFn(a: Extract<Adjustment, { type: "channel-mixer" }>): Fn {
  const mix = (m: MixChannel, r: number, g: number, b: number) => clamp01((r * m.r + g * m.g + b * m.b + m.constant) / 100);
  return (r, g, b, out) => {
    if (a.monochrome) {
      out[0] = out[1] = out[2] = mix(a.gray ?? a.r, r, g, b);
      return;
    }
    out[0] = mix(a.r, r, g, b);
    out[1] = mix(a.g, r, g, b);
    out[2] = mix(a.b, r, g, b);
  };
}

/**
 * Brightness/contrast. Legacy: x + brightness/255, then (x − 0.5)·(1 + contrast/100) + 0.5.
 * Otherwise brightness lifts the midtones and keeps black and white, y = x + b·(1 − |2x − 1|)·0.5
 * with b = brightness/150, and contrast blends towards the S-curve x²(3 − 2x) (positive) or
 * towards mid grey (negative).
 */
function brightnessFn(a: Extract<Adjustment, { type: "brightness-contrast" }>): (x: number) => number {
  const c = a.contrast / 100;
  if (a.legacy) return (x) => (x + a.brightness / 255 - 0.5) * (1 + c) + 0.5;
  const k = (a.brightness / 150) * 0.5;
  return (x) => {
    const y = clamp01(x + k * (1 - Math.abs(2 * x - 1)));
    return c >= 0 ? y + (y * y * (3 - 2 * y) - y) * c : 0.5 + (y - 0.5) * (1 + c);
  };
}

function compile(a: Adjustment): Kernel {
  const lut = (f: (x: number) => number): Kernel => {
    const t = table(f);
    return { kind: "lut", r: t, g: t, b: t };
  };
  switch (a.type) {
    case "invert":
      return lut((x) => 1 - x);
    case "posterize": {
      const n = Math.max(2, a.levels);
      return lut((x) => Math.round(x * (n - 1)) / (n - 1));
    }
    case "brightness-contrast":
      return lut(brightnessFn(a));
    case "exposure": {
      // In linear light: x·2^exposure + offset, then ^(1/gamma).
      const k = 2 ** a.exposure;
      const g = 1 / Math.max(0.01, a.gamma);
      return lut((x) => toSrgb(Math.pow(clamp01(toLinear(x) * k + a.offset), g)));
    }
    case "levels": {
      // Each channel's own levels, then the composite's.
      const master = levelsFn(a.channels.rgb);
      return {
        kind: "lut",
        r: table(compose(levelsFn(a.channels.r), master)),
        g: table(compose(levelsFn(a.channels.g), master)),
        b: table(compose(levelsFn(a.channels.b), master)),
      };
    }
    case "curves": {
      const curve = (p?: { x: number; y: number }[]) => (p?.length ? monotoneCurve(p) : identity);
      const master = curve(a.channels.rgb);
      return {
        kind: "lut",
        r: table(compose(curve(a.channels.r), master)),
        g: table(compose(curve(a.channels.g), master)),
        b: table(compose(curve(a.channels.b), master)),
      };
    }
    case "threshold": {
      // Luma at or above the level → white, else black.
      const t = new Float32Array(256 * 4);
      for (let i = 0; i < 256; i++) t.set(i >= a.level ? [1, 1, 1, 1] : [0, 0, 0, 1], i * 4);
      return { kind: "luma", lut: t };
    }
    case "gradient-map": {
      // Luma → the gradient (left to right); transparent stops let the original show through.
      const g = gradientLut(a.gradient);
      const flip = !!a.reverse !== !!a.gradient.reverse;
      const t = new Float32Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        const u = flip ? 1 - i / 255 : i / 255;
        const j = Math.round(u * GRADIENT_LUT) * 4;
        t.set([g[j], g[j + 1], g[j + 2], g[j + 3]], i * 4);
      }
      return { kind: "luma", lut: t };
    }
    case "hue-saturation":
      return { kind: "px", fn: hueSatFn(a) };
    case "vibrance":
      return { kind: "px", fn: vibranceFn(a) };
    case "color-balance":
      return { kind: "px", fn: balanceFn(a) };
    case "black-white":
      return { kind: "px", fn: blackWhiteFn(a) };
    case "photo-filter":
      return { kind: "px", fn: photoFilterFn(a) };
    case "channel-mixer":
      return { kind: "px", fn: mixerFn(a) };
  }
}

const kernels = new Map<string, Kernel>();
const KERNELS_KEPT = 32;

/** The compiled kernel of an adjustment, kept by its JSON. */
export function kernelFor(a: Adjustment): Kernel {
  const key = JSON.stringify(a);
  let k = kernels.get(key);
  if (!k) {
    k = compile(a);
    if (kernels.size >= KERNELS_KEPT) kernels.delete(kernels.keys().next().value!);
    kernels.set(key, k);
  }
  return k;
}

/**
 * Apply `a` in place to straight 8-bit RGBA; alpha is left alone and fully transparent pixels
 * are skipped.
 */
export function applyAdjustment(d: Px, a: Adjustment): void {
  const k = kernelFor(a);
  const p = d.data;
  const n = d.width * d.height * 4;
  if (k.kind === "lut") {
    const { r, g, b } = k;
    for (let i = 0; i < n; i += 4) {
      if (p[i + 3] === 0) continue;
      p[i] = r[p[i]];
      p[i + 1] = g[p[i + 1]];
      p[i + 2] = b[p[i + 2]];
    }
    return;
  }
  if (k.kind === "luma") {
    const t = k.lut;
    for (let i = 0; i < n; i += 4) {
      if (p[i + 3] === 0) continue;
      const j = Math.round(luma(p[i], p[i + 1], p[i + 2])) * 4;
      // Premultiplied entry over the original: c·(1 − a) + entry.
      const ia = 1 - t[j + 3];
      p[i] = Math.round(p[i] * ia + t[j] * 255);
      p[i + 1] = Math.round(p[i + 1] * ia + t[j + 1] * 255);
      p[i + 2] = Math.round(p[i + 2] * ia + t[j + 2] * 255);
    }
    return;
  }
  const out = new Float32Array(3);
  const fn = k.fn;
  // Photos repeat colours a lot: remember the last one.
  let last = -1;
  let lr = 0;
  let lg = 0;
  let lb = 0;
  for (let i = 0; i < n; i += 4) {
    if (p[i + 3] === 0) continue;
    const c = (p[i] << 16) | (p[i + 1] << 8) | p[i + 2];
    if (c !== last) {
      fn(p[i] / 255, p[i + 1] / 255, p[i + 2] / 255, out);
      last = c;
      lr = Math.round(out[0] * 255);
      lg = Math.round(out[1] * 255);
      lb = Math.round(out[2] * 255);
    }
    p[i] = lr;
    p[i + 1] = lg;
    p[i + 2] = lb;
  }
}

/** Blur all four premultiplied channels of a raster. */
function blurRaster(r: Raster, sigma: number): Raster {
  const n = r.w * r.h;
  const out = createRaster(r.w, r.h);
  const ch = new Float32Array(n);
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < n; i++) ch[i] = r.data[i * 4 + c];
    const b = gaussianBlur(ch, r.w, r.h, sigma);
    for (let i = 0; i < n; i++) out.data[i * 4 + c] = b[i];
  }
  return out;
}

/**
 * Run a filter over an element's content raster (premultiplied, `ratio` raster pixels per
 * design unit). Returns a new raster or `r` itself, changed in place.
 */
export function applyFilter(r: Raster, f: Filter, ratio: number, seed = 0): Raster {
  if (r.w < 1 || r.h < 1) return r;
  switch (f.type) {
    case "blur":
      return f.radius > 0 ? blurRaster(r, f.radius * ratio) : r;
    case "sharpen": {
      if (!(f.amount > 0)) return r;
      // Unsharp mask on straight colour, against the blur's own straight colour (so edges against
      // transparency and the raster border don't count as contrast).
      const b = blurRaster(r, f.radius * ratio);
      const d = r.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        const ba = b.data[i + 3];
        if (a <= 0 || ba <= 0) continue;
        for (let c = 0; c < 3; c++) {
          const s = d[i + c] / a;
          const v = s + f.amount * (s - b.data[i + c] / ba);
          d[i + c] = clamp01(v) * a;
        }
      }
      return r;
    }
    case "noise": {
      if (!(f.amount > 0)) return r;
      const d = r.data;
      for (let y = 0, i = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++, i += 4) {
          const a = d[i + 3];
          if (a <= 0) continue;
          const n0 = (hash01(x, y, seed) - 0.5) * 2 * f.amount;
          for (let c = 0; c < 3; c++) {
            const n = f.mono || c === 0 ? n0 : (hash01(x, y, seed + c * 7919) - 0.5) * 2 * f.amount;
            d[i + c] = Math.max(0, Math.min(a, d[i + c] + n * a));
          }
        }
      }
      return r;
    }
    case "adjust": {
      const px = toPixels(r);
      applyAdjustment({ data: px, width: r.w, height: r.h }, f.adjustment);
      return fromImageData({ data: px, width: r.w, height: r.h });
    }
  }
}

/** Run every filter in order. */
export function applyFilters(r: Raster, filters: Filter[] | undefined, ratio: number, seed = 0): Raster {
  let out = r;
  for (const f of filters ?? []) out = applyFilter(out, f, ratio, seed);
  return out;
}
