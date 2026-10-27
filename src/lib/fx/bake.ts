// Layer effects canvas.me can't keep editable (bevel and emboss, satin, pattern overlay and
// pattern strokes, noise gradients), painted into a layer's pixels on import. These are our own
// approximations: ag-psd doesn't render effects. Effects below a baked one in Photoshop's stack
// are baked with it so the order stays right; effects above it stay editable.
import type {
  EffectNoiseGradient,
  ExtraGradientInfo,
  LayerEffectBevel,
  LayerEffectsInfo,
  LayerEffectStroke,
  PatternInfo,
} from "ag-psd";
import type { BlendMode, Effects, Gradient } from "../effects";
import type { ImportIssue } from "../model";
import { colorHex, PSD_TO_BLEND, psdEffectsToModel, unitsToPx, type FxContext } from "../importers/psdEffects";
import { compositeInto } from "./blend";
import { gaussianBlur } from "./blur";
import { signedDistance } from "./distance";
import { fxPaddingUnits, lightOffset, renderEffects, SIZE_TO_SIGMA } from "./effects";
import { parseHex, sampleGradient } from "./gradient";
import { alphaOf, createRaster, type Raster } from "./raster";

/** Largest padded layer we bake (the pipeline peaks around 50 bytes a pixel). */
export const MAX_BAKE_PIXELS = 6_000_000;

/** The layer, padded for its effects, is past MAX_BAKE_PIXELS. */
export class BakeTooLargeError extends Error {
  constructor() {
    super("Layer too large to bake its effects.");
    this.name = "BakeTooLargeError";
  }
}

/** Interior effects, bottom to top, as Photoshop stacks them (strokes and bevels drawn last). */
const BODY = ["patternOverlay", "gradientOverlay", "colorOverlay", "satin", "innerGlow", "innerShadow", "bevel", "stroke"] as const;
type BodyKind = (typeof BODY)[number];

export const FX_LABELS: Record<BodyKind | "dropShadow" | "outerGlow", string> = {
  patternOverlay: "Pattern overlay",
  gradientOverlay: "Gradient overlay",
  colorOverlay: "Colour overlay",
  satin: "Satin",
  innerGlow: "Inner glow",
  innerShadow: "Inner shadow",
  bevel: "Bevel & emboss",
  stroke: "Stroke",
  dropShadow: "Drop shadow",
  outerGlow: "Outer glow",
};

type RawFx = { enabled?: boolean; present?: boolean };
const on = (e: RawFx | undefined): boolean => !!e && e.present !== false && e.enabled !== false;
const anyOn = (e: RawFx | RawFx[] | undefined) => (Array.isArray(e) ? e.some(on) : on(e));
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const num = (v: number | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const blendOf = (m: string | undefined, d: BlendMode): BlendMode => {
  const b = m ? PSD_TO_BLEND[m as keyof typeof PSD_TO_BLEND] : undefined;
  return !b || b === "pass-through" ? d : b;
};
const rawOf = (fx: LayerEffectsInfo, k: BodyKind): RawFx | RawFx[] | undefined =>
  k === "colorOverlay" ? fx.solidFill : (fx as Record<string, RawFx | RawFx[] | undefined>)[k];
const unsupportedStroke = (s: LayerEffectStroke) => on(s) && (s.fillType === "pattern" || (s.fillType === "gradient" && s.gradient?.type === "noise"));

function bodyOrder(fx: LayerEffectsInfo): BodyKind[] {
  // Stroke emboss shapes the stroke, so it sits above it.
  return fx.bevel?.style === "stroke emboss" ? [...BODY.slice(0, 6), "stroke", "bevel"] : [...BODY];
}

/** The interior kinds to bake: everything up to the topmost unsupported one ([] if none). */
export function bodyOrderToBake(fx: LayerEffectsInfo): BodyKind[] {
  if (fx.disabled) return [];
  const order = bodyOrder(fx);
  const bad = (k: BodyKind) =>
    k === "patternOverlay" || k === "satin" || k === "bevel"
      ? on(rawOf(fx, k) as RawFx)
      : k === "gradientOverlay"
        ? !!fx.gradientOverlay?.some((g) => on(g) && g.gradient?.type === "noise")
        : k === "stroke"
          ? !!fx.stroke?.some(unsupportedStroke)
          : false;
  let top = -1;
  order.forEach((k, i) => bad(k) && (top = i));
  return order.slice(0, top + 1);
}

export type BakeOptions = FxContext & {
  fillOpacity: number;
  patterns?: PatternInfo[];
  seed: number;
  /** Document position of the content's top-left pixel (patterns tile from the document origin). */
  origin?: { x: number; y: number };
};
export type BakeResult = {
  raster: Raster;
  /** How far the baked pixels reach past the content on each side, in pixels. */
  pad: { l: number; t: number; r: number; b: number };
  /** Labels of the effects now in the pixels. */
  baked: string[];
  /** Effects that stay editable. */
  keep: Effects | undefined;
  /** Settings the bake could only approximate. */
  issues: ImportIssue[];
};

const copy = (r: Raster): Raster => ({ w: r.w, h: r.h, data: new Float32Array(r.data) });

function colorize(alpha: Float32Array, w: number, h: number, hex: string): Raster {
  const [r, g, b] = parseHex(hex);
  const out = createRaster(w, h);
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    const a = clamp01(alpha[i]);
    const d = out.data;
    d[p] = r * a;
    d[p + 1] = g * a;
    d[p + 2] = b * a;
    d[p + 3] = a;
  }
  return out;
}

function shift(ch: Float32Array, w: number, h: number, dx: number, dy: number) {
  const sx = Math.round(dx);
  const sy = Math.round(dy);
  const out = new Float32Array(w * h);
  for (let y = Math.max(0, sy); y < Math.min(h, h + sy); y++)
    for (let x = Math.max(0, sx); x < Math.min(w, w + sx); x++) out[y * w + x] = ch[(y - sy) * w + x - sx];
  return out;
}

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A noise gradient as a smooth ramp of seeded random colours between its per-channel limits. */
function noiseGradient(g: EffectNoiseGradient, extra: ExtraGradientInfo & { style?: Gradient["style"] }, seed: number): Gradient {
  const lim = (v: number[] | undefined, d: number) => [0, 1, 2].map((i) => {
    const x = num(v?.[i], d);
    return clamp01(x > 1 ? x / 100 : x);
  });
  const lo = lim(g.min, 0);
  const hi = lim(g.max, 1);
  const rand = rng(num(g.randomSeed, seed));
  const N = 12;
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  const stops = Array.from({ length: N + 1 }, (_, i) => ({
    offset: i / N,
    color: `#${[0, 1, 2].map((c) => hex(lo[c] + rand() * (hi[c] - lo[c]))).join("")}`,
  }));
  return {
    style: extra.style ?? "linear",
    stops,
    angle: num(extra.angle, 90),
    scale: Math.min(10, Math.max(0.1, num(extra.scale, 1))),
    reverse: !!extra.reverse,
    ...(extra.offset ? { offset: extra.offset } : {}),
  };
}

/** The pattern tiled over the raster in document space, or null when the file doesn't hold it. */
function tile(p: PatternInfo | undefined, w: number, h: number, ox: number, oy: number, scale: number, phase = { x: 0, y: 0 }) {
  if (!p || p.bounds.w < 1 || p.bounds.h < 1) return null;
  const pw = p.bounds.w;
  const ph = p.bounds.h;
  const s = scale > 0 ? scale : 1;
  const out = createRaster(w, h);
  for (let y = 0; y < h; y++) {
    const v = ((Math.floor((oy + y - phase.y) / s) % ph) + ph) % ph;
    for (let x = 0; x < w; x++) {
      const u = ((Math.floor((ox + x - phase.x) / s) % pw) + pw) % pw;
      const i = (v * pw + u) * 4;
      const a = p.data[i + 3] / 255;
      const o = (y * w + x) * 4;
      out.data[o] = (p.data[i] / 255) * a;
      out.data[o + 1] = (p.data[i + 1] / 255) * a;
      out.data[o + 2] = (p.data[i + 2] / 255) * a;
      out.data[o + 3] = a;
    }
  }
  return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Bevel and emboss shading: a height field from the distance to the edge, its normals lit by a
 * light at (angle, altitude). Returns highlight and shadow strengths (0..1) and where they apply.
 */
function bevelShade(alpha: Float32Array, w: number, h: number, b: LayerEffectBevel, o: FxContext, k: number) {
  const s = Math.max(1, unitsToPx(b.size, o.dpi) * k);
  const style = b.style ?? "inner bevel";
  const tech = b.technique ?? "smooth";
  const f = tech === "chisel hard" ? (t: number) => t : smooth;
  const d = signedDistance(alpha, w, h);
  let H = new Float32Array(w * h);
  const depth = s * Math.max(0.01, num(b.strength, 1));
  for (let i = 0; i < H.length; i++) {
    const di = d[i];
    const t =
      style === "outer bevel"
        ? di >= 0 ? 1 - di / s : 1
        : style === "emboss"
          ? (s - di) / (2 * s)
          : style === "pillow emboss"
            ? Math.abs(di) / s
            : di <= 0 ? -di / s : 0;
    H[i] = f(clamp01(t)) * depth;
  }
  const soften = unitsToPx(b.soften, o.dpi) * k;
  const sigma = tech === "chisel soft" ? Math.max(1, soften) : soften;
  if (sigma > 0.3) H = gaussianBlur(H, w, h, sigma) as Float32Array<ArrayBuffer>;
  const theta = (((b.useGlobalLight ? o.globalAngle : num(b.angle, o.globalAngle)) + (b.direction === "down" ? 180 : 0)) * Math.PI) / 180;
  const alt = (Math.min(90, Math.max(0, num(b.altitude, 30))) * Math.PI) / 180;
  const lx = Math.cos(alt) * Math.cos(theta);
  const ly = -Math.cos(alt) * Math.sin(theta);
  const lz = Math.sin(alt);
  const hi = new Float32Array(w * h);
  const sh = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = (H[x < w - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i]) / 2;
      const gy = (H[y < h - 1 ? i + w : i] - H[y > 0 ? i - w : i]) / 2;
      const len = Math.hypot(gx, gy, 1);
      const delta = (-gx * lx - gy * ly + lz) / len - lz;
      hi[i] = clamp01(delta / Math.max(0.05, 1 - lz));
      sh[i] = clamp01(-delta / Math.max(0.05, lz));
    }
  const outside = new Float32Array(w * h);
  if (style !== "inner bevel" && style !== "stroke emboss") for (let i = 0; i < d.length; i++) outside[i] = d[i] < s ? clamp01(d[i] + 0.5) : 0;
  return { hi, sh, outside, reach: style === "inner bevel" || style === "stroke emboss" ? 0 : Math.ceil(s) + 2 };
}

/** Paint the bevel's highlight and shadow onto `dst`, each optionally masked. */
function paintBevel(dst: Raster, b: LayerEffectBevel, shade: { hi: Float32Array; sh: Float32Array }, mask: Float32Array | undefined, seed: number) {
  const { w, h } = dst;
  compositeInto(dst, colorize(shade.hi, w, h, colorHex(b.highlightColor ?? { r: 255, g: 255, b: 255 })), blendOf(b.highlightBlendMode, "screen"), clamp01(num(b.highlightOpacity, 0.75)), mask, undefined, seed);
  compositeInto(dst, colorize(shade.sh, w, h, colorHex(b.shadowColor ?? { r: 0, g: 0, b: 0 })), blendOf(b.shadowBlendMode, "multiply"), clamp01(num(b.shadowOpacity, 0.75)), mask, undefined, seed);
}

/** Bake the unsupported effects (and those below them) into `content` (premultiplied, unpadded). */
export function bakeEffects(content: Raster, fx: LayerEffectsInfo, o: BakeOptions): BakeResult {
  const ctx = { dpi: o.dpi, globalAngle: o.globalAngle };
  const k = num(fx.scale, 1) > 0 ? num(fx.scale, 1) : 1;
  const model = psdEffectsToModel(fx, ctx).effects ?? {};
  const fill = clamp01(o.fillOpacity);
  let kinds = bodyOrderToBake(fx);
  const all = fill < 1 && kinds.length > 0;
  if (all) kinds = bodyOrder(fx);
  kinds = kinds.filter((kind) => anyOn(rawOf(fx, kind)));
  const issues: ImportIssue[] = [];
  const baked = kinds.map((kind) => FX_LABELS[kind]);

  // Padding: strokes and outer bevels reach outside; with everything baked, so do shadows and glows.
  let reach = 0;
  for (const s of kinds.includes("stroke") ? (fx.stroke ?? []).filter(on) : []) {
    const size = unitsToPx(s.size, o.dpi) * k;
    reach = Math.max(reach, s.position === "inside" ? 0 : (s.position === "center" ? size / 2 : size) + 1);
  }
  const bevel = kinds.includes("bevel") ? fx.bevel! : undefined;
  if (bevel && bevel.style && !["inner bevel", "stroke emboss"].includes(bevel.style)) reach += Math.ceil(unitsToPx(bevel.size, o.dpi) * k) + 2;
  // Edge-based effects need one empty pixel round the shape to find its edge at the layer bounds.
  if (kinds.some((kind) => kind === "bevel" || kind === "innerGlow" || kind === "innerShadow")) reach = Math.max(reach, 1);
  const outer: Effects = all ? { dropShadow: model.dropShadow, outerGlow: model.outerGlow } : {};
  if (all) {
    if (fx.dropShadow?.some(on)) baked.push(FX_LABELS.dropShadow);
    if (on(fx.outerGlow)) baked.push(FX_LABELS.outerGlow);
  }
  const op = fxPaddingUnits(outer);
  const r = Math.ceil(reach);
  const pad = { l: Math.ceil(Math.max(r, op.l)), t: Math.ceil(Math.max(r, op.t)), r: Math.ceil(Math.max(r, op.r)), b: Math.ceil(Math.max(r, op.b)) };
  const W = content.w + pad.l + pad.r;
  const Hh = content.h + pad.t + pad.b;
  if (W * Hh > MAX_BAKE_PIXELS) throw new BakeTooLargeError();

  const padded = createRaster(W, Hh);
  for (let y = 0; y < content.h; y++) padded.data.set(content.data.subarray(y * content.w * 4, (y + 1) * content.w * 4), ((y + pad.t) * W + pad.l) * 4);
  const A = alphaOf(padded);
  const box = { x: pad.l, y: pad.t, w: content.w, h: content.h };
  const fopts = { ratio: 1, fillOpacity: 0, box, seed: o.seed };
  const ox = (o.origin?.x ?? 0) - pad.l;
  const oy = (o.origin?.y ?? 0) - pad.t;
  /** One effect alone, in the layer's final space (interior ones already masked by A). */
  const isolated = (e: Effects) => renderEffects(copy(padded), e, fopts).body;
  const toRel = (L: Raster) => {
    for (let i = 0, p = 0; i < A.length; i++, p += 4) {
      const m = A[i] > 0 ? 1 / A[i] : 0;
      for (let c = 0; c < 4; c++) L.data[p + c] *= m;
    }
    return L;
  };
  const plain = <T extends { blendMode?: BlendMode; opacity?: number }>(e: T) => ({ ...e, blendMode: "normal" as const, opacity: 1 });

  // Shape-relative body: the content's colour at the fill opacity's strength (see effects.ts).
  const rel = copy(padded);
  for (let i = 0, p = 0; i < A.length; i++, p += 4) {
    const a = A[i];
    const m = a > 0 ? fill / a : 0;
    rel.data[p] *= m;
    rel.data[p + 1] *= m;
    rel.data[p + 2] *= m;
    rel.data[p + 3] = a > 0 ? fill : 0;
  }
  const late: (() => void)[] = [];
  let body: Raster = rel;
  const paintGradient = (g: Gradient) => sampleGradient(g, { w: content.w, h: content.h }, W, Hh, box, 1);

  for (const kind of kinds) {
    switch (kind) {
      case "patternOverlay": {
        const p = fx.patternOverlay!;
        let t = tile(o.patterns?.find((x) => x.id === p.pattern?.id), W, Hh, ox, oy, num(p.scale, 1), p.phase);
        if (!t) {
          issues.push({ kind: "approximated", message: `Pattern "${(p.pattern?.name ?? "").slice(0, 60)}" isn't in the file; grey was used.` });
          t = colorize(new Float32Array(W * Hh).fill(1), W, Hh, "#808080");
        }
        compositeInto(rel, t, blendOf(p.blendMode, "normal"), clamp01(num(p.opacity, 1)), undefined, undefined, o.seed);
        break;
      }
      case "gradientOverlay":
        for (const g of (fx.gradientOverlay ?? []).filter(on)) {
          const extra = { style: g.type, angle: g.angle, scale: g.scale, reverse: g.reverse, offset: g.offset };
          let grad: Gradient | undefined;
          if (g.gradient?.type === "noise") {
            grad = noiseGradient(g.gradient, extra, o.seed);
            issues.push({ kind: "approximated", message: "Noise gradient drawn as a random colour ramp." });
          } else {
            grad = psdEffectsToModel({ gradientOverlay: [g] }, ctx).effects?.gradientOverlay?.[0].gradient;
          }
          if (grad) compositeInto(rel, paintGradient(grad), blendOf(g.blendMode, "normal"), clamp01(num(g.opacity, 1)), undefined, undefined, o.seed);
        }
        break;
      case "colorOverlay":
        for (const c of (model.colorOverlay ?? []).filter(on)) {
          compositeInto(rel, colorize(new Float32Array(W * Hh).fill(1), W, Hh, c.color), c.blendMode ?? "normal", c.opacity ?? 1, undefined, undefined, o.seed);
        }
        break;
      case "satin": {
        const s = fx.satin!;
        const size = unitsToPx(s.size, o.dpi) * k;
        const { dx, dy } = lightOffset(num(s.angle, 19), unitsToPx(s.distance, o.dpi) * k);
        const sig = size * SIZE_TO_SIGMA;
        const a1 = gaussianBlur(shift(A, W, Hh, dx, dy), W, Hh, sig);
        const a2 = gaussianBlur(shift(A, W, Hh, -dx, -dy), W, Hh, sig);
        const v = new Float32Array(W * Hh);
        for (let i = 0; i < v.length; i++) v[i] = s.invert ? 1 - Math.abs(a1[i] - a2[i]) : Math.abs(a1[i] - a2[i]);
        compositeInto(rel, colorize(v, W, Hh, colorHex(s.color)), blendOf(s.blendMode, "multiply"), clamp01(num(s.opacity, 1)), undefined, undefined, o.seed);
        break;
      }
      case "innerGlow":
        if (on(model.innerGlow)) {
          const g = model.innerGlow!;
          compositeInto(rel, toRel(isolated({ innerGlow: plain(g) })), g.blendMode ?? "normal", g.opacity ?? 1, undefined, undefined, o.seed);
        }
        break;
      case "innerShadow":
        for (const s of (model.innerShadow ?? []).filter(on)) {
          compositeInto(rel, toRel(isolated({ innerShadow: [plain(s)] })), s.blendMode ?? "normal", s.opacity ?? 1, undefined, undefined, o.seed);
        }
        break;
      case "bevel": {
        const b = fx.bevel!;
        if (b.useTexture) issues.push({ kind: "approximated", message: "Bevel texture was left out." });
        if (b.style === "stroke emboss") {
          // Shapes the layer with its strokes, so it runs once they're painted.
          late.push(() => paintBevel(body, b, bevelShade(alphaOf(body), W, Hh, b, ctx, k), undefined, o.seed));
          break;
        }
        const shade = bevelShade(A, W, Hh, b, ctx, k);
        paintBevel(rel, b, shade, undefined, o.seed);
        if (b.style && b.style !== "inner bevel") late.push(() => paintBevel(body, b, shade, shade.outside, o.seed));
        break;
      }
      case "stroke":
        late.push(() => {
          for (const s of (fx.stroke ?? []).filter(on)) {
            // An unsupported stroke's band comes from a white stroke, then takes the pattern or ramp.
            const asColor: LayerEffectStroke = unsupportedStroke(s) ? { ...s, fillType: "color", color: { r: 255, g: 255, b: 255 } } : s;
            const m = psdEffectsToModel({ scale: fx.scale, stroke: [asColor] }, ctx).effects?.stroke?.[0];
            if (!m) continue;
            let L = isolated({ stroke: [plain(m)] });
            if (unsupportedStroke(s)) {
              const cov = alphaOf(L);
              let paint: Raster | null;
              if (s.fillType === "pattern") {
                paint = tile(o.patterns?.find((x) => x.id === s.pattern?.id), W, Hh, ox, oy, 1);
                if (!paint) {
                  issues.push({ kind: "approximated", message: `Pattern "${(s.pattern?.name ?? "").slice(0, 60)}" isn't in the file; grey was used.` });
                  paint = colorize(new Float32Array(W * Hh).fill(1), W, Hh, "#808080");
                }
              } else {
                paint = paintGradient(noiseGradient(s.gradient as EffectNoiseGradient, s.gradient ?? {}, o.seed));
                issues.push({ kind: "approximated", message: "Noise gradient drawn as a random colour ramp." });
              }
              for (let i = 0, p = 0; i < cov.length; i++, p += 4) for (let c = 0; c < 4; c++) paint.data[p + c] *= cov[i];
              L = paint;
            }
            compositeInto(body, L, m.blendMode ?? "normal", m.opacity ?? 1, undefined, undefined, o.seed);
          }
        });
        break;
    }
  }
  // Back to final space, then what sits on top unmasked: outer bevel bands, strokes, stroke emboss.
  for (let i = 0, p = 0; i < A.length; i++, p += 4) for (let c = 0; c < 4; c++) rel.data[p + c] *= A[i];
  body = rel;
  for (const step of late) step();

  if (all && (outer.dropShadow?.length || outer.outerGlow)) {
    const parts = renderEffects(copy(padded), outer, { ...fopts, fillOpacity: 1, parts: "outer" }).outer;
    const out = createRaster(W, Hh);
    for (const part of parts) compositeInto(out, part.raster, part.blend, part.opacity, undefined, undefined, o.seed);
    compositeInto(out, body, "normal", 1);
    body = out;
    issues.push({ kind: "approximated", message: "Fill opacity was below 100%, so shadows and glows were baked too and no longer blend with layers below." });
  }

  let keep: Effects | undefined;
  if (!all) {
    const k2: Effects = { ...model };
    for (const kind of kinds) if (kind in k2) delete k2[kind as keyof Effects];
    keep = Object.keys(k2).some((key) => k2[key as keyof Effects] !== undefined) ? k2 : undefined;
  }
  return { raster: body, pad, baked, keep, issues };
}
