import type { ColorStop, Gradient, OpacityStop } from "../effects";
import { createRaster, type Raster } from "./raster";

// Gradient fills sampled into a raster, for gradient overlays and gradient strokes. Positions
// follow Photoshop's conventions: angle 0 runs left to right and 90 bottom to top, the
// gradient spans the box along its angle, and each stop's midpoint (0..1) is where the
// colour is halfway between the previous stop and this one.

/** "#rgb", "#rgba", "#rrggbb" or "#rrggbbaa" as straight 0..1 RGBA. */
export function parseHex(hex: string): [number, number, number, number] {
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), h.length >= 8 ? n(6) : 1];
}

/** Where t sits between two stops, bent so the halfway point lands on the midpoint. */
function segment(t: number, a: number, b: number, mid = 0.5) {
  const u = b > a ? (t - a) / (b - a) : 1;
  return u < mid ? (0.5 * u) / mid : 0.5 + (0.5 * (u - mid)) / (1 - mid);
}

/** Entries (minus one) of a gradient's colour table. */
export const GRADIENT_LUT = 1024;
const LUT = GRADIENT_LUT;

/** Colour (premultiplied by the opacity stops) at LUT+1 positions along the gradient. */
export function gradientLut(g: Gradient) {
  const colors = [...g.stops].sort((a, b) => a.offset - b.offset).map((s) => ({ ...s, rgba: parseHex(s.color) }));
  const ops: OpacityStop[] = g.opacityStops?.length
    ? [...g.opacityStops].sort((a, b) => a.offset - b.offset)
    : [
        { offset: 0, opacity: 1 },
        { offset: 1, opacity: 1 },
      ];
  const lut = new Float32Array((LUT + 1) * 4);
  for (let i = 0; i <= LUT; i++) {
    const t = i / LUT;
    const c = pick(colors, t);
    let rgba: number[];
    if (c.hi === c.lo) rgba = c.lo.rgba;
    else {
      const k = segment(t, c.lo.offset, c.hi.offset, c.hi.midpoint);
      rgba = c.lo.rgba.map((v, j) => v + (c.hi.rgba[j] - v) * k);
    }
    const o = pick(ops, t);
    const op = o.hi === o.lo ? o.lo.opacity : o.lo.opacity + (o.hi.opacity - o.lo.opacity) * segment(t, o.lo.offset, o.hi.offset, o.hi.midpoint);
    const a = rgba[3] * op;
    lut.set([rgba[0] * a, rgba[1] * a, rgba[2] * a, a], i * 4);
  }
  return lut;
}

/** The stops either side of t (the same stop twice past either end). */
function pick<T extends ColorStop | OpacityStop>(stops: T[], t: number): { lo: T; hi: T } {
  if (t <= stops[0].offset) return { lo: stops[0], hi: stops[0] };
  for (let i = 1; i < stops.length; i++) if (t <= stops[i].offset) return { lo: stops[i - 1], hi: stops[i] };
  const last = stops[stops.length - 1];
  return { lo: last, hi: last };
}

/**
 * Sample `g` over a `w`×`h` raster. `box` is the element box in element units, its top-left
 * at `origin` in raster pixels, with `ratio` raster pixels per element unit.
 */
export function sampleGradient(
  g: Gradient,
  box: { w: number; h: number },
  w: number,
  h: number,
  origin: { x: number; y: number } = { x: 0, y: 0 },
  ratio = 1,
): Raster {
  const out = createRaster(w, h);
  if (w < 1 || h < 1 || box.w <= 0 || box.h < 0) return out;
  const lut = gradientLut(g);
  const style = g.style ?? "linear";
  const scale = g.scale ?? 1;
  const theta = ((g.angle ?? 90) * Math.PI) / 180;
  const dx = Math.cos(theta);
  const dy = -Math.sin(theta); // y grows downwards
  const cx = box.w / 2 + (g.offset?.x ?? 0) * box.w;
  const cy = box.h / 2 + (g.offset?.y ?? 0) * box.h;
  // Length of the box along the gradient's direction.
  const len = Math.max(1e-6, Math.abs(box.w * dx) + Math.abs(box.h * dy)) * scale;
  const half = len / 2;
  const radius = Math.max(1e-6, Math.hypot(box.w, box.h) / 2) * scale;
  const d = out.data;
  for (let y = 0; y < h; y++) {
    const vy = (y + 0.5 - origin.y) / ratio - cy;
    for (let x = 0; x < w; x++) {
      const vx = (x + 0.5 - origin.x) / ratio - cx;
      const along = vx * dx + vy * dy;
      let t: number;
      switch (style) {
        case "radial":
          t = Math.hypot(vx, vy) / radius;
          break;
        case "angle": {
          // Counter-clockwise from the gradient's direction, one full turn.
          const a = Math.atan2(-vy, vx) - theta;
          t = (((a / (2 * Math.PI)) % 1) + 1) % 1;
          break;
        }
        case "reflected":
          t = Math.abs(along) / half;
          break;
        case "diamond":
          t = (Math.abs(along) + Math.abs(vx * -dy + vy * dx)) / half;
          break;
        default:
          t = along / len + 0.5;
      }
      if (g.reverse) t = 1 - t;
      const i = Math.round((t < 0 ? 0 : t > 1 ? 1 : t) * LUT) * 4;
      const p = (y * w + x) * 4;
      d[p] = lut[i];
      d[p + 1] = lut[i + 1];
      d[p + 2] = lut[i + 2];
      d[p + 3] = lut[i + 3];
    }
  }
  return out;
}
