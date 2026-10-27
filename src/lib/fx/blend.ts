import type { BlendMode } from "../effects";
import type { Raster } from "./raster";

// Photoshop blend modes as formulas on straight colour (0..1), from the W3C Compositing and
// Blending spec plus the Photoshop-only modes (linear burn, vivid light and so on), and the
// canvas globalCompositeOperation that draws each natively where one exists.

export const NATIVE_BLEND: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: "source-over",
  "pass-through": "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color-dodge": "color-dodge",
  "color-burn": "color-burn",
  "hard-light": "hard-light",
  "soft-light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
  "linear-dodge": "lighter",
};

/** Whether canvas can draw the mode itself; undefined means normal. */
export const isNativeBlend = (m: BlendMode | undefined) => !m || m in NATIVE_BLEND;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const colorDodge = (b: number, s: number) => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)));
const colorBurn = (b: number, s: number) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));
const hardLight = (b: number, s: number) => (s <= 0.5 ? b * 2 * s : b + (2 * s - 1) - b * (2 * s - 1));
const softLight = (b: number, s: number) => {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
};
const vividLight = (b: number, s: number) => (s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * s - 1));

type Sep = (b: number, s: number) => number;
const SEPARABLE: Partial<Record<BlendMode, Sep>> = {
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => hardLight(s, b),
  darken: Math.min,
  lighten: Math.max,
  "color-dodge": colorDodge,
  "color-burn": colorBurn,
  "hard-light": hardLight,
  "soft-light": softLight,
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
  "linear-dodge": (b, s) => Math.min(1, b + s),
  "linear-burn": (b, s) => Math.max(0, b + s - 1),
  "vivid-light": (b, s) => clamp01(vividLight(b, s)),
  "linear-light": (b, s) => clamp01(b + 2 * s - 1),
  "pin-light": (b, s) => (s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
  "hard-mix": (b, s) => (clamp01(vividLight(b, s)) < 0.5 ? 0 : 1),
  subtract: (b, s) => Math.max(0, b - s),
  divide: (b, s) => (s <= 0 ? 1 : Math.min(1, b / s)),
};

// Non-separable helpers (W3C): luminosity, saturation, and the clip that keeps a colour in gamut.
export type RGB = [number, number, number];
const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

function setLum(c: RGB, l: number, out: RGB) {
  const d = l - lum(c[0], c[1], c[2]);
  let r = c[0] + d;
  let g = c[1] + d;
  let b = c[2] + d;
  const L = lum(r, g, b);
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  if (n < 0) {
    const k = L - n;
    r = L + ((r - L) * L) / k;
    g = L + ((g - L) * L) / k;
    b = L + ((b - L) * L) / k;
  }
  if (x > 1) {
    const k = x - L;
    r = L + ((r - L) * (1 - L)) / k;
    g = L + ((g - L) * (1 - L)) / k;
    b = L + ((b - L) * (1 - L)) / k;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
}

const sat = (c: RGB) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

function setSat(c: RGB, s: number, out: RGB) {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  const range = mx - mn;
  for (let i = 0; i < 3; i++) {
    if (range <= 0) out[i] = 0;
    else if (c[i] === mx) out[i] = s;
    else if (c[i] === mn) out[i] = 0;
    else out[i] = ((c[i] - mn) * s) / range;
  }
  // Ties: a channel equal to both max and min is handled by range 0; equal max wins over mid.
}

const tmp: RGB = [0, 0, 0];

/** Blend backdrop `cb` with source `cs` (straight colour) into `out`, without allocating. */
export function blendInto(mode: BlendMode, cb: RGB, cs: RGB, out: RGB) {
  const f = SEPARABLE[mode];
  if (f) {
    out[0] = f(cb[0], cs[0]);
    out[1] = f(cb[1], cs[1]);
    out[2] = f(cb[2], cs[2]);
    return;
  }
  switch (mode) {
    case "hue":
      setSat(cs, sat(cb), tmp);
      return setLum(tmp, lum(cb[0], cb[1], cb[2]), out);
    case "saturation":
      setSat(cb, sat(cs), tmp);
      return setLum(tmp, lum(cb[0], cb[1], cb[2]), out);
    case "color":
      return setLum(cs, lum(cb[0], cb[1], cb[2]), out);
    case "luminosity":
      return setLum(cb, lum(cs[0], cs[1], cs[2]), out);
    case "darker-color": {
      const pick = lum(cs[0], cs[1], cs[2]) < lum(cb[0], cb[1], cb[2]) ? cs : cb;
      out[0] = pick[0];
      out[1] = pick[1];
      out[2] = pick[2];
      return;
    }
    case "lighter-color": {
      const pick = lum(cs[0], cs[1], cs[2]) > lum(cb[0], cb[1], cb[2]) ? cs : cb;
      out[0] = pick[0];
      out[1] = pick[1];
      out[2] = pick[2];
      return;
    }
    default:
      // normal, pass-through, dissolve: the source as it is.
      out[0] = cs[0];
      out[1] = cs[1];
      out[2] = cs[2];
  }
}

/** B(Cb, Cs) for one pixel, straight colour in 0..1. */
export function blendPixel(mode: BlendMode, cb: RGB, cs: RGB): RGB {
  const out: RGB = [0, 0, 0];
  blendInto(mode, cb, cs, out);
  return out;
}

/** A stable pseudo-random value in [0, 1) for a pixel, for dissolve. */
export function hash01(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const cb: RGB = [0, 0, 0];
const cs: RGB = [0, 0, 0];
const mix: RGB = [0, 0, 0];

/**
 * Composite `src` onto `dst` in place with the W3C general formula
 * Co = αs(1−αb)Cs + αsαb·B(Cb,Cs) + (1−αs)αbCb, αo = αs + αb(1−αs), on premultiplied buffers.
 * `src` sits at `at` in dst pixels; `mask` (dst-sized) and `opacity` scale the source alpha.
 */
export function compositeInto(
  dst: Raster,
  src: Raster,
  mode: BlendMode,
  opacity: number,
  mask?: Float32Array,
  at?: { x: number; y: number },
  seed = 0,
): void {
  if (!(opacity > 0)) return;
  const ox = Math.round(at?.x ?? 0);
  const oy = Math.round(at?.y ?? 0);
  const x0 = Math.max(0, ox);
  const y0 = Math.max(0, oy);
  const x1 = Math.min(dst.w, ox + src.w);
  const y1 = Math.min(dst.h, oy + src.h);
  const d = dst.data;
  const s = src.data;
  const plain = mode === "normal" || mode === "pass-through";
  const dissolve = mode === "dissolve";
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const di = y * dst.w + x;
      const si = ((y - oy) * src.w + (x - ox)) * 4;
      const sa0 = s[si + 3];
      if (sa0 <= 0) continue;
      let k = opacity * (mask ? mask[di] : 1);
      if (k <= 0) continue;
      const p = di * 4;
      if (dissolve) {
        // Fully on or off, with the chance of on equal to the alpha.
        if (hash01(x, y, seed) >= sa0 * k) continue;
        k = 1 / sa0;
      }
      const as = sa0 * k;
      const ab = d[p + 3];
      if (plain || dissolve || ab <= 0) {
        d[p] = s[si] * k + d[p] * (1 - as);
        d[p + 1] = s[si + 1] * k + d[p + 1] * (1 - as);
        d[p + 2] = s[si + 2] * k + d[p + 2] * (1 - as);
        d[p + 3] = as + ab * (1 - as);
        continue;
      }
      cs[0] = s[si] / sa0;
      cs[1] = s[si + 1] / sa0;
      cs[2] = s[si + 2] / sa0;
      cb[0] = d[p] / ab;
      cb[1] = d[p + 1] / ab;
      cb[2] = d[p + 2] / ab;
      blendInto(mode, cb, cs, mix);
      const a1 = as * (1 - ab);
      const a2 = as * ab;
      d[p] = a1 * cs[0] + a2 * mix[0] + (1 - as) * d[p];
      d[p + 1] = a1 * cs[1] + a2 * mix[1] + (1 - as) * d[p + 1];
      d[p + 2] = a1 * cs[2] + a2 * mix[2] + (1 - as) * d[p + 2];
      d[p + 3] = as + ab * (1 - as);
    }
  }
}
