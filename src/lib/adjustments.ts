import { z } from "zod";
import { Color } from "./color";
import { Gradient } from "./effects";

// Adjustment layers and per-element filters, shaped after Photoshop's so a .psd can carry them
// in. The pixel maths is in fx/adjust.ts. Values use Photoshop's ranges (levels in 0..255,
// hue in degrees, percentages as -100..100) except curves, whose points are 0..1.

export const LevelsChannel = z.object({
  inBlack: z.number().min(0).max(255),
  inWhite: z.number().min(0).max(255),
  gamma: z.number().min(0.1).max(9.99),
  outBlack: z.number().min(0).max(255),
  outWhite: z.number().min(0).max(255),
});

const CurvePoints = z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(2).max(16);

/** Per channel: the composite (rgb) and each of red, green and blue; absent = unchanged. */
const channels = <T extends z.ZodTypeAny>(t: T) => z.object({ rgb: t.optional(), r: t.optional(), g: t.optional(), b: t.optional() });

export const HSL = z.object({
  /** Degrees, -180..180 (colorize: the hue itself, 0..360). */
  hue: z.number().min(-180).max(360),
  /** -100..100 (colorize: 0..100). */
  saturation: z.number().min(-100).max(100),
  lightness: z.number().min(-100).max(100),
});

export const HUE_RANGES = ["reds", "yellows", "greens", "cyans", "blues", "magentas"] as const;

/**
 * One colour range of Hue/Saturation: full effect for hues from b to c (degrees, going up and
 * wrapping at 360), fading out to nothing at a (below) and d (above).
 */
export const HueRange = HSL.extend({
  range: z.enum(HUE_RANGES),
  a: z.number(),
  b: z.number(),
  c: z.number(),
  d: z.number(),
});

/** Colour balance for one tonal range, each -100..100. */
export const ColorBalanceValues = z.object({
  cyanRed: z.number().min(-100).max(100),
  magentaGreen: z.number().min(-100).max(100),
  yellowBlue: z.number().min(-100).max(100),
});

/** One output channel of Channel Mixer: percent of each input (-200..200) plus a constant percent. */
export const MixChannel = z.object({
  r: z.number().min(-200).max(200),
  g: z.number().min(-200).max(200),
  b: z.number().min(-200).max(200),
  constant: z.number().min(-200).max(200),
});

const weight = z.number().min(-200).max(300);

export const Adjustment = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("brightness-contrast"),
    brightness: z.number().min(-150).max(150),
    contrast: z.number().min(-100).max(100),
    legacy: z.boolean().default(false),
  }),
  z.object({ type: z.literal("levels"), channels: channels(LevelsChannel) }),
  z.object({ type: z.literal("curves"), channels: channels(CurvePoints) }),
  z.object({
    type: z.literal("exposure"),
    exposure: z.number().min(-20).max(20),
    offset: z.number().min(-0.5).max(0.5),
    gamma: z.number().min(0.01).max(9.99),
  }),
  z.object({ type: z.literal("vibrance"), vibrance: z.number().min(-100).max(100), saturation: z.number().min(-100).max(100) }),
  z.object({ type: z.literal("hue-saturation"), colorize: z.boolean().default(false), master: HSL, ranges: z.array(HueRange).max(6).optional() }),
  z.object({
    type: z.literal("color-balance"),
    shadows: ColorBalanceValues,
    midtones: ColorBalanceValues,
    highlights: ColorBalanceValues,
    preserveLuminosity: z.boolean(),
  }),
  z.object({
    type: z.literal("black-white"),
    weights: z.object({ reds: weight, yellows: weight, greens: weight, cyans: weight, blues: weight, magentas: weight }),
    tint: Color.optional(),
  }),
  z.object({ type: z.literal("photo-filter"), color: Color, density: z.number().min(0).max(1), preserveLuminosity: z.boolean() }),
  z.object({ type: z.literal("channel-mixer"), monochrome: z.boolean(), r: MixChannel, g: MixChannel, b: MixChannel, gray: MixChannel.optional() }),
  z.object({ type: z.literal("invert") }),
  z.object({ type: z.literal("posterize"), levels: z.number().int().min(2).max(255) }),
  z.object({ type: z.literal("threshold"), level: z.number().int().min(1).max(255) }),
  z.object({ type: z.literal("gradient-map"), gradient: Gradient, reverse: z.boolean().default(false) }),
]);

export type Adjustment = z.infer<typeof Adjustment>;
export type AdjustmentType = Adjustment["type"];
export type LevelsChannel = z.infer<typeof LevelsChannel>;
export type HueRange = z.infer<typeof HueRange>;
export type MixChannel = z.infer<typeof MixChannel>;

/**
 * A mask over an adjustment layer (Photoshop layer masks): an image whose alpha is the mask,
 * placed in the element's local units. Outside that rectangle the mask is `outside` (0..1;
 * undefined = 0, hidden).
 */
export const RasterMask = z.object({
  assetId: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  outside: z.number().min(0).max(1).optional(),
});
export type RasterMask = z.infer<typeof RasterMask>;

/** A filter on one element's own pixels, run before its effects. */
export const Filter = z.discriminatedUnion("type", [
  /** Gaussian blur; radius is the standard deviation in design units (as Photoshop's radius). */
  z.object({ type: z.literal("blur"), radius: z.number().min(0).max(250) }),
  /** Any adjustment, applied to this element only. */
  z.object({ type: z.literal("adjust"), adjustment: Adjustment }),
  /** Unsharp mask: amount × the difference from a blur of `radius`. */
  z.object({ type: z.literal("sharpen"), amount: z.number().min(0).max(5), radius: z.number().min(0.1).max(50) }),
  /** Seeded noise of up to ± amount; mono = the same for every channel. */
  z.object({ type: z.literal("noise"), amount: z.number().min(0).max(1), mono: z.boolean() }),
]);
export type Filter = z.infer<typeof Filter>;
export type FilterType = Filter["type"];

export const ADJUSTMENT_TYPES = [
  "brightness-contrast",
  "levels",
  "curves",
  "exposure",
  "vibrance",
  "hue-saturation",
  "color-balance",
  "black-white",
  "photo-filter",
  "channel-mixer",
  "invert",
  "posterize",
  "threshold",
  "gradient-map",
] as const satisfies readonly AdjustmentType[];

export const ADJUSTMENT_LABELS: Record<AdjustmentType, string> = {
  "brightness-contrast": "Brightness/Contrast",
  levels: "Levels",
  curves: "Curves",
  exposure: "Exposure",
  vibrance: "Vibrance",
  "hue-saturation": "Hue/Saturation",
  "color-balance": "Color Balance",
  "black-white": "Black & White",
  "photo-filter": "Photo Filter",
  "channel-mixer": "Channel Mixer",
  invert: "Invert",
  posterize: "Posterize",
  threshold: "Threshold",
  "gradient-map": "Gradient Map",
};

const ZERO_CB = { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 };
/** Photoshop's default Black & White weights. */
export const BW_DEFAULT_WEIGHTS = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 };
/** Photoshop's default Hue/Saturation ranges (degrees). */
export const HUE_RANGE_DEFAULTS: Record<(typeof HUE_RANGES)[number], [number, number, number, number]> = {
  reds: [315, 345, 15, 45],
  yellows: [15, 45, 75, 105],
  greens: [75, 105, 135, 165],
  cyans: [135, 165, 195, 225],
  blues: [195, 225, 255, 285],
  magentas: [255, 285, 315, 345],
};

/** A new adjustment of a type with Photoshop's starting values. */
export function defaultAdjustment(type: AdjustmentType): Adjustment {
  switch (type) {
    case "brightness-contrast":
      return { type, brightness: 0, contrast: 0, legacy: false };
    case "levels":
      return { type, channels: { rgb: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 } } };
    case "curves":
      return { type, channels: { rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } };
    case "exposure":
      return { type, exposure: 0, offset: 0, gamma: 1 };
    case "vibrance":
      return { type, vibrance: 0, saturation: 0 };
    case "hue-saturation":
      return { type, colorize: false, master: { hue: 0, saturation: 0, lightness: 0 } };
    case "color-balance":
      return { type, shadows: { ...ZERO_CB }, midtones: { ...ZERO_CB }, highlights: { ...ZERO_CB }, preserveLuminosity: true };
    case "black-white":
      return { type, weights: { ...BW_DEFAULT_WEIGHTS } };
    case "photo-filter":
      return { type, color: "#ec8a00", density: 0.25, preserveLuminosity: true };
    case "channel-mixer":
      return {
        type,
        monochrome: false,
        r: { r: 100, g: 0, b: 0, constant: 0 },
        g: { r: 0, g: 100, b: 0, constant: 0 },
        b: { r: 0, g: 0, b: 100, constant: 0 },
      };
    case "invert":
      return { type };
    case "posterize":
      return { type, levels: 4 };
    case "threshold":
      return { type, level: 128 };
    case "gradient-map":
      return {
        type,
        reverse: false,
        gradient: { style: "linear", angle: 90, scale: 1, reverse: false, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] },
      };
  }
}

export const FILTER_LABELS: Record<FilterType, string> = { blur: "Blur", sharpen: "Sharpen", noise: "Noise", adjust: "Adjust colours" };

export function defaultFilter(type: FilterType): Filter {
  switch (type) {
    case "blur":
      return { type, radius: 4 };
    case "sharpen":
      return { type, amount: 1, radius: 1.5 };
    case "noise":
      return { type, amount: 0.1, mono: true };
    case "adjust":
      return { type, adjustment: defaultAdjustment("hue-saturation") };
  }
}

/** Whether any filter would change pixels (stored designs may hold no-op filters). */
export function hasActiveFilters(filters: Filter[] | undefined): boolean {
  return !!filters?.some((f) =>
    f.type === "blur" ? f.radius > 0 : f.type === "sharpen" ? f.amount > 0 : f.type === "noise" ? f.amount > 0 : true,
  );
}

/** How far the filters spread an element's pixels past its own, in design units. */
export function filterReach(filters: Filter[] | undefined): number {
  let r = 0;
  for (const f of filters ?? []) {
    if (f.type === "blur") r += 3 * f.radius;
    else if (f.type === "sharpen") r += 3 * f.radius;
  }
  return r;
}
