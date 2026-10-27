import { z } from "zod";
import { Color } from "./color";

// Layer effects, blend modes and fill opacity, shaped after Photoshop's layer styles so a
// .psd can carry them in and out. Every field an element gains here is optional: designs
// saved before effects existed have none of them and must render exactly as before.

export const BLEND_MODES = [
  "normal",
  "pass-through",
  "dissolve",
  "darken",
  "multiply",
  "color-burn",
  "linear-burn",
  "darker-color",
  "lighten",
  "screen",
  "color-dodge",
  "linear-dodge",
  "lighter-color",
  "overlay",
  "soft-light",
  "hard-light",
  "vivid-light",
  "linear-light",
  "pin-light",
  "hard-mix",
  "difference",
  "exclusion",
  "subtract",
  "divide",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export const BlendMode = z.enum(BLEND_MODES);

const Midpoint = z.number().min(0.05).max(0.95);
export const ColorStop = z.object({ offset: z.number().min(0).max(1), color: Color, midpoint: Midpoint.optional() });
export const OpacityStop = z.object({
  offset: z.number().min(0).max(1),
  opacity: z.number().min(0).max(1),
  midpoint: Midpoint.optional(),
});

export const Gradient = z.object({
  style: z.enum(["linear", "radial", "angle", "reflected", "diamond"]).default("linear"),
  stops: z.array(ColorStop).min(2).max(32),
  opacityStops: z.array(OpacityStop).max(32).optional(),
  /** Degrees, Photoshop convention: 0 runs left to right, 90 bottom to top. */
  angle: z.number().default(90),
  scale: z.number().min(0.1).max(10).default(1),
  reverse: z.boolean().default(false),
  /** Centre shift as a fraction of the box, -1..1. */
  offset: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const Paint = z.discriminatedUnion("type", [
  z.object({ type: z.literal("color"), color: Color }),
  z.object({ type: z.literal("gradient"), gradient: Gradient }),
]);

const fxCommon = {
  enabled: z.boolean().default(true),
  blendMode: BlendMode.default("normal"),
  opacity: z.number().min(0).max(1).default(1),
};

/** Alpha transfer curve, points in 0..1. */
export const Contour = z
  .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
  .min(2)
  .max(32);

export const Shadow = z.object({
  ...fxCommon,
  color: Color,
  /** Light direction in degrees: 120 casts the shadow down and to the right. */
  angle: z.number(),
  distance: z.number().min(0).max(30000),
  size: z.number().min(0).max(250),
  spread: z.number().min(0).max(1).default(0),
  /** Hide the shadow under the layer (Photoshop's "Layer knocks out drop shadow"). */
  knockout: z.boolean().default(true),
  contour: Contour.optional(),
});
export const InnerShadow = Shadow.omit({ spread: true, knockout: true }).extend({
  choke: z.number().min(0).max(1).default(0),
});
export const Glow = z.object({
  ...fxCommon,
  color: Color,
  size: z.number().min(0).max(250),
  spread: z.number().min(0).max(1).default(0),
  technique: z.enum(["softer", "precise"]).default("softer"),
  contour: Contour.optional(),
});
export const InnerGlow = Glow.omit({ spread: true }).extend({
  choke: z.number().min(0).max(1).default(0),
  source: z.enum(["edge", "center"]).default("edge"),
});
export const StrokeFx = z.object({
  ...fxCommon,
  size: z.number().min(0).max(250),
  position: z.enum(["inside", "center", "outside"]).default("outside"),
  paint: Paint,
});
export const ColorOverlay = z.object({ ...fxCommon, color: Color });
export const GradientOverlay = z.object({ ...fxCommon, gradient: Gradient, alignWithLayer: z.boolean().default(true) });

export const Effects = z.object({
  dropShadow: z.array(Shadow).max(10).optional(),
  innerShadow: z.array(InnerShadow).max(10).optional(),
  outerGlow: Glow.optional(),
  innerGlow: InnerGlow.optional(),
  stroke: z.array(StrokeFx).max(10).optional(),
  colorOverlay: z.array(ColorOverlay).max(10).optional(),
  gradientOverlay: z.array(GradientOverlay).max(10).optional(),
});

/** Spread into every element's base fields. */
export const fxFields = {
  effects: Effects.optional(),
  /** undefined = normal. "pass-through" is only meaningful on groups. */
  blendMode: BlendMode.optional(),
  /** Opacity of the content alone, leaving effects unfaded. undefined = 1. */
  fillOpacity: z.number().min(0).max(1).optional(),
};

export type BlendMode = z.infer<typeof BlendMode>;
export type ColorStop = z.infer<typeof ColorStop>;
export type OpacityStop = z.infer<typeof OpacityStop>;
export type Gradient = z.infer<typeof Gradient>;
export type Paint = z.infer<typeof Paint>;
export type Contour = z.infer<typeof Contour>;
export type Shadow = z.infer<typeof Shadow>;
export type InnerShadow = z.infer<typeof InnerShadow>;
export type Glow = z.infer<typeof Glow>;
export type InnerGlow = z.infer<typeof InnerGlow>;
export type StrokeFx = z.infer<typeof StrokeFx>;
export type ColorOverlay = z.infer<typeof ColorOverlay>;
export type GradientOverlay = z.infer<typeof GradientOverlay>;
export type Effects = z.infer<typeof Effects>;

// Stored designs skip the zod parse, so defaults may be missing: `enabled` undefined means on.
const on = (fx: { enabled?: boolean } | undefined) => !!fx && fx.enabled !== false;

/** Whether any effect would draw. */
export function hasActiveEffects(fx: Effects | undefined): boolean {
  if (!fx) return false;
  return (
    !!fx.dropShadow?.some(on) ||
    !!fx.innerShadow?.some(on) ||
    on(fx.outerGlow) ||
    on(fx.innerGlow) ||
    !!fx.stroke?.some(on) ||
    !!fx.colorOverlay?.some(on) ||
    !!fx.gradientOverlay?.some(on)
  );
}
