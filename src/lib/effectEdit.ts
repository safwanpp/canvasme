import {
  type BlendMode,
  type ColorOverlay,
  type ColorStop,
  Effects,
  type Gradient,
  type Glow,
  type GradientOverlay,
  hasActiveEffects,
  type InnerGlow,
  type InnerShadow,
  type Shadow,
  type StrokeFx,
} from "./effects";
import type { Element } from "./model";

// Pure helpers behind the Effects panel. None of them mutate their input, and an effects
// object that ends up empty becomes undefined, so the element drops back to plain rendering.

export type FxKind = "dropShadow" | "innerShadow" | "outerGlow" | "innerGlow" | "stroke" | "colorOverlay" | "gradientOverlay";

/** The effect value stored for each kind. */
export type FxValue = {
  dropShadow: Shadow;
  innerShadow: InnerShadow;
  outerGlow: Glow;
  innerGlow: InnerGlow;
  stroke: StrokeFx;
  colorOverlay: ColorOverlay;
  gradientOverlay: GradientOverlay;
};
export type AnyFx = FxValue[FxKind];

/** Panel order. `multi` kinds hold a list (Photoshop allows up to 10). */
export const FX_KINDS: { kind: FxKind; label: string; multi: boolean }[] = [
  { kind: "dropShadow", label: "Drop shadow", multi: true },
  { kind: "innerShadow", label: "Inner shadow", multi: true },
  { kind: "outerGlow", label: "Outer glow", multi: false },
  { kind: "innerGlow", label: "Inner glow", multi: false },
  { kind: "stroke", label: "Stroke", multi: true },
  { kind: "colorOverlay", label: "Color overlay", multi: true },
  { kind: "gradientOverlay", label: "Gradient overlay", multi: true },
];
export const MAX_PER_KIND = 10;
const isMulti = (kind: FxKind) => kind !== "outerGlow" && kind !== "innerGlow";

/** Starting values for a newly added effect on `el`. */
export function defaultEffect<K extends FxKind>(kind: K, el: Element): FxValue[K] {
  const common = { enabled: true, blendMode: "normal" as BlendMode, opacity: 1 };
  const distance = Math.round(Math.max(4, 0.03 * Math.min(el.width, el.height || el.width)));
  const values: { [P in FxKind]: () => FxValue[P] } = {
    dropShadow: () => ({
      ...common,
      blendMode: "multiply",
      opacity: 0.35,
      color: "#000000",
      angle: 120,
      distance,
      size: distance * 2,
      spread: 0,
      knockout: true,
    }),
    innerShadow: () => ({
      ...common,
      blendMode: "multiply",
      opacity: 0.35,
      color: "#000000",
      angle: 120,
      distance,
      size: distance * 2,
      choke: 0,
    }),
    outerGlow: () => ({ ...common, color: "#ffd54a", size: 12, spread: 0, technique: "softer" }),
    innerGlow: () => ({ ...common, color: "#ffd54a", size: 12, choke: 0, technique: "softer", source: "edge" }),
    stroke: () => ({ ...common, size: 4, position: "outside", paint: { type: "color", color: "#000000" } }),
    colorOverlay: () => ({ ...common, color: "#3e3aa8" }),
    gradientOverlay: () => ({
      ...common,
      alignWithLayer: true,
      gradient: {
        style: "linear",
        angle: 90,
        scale: 1,
        reverse: false,
        stops: [
          { offset: 0, color: "#0e1530" },
          { offset: 1, color: "#3e3aa8" },
        ],
      },
    }),
  };
  return values[kind]();
}

/** The effects of one kind as a list (a singleton kind gives zero or one). */
export function effectList<K extends FxKind>(fx: Effects | undefined, kind: K): FxValue[K][] {
  const v = fx?.[kind] as FxValue[K] | FxValue[K][] | undefined;
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/** Write a kind's list back, dropping empty kinds and an empty effects object. */
function withList<K extends FxKind>(fx: Effects | undefined, kind: K, list: FxValue[K][]): Effects | undefined {
  const next: Record<string, unknown> = { ...fx };
  if (!list.length) delete next[kind];
  else next[kind] = isMulti(kind) ? list : list[0];
  for (const k of Object.keys(next)) if (next[k] === undefined || (Array.isArray(next[k]) && !(next[k] as []).length)) delete next[k];
  return Object.keys(next).length ? (next as Effects) : undefined;
}

export function addEffect<K extends FxKind>(fx: Effects | undefined, kind: K, value: FxValue[K]): Effects {
  const list = isMulti(kind) ? [...effectList(fx, kind), value].slice(-MAX_PER_KIND) : [value];
  return withList(fx, kind, list)!;
}

/** Remove one effect (index into a list kind), or the whole kind when `index` is omitted. */
export function removeEffect(fx: Effects | undefined, kind: FxKind, index?: number): Effects | undefined {
  const list = index === undefined ? [] : effectList(fx, kind).filter((_, i) => i !== index);
  return withList(fx, kind, list);
}

export function moveEffect(fx: Effects | undefined, kind: FxKind, from: number, to: number): Effects | undefined {
  const list = [...effectList(fx, kind)];
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return fx;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return withList(fx, kind, list);
}

/**
 * Patch one effect; `patch` may be a function of the element's own effect. When the element
 * lacks it but its list ends right before `index` (a mixed multi-selection), `fallback` is added
 * with the patch applied, so the first edit gives every element the same effect and later events
 * of the same drag patch that one. An element whose list is shorter still is left alone.
 */
export function patchEffect<K extends FxKind>(
  fx: Effects | undefined,
  kind: K,
  index: number,
  patch: Partial<FxValue[K]> | ((cur: FxValue[K]) => Partial<FxValue[K]>),
  fallback?: FxValue[K],
): Effects | undefined {
  const list = [...effectList(fx, kind)];
  const of = (cur: FxValue[K]) => (typeof patch === "function" ? patch(cur) : patch);
  if (list[index]) list[index] = { ...list[index], ...of(list[index]) };
  else if (fallback && index === list.length) {
    const base = structuredClone(fallback);
    list.push({ ...base, ...of(base) });
  } else return fx;
  return withList(fx, kind, list);
}

/** Patch the gradient of a gradient overlay or a gradient stroke, keeping the element's other gradient settings. */
export function patchGradient(
  fx: Effects | undefined,
  kind: "gradientOverlay" | "stroke",
  index: number,
  patch: Partial<Gradient>,
  fallback?: GradientOverlay | StrokeFx,
): Effects | undefined {
  if (kind === "gradientOverlay")
    return patchEffect(fx, kind, index, (cur) => ({ gradient: { ...cur.gradient, ...patch } }), fallback as GradientOverlay | undefined);
  const gradientOf = (s: StrokeFx | undefined) => (s?.paint.type === "gradient" ? s.paint.gradient : undefined);
  return patchEffect(
    fx,
    kind,
    index,
    (cur) => {
      const g = gradientOf(cur) ?? gradientOf(fallback as StrokeFx | undefined);
      return g ? { paint: { type: "gradient" as const, gradient: { ...g, ...patch } } } : {};
    },
    fallback as StrokeFx | undefined,
  );
}

/** Whether every element holds the same list of `kind` (moving or removing by index is then safe). */
export function sameEffectList(els: Element[], kind: FxKind): boolean {
  return commonValue(els, (e) => effectList(e.effects, kind)) !== "mixed";
}

export function toggleEffect(fx: Effects | undefined, kind: FxKind, index: number): Effects | undefined {
  const cur = effectList(fx, kind)[index];
  if (!cur) return fx;
  return patchEffect(fx, kind, index, { enabled: cur.enabled === false });
}

export type Preset = { id: string; label: string; effects: Effects; blendMode?: BlendMode; fillOpacity?: number };

// Values chosen for this app; shadows multiply so they darken what's below like ink.
export const PRESETS: Preset[] = [
  {
    id: "soft-shadow",
    label: "Soft shadow",
    effects: Effects.parse({
      dropShadow: [{ color: "#000000", blendMode: "multiply", opacity: 0.3, angle: 115, distance: 6, size: 18 }],
    }),
  },
  {
    id: "long-shadow",
    label: "Long shadow",
    effects: Effects.parse({
      dropShadow: [{ color: "#1b1f3b", blendMode: "multiply", opacity: 0.45, angle: 135, distance: 22, size: 6, spread: 0.15 }],
    }),
  },
  {
    id: "outline",
    label: "Outline",
    effects: Effects.parse({ stroke: [{ size: 3, position: "outside", paint: { type: "color", color: "#111827" } }] }),
  },
  {
    id: "neon",
    label: "Neon",
    effects: Effects.parse({
      outerGlow: { color: "#2ef2ff", opacity: 0.9, size: 22, spread: 0.1 },
      innerGlow: { color: "#e9fdff", blendMode: "screen", opacity: 0.7, size: 5 },
      stroke: [{ size: 2, position: "center", paint: { type: "color", color: "#2ef2ff" } }],
    }),
  },
  {
    id: "emboss-lite",
    label: "Emboss",
    effects: Effects.parse({
      innerShadow: [{ color: "#000000", blendMode: "multiply", opacity: 0.45, angle: 120, distance: 3, size: 6 }],
      innerGlow: { color: "#ffffff", blendMode: "screen", opacity: 0.55, size: 7, source: "edge" },
    }),
  },
  {
    id: "duotone",
    label: "Duotone",
    effects: Effects.parse({
      gradientOverlay: [
        {
          blendMode: "color",
          gradient: {
            angle: 90,
            stops: [
              { offset: 0, color: "#2b2a8c" },
              { offset: 1, color: "#ff8a5c" },
            ],
          },
        },
      ],
    }),
  },
  {
    id: "ghost",
    label: "Ghost",
    fillOpacity: 0,
    effects: Effects.parse({ stroke: [{ size: 2, position: "outside", paint: { type: "color", color: "#111827" } }] }),
  },
];

/** The element patch a preset makes: it replaces effects, blend mode and fill opacity. */
export function applyPreset(p: Preset): Pick<Element, "effects" | "blendMode" | "fillOpacity"> {
  return { effects: structuredClone(p.effects), blendMode: p.blendMode, fillOpacity: p.fillOpacity };
}

/** The value every element shares, or "mixed". Objects compare by value. */
export function commonValue<T>(els: Element[], get: (e: Element) => T): T | "mixed" {
  if (!els.length) return undefined as T;
  const first = get(els[0]);
  let key: string | undefined;
  return els.every((e) => {
    const v = get(e);
    return v === first || JSON.stringify(v) === (key ??= JSON.stringify(first));
  })
    ? first
    : "mixed";
}

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: "Normal",
  "pass-through": "Pass Through",
  dissolve: "Dissolve",
  darken: "Darken",
  multiply: "Multiply",
  "color-burn": "Color Burn",
  "linear-burn": "Linear Burn",
  "darker-color": "Darker Color",
  lighten: "Lighten",
  screen: "Screen",
  "color-dodge": "Color Dodge",
  "linear-dodge": "Linear Dodge (Add)",
  "lighter-color": "Lighter Color",
  overlay: "Overlay",
  "soft-light": "Soft Light",
  "hard-light": "Hard Light",
  "vivid-light": "Vivid Light",
  "linear-light": "Linear Light",
  "pin-light": "Pin Light",
  "hard-mix": "Hard Mix",
  difference: "Difference",
  exclusion: "Exclusion",
  subtract: "Subtract",
  divide: "Divide",
  hue: "Hue",
  saturation: "Saturation",
  color: "Color",
  luminosity: "Luminosity",
};

/** Grouped like Photoshop's menu. `pass-through` is for groups only and is left out. */
export const BLEND_MODE_GROUPS: { label: string; modes: BlendMode[] }[] = [
  { label: "Normal", modes: ["normal", "dissolve"] },
  { label: "Darken", modes: ["darken", "multiply", "color-burn", "linear-burn", "darker-color"] },
  { label: "Lighten", modes: ["lighten", "screen", "color-dodge", "linear-dodge", "lighter-color"] },
  { label: "Contrast", modes: ["overlay", "soft-light", "hard-light", "vivid-light", "linear-light", "pin-light", "hard-mix"] },
  { label: "Inversion", modes: ["difference", "exclusion", "subtract", "divide"] },
  { label: "Component", modes: ["hue", "saturation", "color", "luminosity"] },
];

// Gradient stop editing (the UI edits colour stops only; midpoints and opacity stops are kept).

const hexRgb = (hex: string): [number, number, number] => {
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};
const rgbHex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** The colour of a stop list at `t`, linear between neighbours. */
export function colorAt(stops: ColorStop[], t: number): string {
  const s = [...stops].sort((a, b) => a.offset - b.offset);
  if (t <= s[0].offset) return s[0].color.slice(0, 7);
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].offset) {
      const a = s[i - 1];
      const b = s[i];
      const f = b.offset === a.offset ? 0 : (t - a.offset) / (b.offset - a.offset);
      const ca = hexRgb(a.color);
      const cb = hexRgb(b.color);
      return rgbHex(ca.map((v, k) => v + (cb[k] - v) * f));
    }
  }
  return s[s.length - 1].color.slice(0, 7);
}

const byOffset = (a: ColorStop, b: ColorStop) => a.offset - b.offset;

export function addStop(stops: ColorStop[], offset: number): ColorStop[] {
  if (stops.length >= 32) return stops;
  const t = Math.min(1, Math.max(0, offset));
  return [...stops, { offset: t, color: colorAt(stops, t) }].sort(byOffset);
}

/** Where a keyboard "add stop" goes: the middle of the widest gap between stops. */
export function stopToAdd(stops: ColorStop[]): number {
  const s = [0, ...stops.map((x) => x.offset), 1].sort((a, b) => a - b);
  let best = 0;
  let at = 0.5;
  for (let i = 1; i < s.length; i++)
    if (s[i] - s[i - 1] > best) {
      best = s[i] - s[i - 1];
      at = (s[i] + s[i - 1]) / 2;
    }
  return at;
}

export function removeStop(stops: ColorStop[], index: number): ColorStop[] {
  return stops.length <= 2 ? stops : stops.filter((_, i) => i !== index);
}

export function moveStop(stops: ColorStop[], index: number, offset: number): ColorStop[] {
  const t = Math.round(Math.min(1, Math.max(0, offset)) * 1000) / 1000;
  return stops.map((s, i) => (i === index ? { ...s, offset: t } : s)).sort(byOffset);
}

/** Whether an element carries any layer styling the toolbar should flag. */
export const hasEffects = (el: Element) =>
  hasActiveEffects(el.effects) || (el.blendMode !== undefined && el.blendMode !== "normal") || (el.fillOpacity ?? 1) < 1;
