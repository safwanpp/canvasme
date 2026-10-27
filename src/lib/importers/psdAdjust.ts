// Photoshop adjustment layers <-> the model's Adjustment, both ways (the import and the PSD
// export share this). Units follow ag-psd's reading of the file: levels and curves in 0..255,
// hue in degrees, colour balance and mixer in percent. Only the model's 14 types are mapped;
// selective color and color lookup return null (the caller drops them with a note).
import type {
  AdjustmentLayer,
  BlackAndWhiteAdjustment,
  ChannelMixerChannel,
  ColorBalanceValues as PsdCbValues,
  CurvesAdjustmentChannel,
  HueSaturationAdjustmentChannel,
  LevelsAdjustmentChannel,
} from "ag-psd";
import type { Adjustment, HueRange, LevelsChannel, MixChannel } from "../adjustments";
import { HUE_RANGE_DEFAULTS, HUE_RANGES } from "../adjustments";
import type { Gradient } from "../effects";
import { colorHex, rgbOf } from "./psdEffects";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const hex2 = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");

/** Whether `psdAdjustmentToModel` can map a layer of this type. */
export const UNSUPPORTED_ADJUSTMENTS = ["selective color", "color lookup"] as const;

/** A CIE Lab colour (L 0..1 as ag-psd gives it, a and b -1..1 of ±128) as a hex sRGB colour; approximate (D65). */
function labHex(c: { l: number; a: number; b: number }): string {
  const L = clamp(c.l, 0, 1) * 100;
  const fy = (L + 16) / 116;
  const fx = fy + (c.a * 128) / 500;
  const fz = fy - (c.b * 128) / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = 0.95047 * inv(fx);
  const Y = inv(fy);
  const Z = 1.08883 * inv(fz);
  const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
  const enc = (u: number) => 255 * (u <= 0.0031308 ? 12.92 * u : 1.055 * Math.max(u, 0) ** (1 / 2.4) - 0.055);
  return `#${lin.map((u) => hex2(enc(clamp(u, 0, 1)))).join("")}`;
}

function anyColorHex(c: unknown): string {
  if (c && typeof c === "object" && "l" in c && "a" in c && "b" in c) return labHex(c as { l: number; a: number; b: number });
  return colorHex(c as Parameters<typeof colorHex>[0]);
}

function levels(c: LevelsAdjustmentChannel | undefined): LevelsChannel | undefined {
  if (!c) return undefined;
  // Files write every channel, most of them untouched: keep only the ones that do something.
  if (c.shadowInput === 0 && c.highlightInput === 255 && c.shadowOutput === 0 && c.highlightOutput === 255 && c.midtoneInput === 1) return undefined;
  return {
    inBlack: clamp(num(c.shadowInput, 0), 0, 255),
    inWhite: clamp(num(c.highlightInput, 255), 0, 255),
    gamma: clamp(num(c.midtoneInput, 1), 0.1, 9.99),
    outBlack: clamp(num(c.shadowOutput, 0), 0, 255),
    outWhite: clamp(num(c.highlightOutput, 255), 0, 255),
  };
}

/** Curve points 0..255 → 0..1, sorted by input, one per input, at most 16 (thinned evenly). */
function curve(c: CurvesAdjustmentChannel | undefined): { x: number; y: number }[] | undefined {
  if (!c || c.length < 2) return undefined;
  const byX = new Map<number, number>();
  for (const p of c) byX.set(clamp(num(p.input, 0), 0, 255), clamp(num(p.output, 0), 0, 255));
  let pts = [...byX].sort((a, b) => a[0] - b[0]).map(([x, y]) => ({ x: x / 255, y: y / 255 }));
  if (pts.length < 2) return undefined;
  if (pts.length > 16) pts = Array.from({ length: 16 }, (_, i) => pts[Math.round((i * (pts.length - 1)) / 15)]);
  return pts;
}

const hsl = (c: HueSaturationAdjustmentChannel | undefined) => ({
  hue: clamp(num(c?.hue, 0), -180, 180),
  saturation: clamp(num(c?.saturation, 0), -100, 100),
  lightness: clamp(num(c?.lightness, 0), -100, 100),
});

const cb = (v: PsdCbValues | undefined) => ({
  cyanRed: clamp(num(v?.cyanRed, 0), -100, 100),
  magentaGreen: clamp(num(v?.magentaGreen, 0), -100, 100),
  yellowBlue: clamp(num(v?.yellowBlue, 0), -100, 100),
});

const mix = (c: ChannelMixerChannel | undefined, d: MixChannel): MixChannel =>
  c
    ? { r: clamp(num(c.red, 0), -200, 200), g: clamp(num(c.green, 0), -200, 200), b: clamp(num(c.blue, 0), -200, 200), constant: clamp(num(c.constant, 0), -200, 200) }
    : d;

/** The model's adjustment for a Photoshop adjustment layer, or null when it has no equivalent here. */
export function psdAdjustmentToModel(a: AdjustmentLayer): Adjustment | null {
  switch (a.type) {
    case "brightness/contrast":
      return {
        type: "brightness-contrast",
        brightness: clamp(num(a.brightness, 0), -150, 150),
        contrast: clamp(num(a.contrast, 0), -100, 100),
        legacy: !!a.useLegacy,
      };
    case "levels": {
      const channels: Extract<Adjustment, { type: "levels" }>["channels"] = {};
      for (const [k, v] of [["rgb", a.rgb], ["r", a.red], ["g", a.green], ["b", a.blue]] as const) {
        const ch = levels(v);
        if (ch) channels[k] = ch;
      }
      return { type: "levels", channels };
    }
    case "curves": {
      const channels: Extract<Adjustment, { type: "curves" }>["channels"] = {};
      for (const [k, v] of [["rgb", a.rgb], ["r", a.red], ["g", a.green], ["b", a.blue]] as const) {
        const pts = curve(v);
        if (pts) channels[k] = pts;
      }
      return { type: "curves", channels };
    }
    case "exposure":
      return {
        type: "exposure",
        exposure: clamp(num(a.exposure, 0), -20, 20),
        offset: clamp(num(a.offset, 0), -0.5, 0.5),
        gamma: clamp(num(a.gamma, 1), 0.01, 9.99),
      };
    case "vibrance":
      return { type: "vibrance", vibrance: clamp(num(a.vibrance, 0), -100, 100), saturation: clamp(num(a.saturation, 0), -100, 100) };
    case "hue/saturation": {
      // The hue2 record starts with a colorize flag byte and a pad byte, then the colorize hue,
      // saturation and lightness, then the master shift. ag-psd reads those first seven words as
      // `master`: a = flag << 8 | pad, b/c/d = the colorize values, hue/saturation/lightness = the shift.
      const m = a.master;
      if ((num(m?.a, 0) & 0xff00) !== 0) {
        // Colorize ignores the colour ranges.
        return {
          type: "hue-saturation",
          colorize: true,
          master: { hue: clamp(num(m?.b, 0), 0, 360), saturation: clamp(num(m?.c, 25), 0, 100), lightness: clamp(num(m?.d, 0), -100, 100) },
        };
      }
      const ranges: HueRange[] = [];
      for (const name of HUE_RANGES) {
        const c = a[name];
        if (!c || (!num(c.hue, 0) && !num(c.saturation, 0) && !num(c.lightness, 0))) continue;
        const d = HUE_RANGE_DEFAULTS[name];
        ranges.push({ range: name, ...hsl(c), a: num(c.a, d[0]), b: num(c.b, d[1]), c: num(c.c, d[2]), d: num(c.d, d[3]) });
      }
      return { type: "hue-saturation", colorize: false, master: hsl(a.master), ...(ranges.length ? { ranges } : {}) };
    }
    case "color balance":
      return {
        type: "color-balance",
        shadows: cb(a.shadows),
        midtones: cb(a.midtones),
        highlights: cb(a.highlights),
        preserveLuminosity: !!a.preserveLuminosity,
      };
    case "black & white": {
      const w = (v: number | undefined, d: number) => clamp(num(v, d), -200, 300);
      return {
        type: "black-white",
        weights: { reds: w(a.reds, 40), yellows: w(a.yellows, 60), greens: w(a.greens, 40), cyans: w(a.cyans, 60), blues: w(a.blues, 20), magentas: w(a.magentas, 80) },
        ...(a.useTint && a.tintColor ? { tint: anyColorHex(a.tintColor) } : {}),
      };
    }
    case "photo filter":
      return { type: "photo-filter", color: anyColorHex(a.color), density: clamp(num(a.density, 0.25), 0, 1), preserveLuminosity: !!a.preserveLuminosity };
    case "channel mixer":
      return {
        type: "channel-mixer",
        monochrome: !!a.monochrome,
        r: mix(a.red, { r: 100, g: 0, b: 0, constant: 0 }),
        g: mix(a.green, { r: 0, g: 100, b: 0, constant: 0 }),
        b: mix(a.blue, { r: 0, g: 0, b: 100, constant: 0 }),
        ...(a.gray ? { gray: mix(a.gray, { r: 40, g: 40, b: 20, constant: 0 }) } : {}),
      };
    case "invert":
      return { type: "invert" };
    case "posterize":
      return { type: "posterize", levels: Math.round(clamp(num(a.levels, 4), 2, 255)) };
    case "threshold":
      return { type: "threshold", level: Math.round(clamp(num(a.level, 128), 1, 255)) };
    case "gradient map": {
      if (a.gradientType === "noise") return null;
      // ag-psd divides the stored 0..4096 locations by the smoothness, leaving 0..1.
      const raw = [...(a.colorStops ?? [])].sort((x, y) => x.location - y.location).slice(0, 32);
      if (!raw.length) return null;
      if (raw.length === 1) raw.push({ ...raw[0], location: 1 });
      const stops = raw.map((s, i) => ({
        offset: clamp(num(s.location, 0), 0, 1),
        color: anyColorHex(s.color),
        ...(i > 0 && num(s.midpoint, 0.5) !== 0.5 ? { midpoint: clamp(num(s.midpoint, 0.5), 0.05, 0.95) } : {}),
      }));
      const ops = (a.opacityStops ?? []).slice(0, 32);
      const gradient: Gradient = { style: "linear", stops, angle: 0, scale: 1, reverse: false };
      if (ops.some((o) => o.opacity < 1)) {
        gradient.opacityStops = [...ops]
          .sort((x, y) => x.location - y.location)
          .map((o) => ({ offset: clamp(num(o.location, 0), 0, 1), opacity: clamp(num(o.opacity, 1), 0, 1) }));
      }
      return { type: "gradient-map", gradient, reverse: !!a.reverse };
    }
    case "selective color":
    case "color lookup":
      return null;
  }
}

const psdLevels = (c: LevelsChannel | undefined): LevelsAdjustmentChannel | undefined =>
  c && { shadowInput: c.inBlack, highlightInput: c.inWhite, shadowOutput: c.outBlack, highlightOutput: c.outWhite, midtoneInput: c.gamma };

const psdCurve = (p: { x: number; y: number }[] | undefined): CurvesAdjustmentChannel | undefined =>
  p?.length ? p.map((q) => ({ input: Math.round(q.x * 255), output: Math.round(q.y * 255) })) : undefined;

const psdHsl = (v: { hue: number; saturation: number; lightness: number }, r?: HueRange): HueSaturationAdjustmentChannel => ({
  a: r?.a ?? 0,
  b: r?.b ?? 0,
  c: r?.c ?? 0,
  d: r?.d ?? 0,
  hue: Math.round(v.hue),
  saturation: Math.round(v.saturation),
  lightness: Math.round(v.lightness),
});

const psdMix = (m: MixChannel): ChannelMixerChannel => ({ red: Math.round(m.r), green: Math.round(m.g), blue: Math.round(m.b), constant: Math.round(m.constant) });

/**
 * The ag-psd adjustment for a model adjustment (for PSD export). Hue/Saturation with colorize
 * writes the flag and its values through `master.a..d` (see the import above); black & white
 * without a tint writes `useTint: false`.
 */
export function modelAdjustmentToPsd(a: Adjustment): AdjustmentLayer {
  switch (a.type) {
    case "brightness-contrast":
      return { type: "brightness/contrast", brightness: a.brightness, contrast: a.contrast, useLegacy: a.legacy, meanValue: 127 };
    case "levels":
      return { type: "levels", rgb: psdLevels(a.channels.rgb), red: psdLevels(a.channels.r), green: psdLevels(a.channels.g), blue: psdLevels(a.channels.b) };
    case "curves":
      return { type: "curves", rgb: psdCurve(a.channels.rgb), red: psdCurve(a.channels.r), green: psdCurve(a.channels.g), blue: psdCurve(a.channels.b) };
    case "exposure":
      return { type: "exposure", exposure: a.exposure, offset: a.offset, gamma: a.gamma };
    case "vibrance":
      return { type: "vibrance", vibrance: a.vibrance, saturation: a.saturation };
    case "hue-saturation": {
      const v = a.master;
      const master = a.colorize
        ? { a: 1 << 8, b: Math.round(v.hue), c: Math.round(v.saturation), d: Math.round(v.lightness), hue: 0, saturation: 0, lightness: 0 }
        : psdHsl(v);
      const out: Extract<AdjustmentLayer, { type: "hue/saturation" }> = { type: "hue/saturation", master };
      for (const name of HUE_RANGES) {
        const r = a.ranges?.find((x) => x.range === name);
        const d = HUE_RANGE_DEFAULTS[name];
        out[name] = r ? psdHsl(r, r) : psdHsl({ hue: 0, saturation: 0, lightness: 0 }, { a: d[0], b: d[1], c: d[2], d: d[3] } as HueRange);
      }
      return out;
    }
    case "color-balance":
      return { type: "color balance", shadows: a.shadows, midtones: a.midtones, highlights: a.highlights, preserveLuminosity: a.preserveLuminosity };
    case "black-white": {
      const w: BlackAndWhiteAdjustment = {
        type: "black & white",
        reds: a.weights.reds,
        yellows: a.weights.yellows,
        greens: a.weights.greens,
        cyans: a.weights.cyans,
        blues: a.weights.blues,
        magentas: a.weights.magentas,
        useTint: !!a.tint,
      };
      if (a.tint) w.tintColor = rgbOf(a.tint);
      return w;
    }
    case "photo-filter":
      return { type: "photo filter", color: rgbOf(a.color), density: a.density, preserveLuminosity: a.preserveLuminosity };
    case "channel-mixer":
      return {
        type: "channel mixer",
        monochrome: a.monochrome,
        red: psdMix(a.r),
        green: psdMix(a.g),
        blue: psdMix(a.b),
        gray: psdMix(a.gray ?? { r: 40, g: 40, b: 20, constant: 0 }),
      };
    case "invert":
      return { type: "invert" };
    case "posterize":
      return { type: "posterize", levels: a.levels };
    case "threshold":
      return { type: "threshold", level: a.level };
    case "gradient-map": {
      const g = a.gradient;
      const ops = g.opacityStops?.length ? g.opacityStops : [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 1 }];
      return {
        type: "gradient map",
        gradientType: "solid",
        reverse: a.reverse,
        smoothness: 1,
        colorStops: g.stops.map((s) => ({ color: rgbOf(s.color), location: s.offset, midpoint: s.midpoint ?? 0.5 })),
        opacityStops: ops.map((o) => ({ opacity: o.opacity, location: o.offset, midpoint: 0.5 })),
      };
    }
  }
}
