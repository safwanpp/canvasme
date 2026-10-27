// Mapping between ag-psd's layer effects and the model's (src/lib/effects.ts), both ways.
// Units follow the "P0 findings" in docs/plans/psd-effects.md: ag-psd already turns percent
// fields into fractions and gradient stop locations into 0..1, so nothing here divides again.
import type {
  BlendMode as PsdBlendMode,
  Color as PsdColor,
  EffectContour,
  EffectNoiseGradient,
  EffectSolidGradient,
  ExtraGradientInfo,
  LayerEffectsInfo,
  LayerEffectShadow,
  UnitsValue,
} from "ag-psd";
import type {
  BlendMode,
  Contour,
  Effects,
  Glow,
  Gradient,
  InnerGlow,
  InnerShadow,
  Shadow,
  StrokeFx,
} from "../effects";

/**
 * ag-psd's gradient stop `location` is already 0..1 (file Lctn / Intr). Kept as a named
 * constant so the real-file check (deferred: needs a real Photoshop file) has one place to change.
 */
export const AG_PSD_LOCATION_SCALE = 1;

export const PSD_TO_BLEND: Record<PsdBlendMode, BlendMode> = {
  "pass through": "pass-through",
  normal: "normal",
  dissolve: "dissolve",
  darken: "darken",
  multiply: "multiply",
  "color burn": "color-burn",
  "linear burn": "linear-burn",
  "darker color": "darker-color",
  lighten: "lighten",
  screen: "screen",
  "color dodge": "color-dodge",
  "linear dodge": "linear-dodge",
  "lighter color": "lighter-color",
  overlay: "overlay",
  "soft light": "soft-light",
  "hard light": "hard-light",
  "vivid light": "vivid-light",
  "linear light": "linear-light",
  "pin light": "pin-light",
  "hard mix": "hard-mix",
  difference: "difference",
  exclusion: "exclusion",
  subtract: "subtract",
  subtraction: "subtract",
  divide: "divide",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
  // 3D-only modes with no 2D meaning.
  "linear height": "normal",
  height: "normal",
};

export const BLEND_TO_PSD = Object.fromEntries(
  Object.entries(PSD_TO_BLEND)
    .filter(([psd]) => psd !== "subtraction" && psd !== "linear height" && psd !== "height")
    .map(([psd, model]) => [model, psd]),
) as Record<BlendMode, PsdBlendMode>;

const APPROX_BLENDS = new Set(["linear height", "height"]);

/**
 * A layer's blend mode for the model: undefined for normal (and pass through, which only means
 * something on a group). `approximated` when the mode has no 2D equivalent.
 */
/** The model blend for a PSD name; own keys only, so "constructor" and friends are not modes. */
const psdBlend = (mode: string): BlendMode | undefined =>
  Object.hasOwn(PSD_TO_BLEND, mode) ? PSD_TO_BLEND[mode as PsdBlendMode] : undefined;

export function mapBlendMode(mode: string | undefined): { mode?: BlendMode; approximated?: true } {
  if (!mode) return {};
  if (APPROX_BLENDS.has(mode)) return { approximated: true };
  const m = psdBlend(mode);
  if (!m) return { approximated: true };
  return m === "normal" || m === "pass-through" ? {} : { mode: m };
}

const fxBlend = (mode: string | undefined, fallback: BlendMode): BlendMode => {
  if (!mode) return fallback;
  const m = psdBlend(mode);
  return !m || m === "pass-through" ? "normal" : m;
};

const hex2 = (n: number) =>
  Math.round(Number.isNaN(n) ? 0 : Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, "0");
const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
/** Percent (0..100) or byte (0..255) ink to 0..1 coverage, with non-numbers as no ink. */
const ink = (v: number | undefined, full: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v / full)) : 0);
const cmykHex = (c: { c: number; m: number; y: number; k: number }, full: number) => {
  const k = 1 - ink(c.k, full);
  return rgbHex(255 * (1 - ink(c.c, full)) * k, 255 * (1 - ink(c.m, full)) * k, 255 * (1 - ink(c.y, full)) * k);
};

/**
 * A colour from an effect or gradient descriptor. Descriptor CMYK and grey are percent ink
 * (0..100, 0 is white); RGB is 0..255 and float RGB 0..1.
 */
export function colorHex(c: PsdColor | undefined): string {
  if (!c) return "#000000";
  if ("r" in c) return rgbHex(c.r, c.g, c.b);
  if ("fr" in c) return rgbHex(c.fr * 255, c.fg * 255, c.fb * 255);
  if ("k" in c && "c" in c) return cmykHex(c, 100);
  if ("k" in c) {
    const v = 255 * (1 - ink(c.k, 100));
    return rgbHex(v, v, v);
  }
  return "#000000";
}

/**
 * A colour from a text layer's engine data, which ag-psd scales to 0..255: CMYK is ink
 * (255 is full), grey is the grey level (0 black, 255 white).
 */
export function textColorHex(c: PsdColor | undefined): string {
  if (!c) return "#000000";
  if ("k" in c && "c" in c) return cmykHex(c, 255);
  if ("k" in c) return rgbHex(c.k, c.k, c.k);
  return colorHex(c);
}

export const rgbOf = (hex: string) => {
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map((x) => x + x).join("");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
};

/** A length in pixels: Points are 1/72 inch, so they scale with the file's resolution. */
export function unitsToPx(u: UnitsValue | undefined, dpi: number): number {
  if (!u || !Number.isFinite(u.value)) return 0;
  if (u.units === "Points") return (u.value * dpi) / 72;
  return u.value;
}

/** Why an effect can't stay editable (it gets baked into the pixels instead). */
export type UnsupportedFx = "bevel" | "satin" | "patternOverlay" | "patternStroke" | "noiseGradient";
/** Kept editable, but some of its settings have no equivalent here. */
export type ApproximatedFx = "glowNoise";

export type FxContext = { dpi: number; globalAngle: number };

/** NaN (from a broken file) clamps to `lo`; infinities clamp to the nearer end. */
const clamp = (v: number, lo: number, hi: number) => (Number.isNaN(v) ? lo : v < lo ? lo : v > hi ? hi : v);
const num = (v: number | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const frac = (v: number | undefined, d: number) => clamp(num(v, d), 0, 1);
/** Effect sizes are capped at Photoshop's 250 px. */
const size = (v: number) => clamp(v, 0, 250);
const live = <T extends { enabled?: boolean; present?: boolean }>(fx: T | undefined): fx is T => !!fx && fx.present !== false;
const isOn = (fx: { enabled?: boolean } | undefined) => !!fx && fx.enabled !== false;

function contourOf(c: EffectContour | undefined): Contour | undefined {
  const pts = c?.curve?.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts || pts.length < 2) return undefined;
  if (pts.every((p) => Math.abs(p.x - p.y) < 0.5)) return undefined; // linear
  const out = pts.slice(0, 32).map((p) => ({ x: clamp(p.x / 255, 0, 1), y: clamp(p.y / 255, 0, 1) }));
  return out;
}

const contourToPsd = (c: Contour | undefined): EffectContour | undefined =>
  c ? { name: "Custom", curve: c.map((p) => ({ x: Math.round(p.x * 255), y: Math.round(p.y * 255) })) } : undefined;

const midpointOf = (m: number | undefined) => {
  if (m === undefined || !Number.isFinite(m) || Math.abs(m - 0.5) < 1e-3) return undefined;
  return clamp(m, 0.05, 0.95);
};

/** A solid gradient for the model, or null for a noise gradient (baked instead). */
export function psdGradientToModel(
  g: EffectSolidGradient | EffectNoiseGradient | undefined,
  extra: ExtraGradientInfo & { style?: Gradient["style"] },
): Gradient | null {
  if (!g || g.type !== "solid") return null;
  const loc = (s: { location: number }) => num(s.location, 0);
  const raw = [...(g.colorStops ?? [])].sort((a, b) => loc(a) - loc(b)).slice(0, 32);
  if (!raw.length) raw.push({ color: { r: 0, g: 0, b: 0 }, location: 0, midpoint: 0.5 });
  if (raw.length === 1) raw.push({ ...raw[0], location: 1 });
  const stops = raw.map((s, i) => {
    const stop: Gradient["stops"][number] = { offset: clamp(loc(s) * AG_PSD_LOCATION_SCALE, 0, 1), color: colorHex(s.color) };
    const m = i > 0 ? midpointOf(s.midpoint) : undefined;
    if (m !== undefined) stop.midpoint = m;
    return stop;
  });
  const ops = [...(g.opacityStops ?? [])].sort((a, b) => loc(a) - loc(b)).slice(0, 32);
  const out: Gradient = {
    style: extra.style ?? "linear",
    stops,
    angle: num(extra.angle, 90),
    scale: clamp(num(extra.scale, 1), 0.1, 10),
    reverse: !!extra.reverse,
  };
  if (ops.some((o) => o.opacity < 1)) {
    out.opacityStops = ops.map((o, i) => {
      const stop: NonNullable<Gradient["opacityStops"]>[number] = { offset: clamp(loc(o) * AG_PSD_LOCATION_SCALE, 0, 1), opacity: frac(o.opacity, 1) };
      const m = i > 0 ? midpointOf(o.midpoint) : undefined;
      if (m !== undefined) stop.midpoint = m;
      return stop;
    });
  }
  const ox = num(extra.offset?.x, 0);
  const oy = num(extra.offset?.y, 0);
  if (ox || oy) out.offset = { x: ox, y: oy };
  return out;
}

export function modelGradientToPsd(g: Gradient): EffectSolidGradient & ExtraGradientInfo {
  const ops = g.opacityStops?.length
    ? g.opacityStops
    : [
        { offset: 0, opacity: 1 },
        { offset: 1, opacity: 1 },
      ];
  return {
    name: "Custom",
    type: "solid",
    smoothness: 1,
    colorStops: g.stops.map((s) => ({ color: rgbOf(s.color), location: s.offset / AG_PSD_LOCATION_SCALE, midpoint: s.midpoint ?? 0.5 })),
    opacityStops: ops.map((s) => ({ opacity: s.opacity, location: s.offset / AG_PSD_LOCATION_SCALE, midpoint: s.midpoint ?? 0.5 })),
    style: g.style ?? "linear",
    angle: g.angle ?? 90,
    scale: g.scale ?? 1,
    reverse: !!g.reverse,
    ...(g.offset ? { offset: { ...g.offset } } : {}),
  };
}

/**
 * ag-psd's effects for the model. Unsupported kinds come back in `unsupported` (to bake);
 * `approximated` lists settings dropped from effects that stay editable.
 */
export function psdEffectsToModel(
  fx: LayerEffectsInfo | undefined,
  ctx: FxContext,
): { effects?: Effects; unsupported: UnsupportedFx[]; approximated: ApproximatedFx[] } {
  const unsupported = new Set<UnsupportedFx>();
  const approximated = new Set<ApproximatedFx>();
  if (!fx) return { unsupported: [], approximated: [] };
  const all = fx.disabled ? false : undefined;
  const k = num(fx.scale, 1) > 0 ? num(fx.scale, 1) : 1;
  const len = (u: UnitsValue | undefined) => unitsToPx(u, ctx.dpi) * k;
  const enabled = (e: { enabled?: boolean }) => all ?? e.enabled !== false;
  const angleOf = (e: LayerEffectShadow) => (e.useGlobalLight ? ctx.globalAngle : num(e.angle, ctx.globalAngle));
  const out: Effects = {};

  const shadow = (e: LayerEffectShadow): Shadow => {
    const s: Shadow = {
      enabled: enabled(e),
      blendMode: fxBlend(e.blendMode, "multiply"),
      opacity: frac(e.opacity, 1),
      color: colorHex(e.color),
      angle: angleOf(e),
      distance: clamp(len(e.distance), 0, 30000),
      size: size(len(e.size)),
      spread: frac(num(e.choke?.value, 0) / 100, 0),
      knockout: e.layerConceals !== false,
    };
    const c = contourOf(e.contour);
    if (c) s.contour = c;
    return s;
  };
  const drop = fx.dropShadow?.filter(live);
  if (drop?.length) out.dropShadow = drop.slice(0, 10).map(shadow);
  const inner = fx.innerShadow?.filter(live);
  if (inner?.length) {
    out.innerShadow = inner.slice(0, 10).map((e) => {
      const { spread, knockout, ...rest } = shadow(e);
      void knockout;
      return { ...rest, choke: spread } satisfies InnerShadow;
    });
  }
  if (live(fx.outerGlow)) {
    const e = fx.outerGlow;
    const g: Glow = {
      enabled: enabled(e),
      blendMode: fxBlend(e.blendMode, "screen"),
      opacity: frac(e.opacity, 1),
      color: colorHex(e.color),
      size: size(len(e.size)),
      spread: frac(num(e.choke?.value, 0) / 100, 0),
      // Not in ag-psd's outer glow type, but its generic descriptor parser reads GlwT into it.
      technique: (e as { technique?: string }).technique === "precise" ? "precise" : "softer",
    };
    const c = contourOf(e.contour);
    if (c) g.contour = c;
    out.outerGlow = g;
    if (isOn(e) && (num(e.noise, 0) > 0 || num(e.jitter, 0) > 0 || Math.abs(num(e.range, 0.5) - 0.5) > 0.01)) approximated.add("glowNoise");
  }
  if (live(fx.innerGlow)) {
    const e = fx.innerGlow;
    const g: InnerGlow = {
      enabled: enabled(e),
      blendMode: fxBlend(e.blendMode, "screen"),
      opacity: frac(e.opacity, 1),
      color: colorHex(e.color),
      size: size(len(e.size)),
      choke: frac(num(e.choke?.value, 0) / 100, 0),
      technique: e.technique === "precise" ? "precise" : "softer",
      source: e.source === "center" ? "center" : "edge",
    };
    const c = contourOf(e.contour);
    if (c) g.contour = c;
    out.innerGlow = g;
    if (isOn(e) && (num(e.noise, 0) > 0 || num(e.jitter, 0) > 0 || Math.abs(num(e.range, 0.5) - 0.5) > 0.01)) approximated.add("glowNoise");
  }
  const strokes: StrokeFx[] = [];
  for (const e of fx.stroke?.filter(live) ?? []) {
    const base = {
      enabled: enabled(e),
      blendMode: fxBlend(e.blendMode, "normal"),
      opacity: frac(e.opacity, 1),
      size: size(len(e.size)),
      position: e.position ?? "outside",
    } as const;
    if (e.fillType === "pattern") {
      if (base.enabled) unsupported.add("patternStroke");
      continue;
    }
    if (e.fillType === "gradient") {
      const g = psdGradientToModel(e.gradient, e.gradient ?? {});
      if (!g) {
        if (base.enabled) unsupported.add("noiseGradient");
        continue;
      }
      strokes.push({ ...base, paint: { type: "gradient", gradient: g } });
      continue;
    }
    strokes.push({ ...base, paint: { type: "color", color: colorHex(e.color) } });
  }
  if (strokes.length) out.stroke = strokes.slice(0, 10);
  const fills = fx.solidFill?.filter(live);
  if (fills?.length) {
    out.colorOverlay = fills.slice(0, 10).map((e) => ({
      enabled: enabled(e),
      blendMode: fxBlend(e.blendMode, "normal"),
      opacity: frac(e.opacity, 1),
      color: colorHex(e.color),
    }));
  }
  const grads: NonNullable<Effects["gradientOverlay"]> = [];
  for (const e of fx.gradientOverlay?.filter(live) ?? []) {
    const g = psdGradientToModel(e.gradient, { style: e.type, angle: e.angle, scale: e.scale, reverse: e.reverse, offset: e.offset });
    if (!g) {
      if (enabled(e)) unsupported.add("noiseGradient");
      continue;
    }
    grads.push({ enabled: enabled(e), blendMode: fxBlend(e.blendMode, "normal"), opacity: frac(e.opacity, 1), gradient: g, alignWithLayer: e.align !== false });
  }
  if (grads.length) out.gradientOverlay = grads.slice(0, 10);
  if (live(fx.bevel) && enabled(fx.bevel)) unsupported.add("bevel");
  if (live(fx.satin) && enabled(fx.satin)) unsupported.add("satin");
  if (live(fx.patternOverlay) && enabled(fx.patternOverlay)) unsupported.add("patternOverlay");

  return {
    effects: Object.keys(out).length ? out : undefined,
    unsupported: [...unsupported],
    approximated: [...approximated],
  };
}

const pxUnits = (value: number): UnitsValue => ({ units: "Pixels", value });

/** The model's effects for ag-psd. `enabled` is always written: ag-psd reads a missing one as off. */
export function modelEffectsToPsd(fx: Effects | undefined): LayerEffectsInfo | undefined {
  if (!fx) return undefined;
  const out: LayerEffectsInfo = {};
  const common = (e: { enabled?: boolean; blendMode?: BlendMode; opacity?: number }) => ({
    enabled: e.enabled !== false,
    blendMode: BLEND_TO_PSD[e.blendMode ?? "normal"],
    opacity: e.opacity ?? 1,
  });
  const shadow = (s: Shadow | InnerShadow, choke: number): LayerEffectShadow => ({
    ...common(s),
    color: rgbOf(s.color),
    angle: s.angle,
    useGlobalLight: false,
    distance: pxUnits(s.distance),
    size: pxUnits(s.size),
    choke: pxUnits(choke * 100),
    ...(s.contour ? { contour: contourToPsd(s.contour) } : {}),
  });
  if (fx.dropShadow?.length) out.dropShadow = fx.dropShadow.map((s) => ({ ...shadow(s, s.spread ?? 0), layerConceals: s.knockout !== false }));
  if (fx.innerShadow?.length) out.innerShadow = fx.innerShadow.map((s) => shadow(s, s.choke ?? 0));
  if (fx.outerGlow) {
    const g = fx.outerGlow;
    out.outerGlow = {
      ...common(g),
      color: rgbOf(g.color),
      size: pxUnits(g.size),
      choke: pxUnits((g.spread ?? 0) * 100),
      ...(g.contour ? { contour: contourToPsd(g.contour) } : {}),
    };
    // ag-psd's outer glow type has no technique field, but its descriptor carries one.
    (out.outerGlow as { technique?: string }).technique = g.technique ?? "softer";
  }
  if (fx.innerGlow) {
    const g = fx.innerGlow;
    out.innerGlow = {
      ...common(g),
      color: rgbOf(g.color),
      size: pxUnits(g.size),
      choke: pxUnits((g.choke ?? 0) * 100),
      technique: g.technique ?? "softer",
      source: g.source ?? "edge",
      ...(g.contour ? { contour: contourToPsd(g.contour) } : {}),
    };
  }
  if (fx.stroke?.length) {
    out.stroke = fx.stroke.map((s) => ({
      ...common(s),
      size: pxUnits(s.size),
      position: s.position ?? "outside",
      ...(s.paint.type === "color"
        ? { fillType: "color" as const, color: rgbOf(s.paint.color) }
        : { fillType: "gradient" as const, gradient: modelGradientToPsd(s.paint.gradient) }),
    }));
  }
  if (fx.colorOverlay?.length) out.solidFill = fx.colorOverlay.map((c) => ({ ...common(c), color: rgbOf(c.color) }));
  if (fx.gradientOverlay?.length) {
    out.gradientOverlay = fx.gradientOverlay.map((g) => {
      const { style, angle, scale, reverse, offset, ...gradient } = modelGradientToPsd(g.gradient);
      return { ...common(g), type: style, angle, scale, reverse, offset: offset ?? { x: 0, y: 0 }, align: g.alignWithLayer !== false, gradient };
    });
  }
  return out;
}

/** Effects with every length (sizes, distances) multiplied by `s`; spreads and opacities stay. */
export function scaleEffects(fx: Effects | undefined, s: number): Effects | undefined {
  if (!fx || s === 1) return fx;
  const z = (v: number) => size(v * s);
  return {
    ...fx,
    ...(fx.dropShadow && { dropShadow: fx.dropShadow.map((e) => ({ ...e, size: z(e.size), distance: e.distance * s })) }),
    ...(fx.innerShadow && { innerShadow: fx.innerShadow.map((e) => ({ ...e, size: z(e.size), distance: e.distance * s })) }),
    ...(fx.outerGlow && { outerGlow: { ...fx.outerGlow, size: z(fx.outerGlow.size) } }),
    ...(fx.innerGlow && { innerGlow: { ...fx.innerGlow, size: z(fx.innerGlow.size) } }),
    ...(fx.stroke && { stroke: fx.stroke.map((e) => ({ ...e, size: z(e.size) })) }),
  };
}
