import type Konva from "konva";
import { maxFontSize, textFamilies } from "../richText";
import { hasActiveEffects, type BlendMode } from "../effects";
import { filterReach, hasActiveFilters } from "../adjustments";
import { applyFilters } from "./adjust";
import type { Element } from "../model";
import type { Bitmap, NodeSpec } from "../render";
import { traceShape } from "../shapes";
import { clipHitToMask, hitVector, strokeReach } from "../vectorDraw";
import { useView } from "@/store/view";
import { isNativeBlend, NATIVE_BLEND } from "./blend";
import { fxCache, fxKey, type FxEntry } from "./cache";
import { fxPaddingUnits, hasOuterEffects, renderEffects } from "./effects";
import { fromCanvas, toCanvas, type Raster } from "./raster";
import { drawBlended, drawGroupBlended } from "./readback";

// An element with layer effects or a software blend mode is drawn as one custom Konva Shape:
// its plain nodes are rendered off-screen, run through the effects pipeline, cached, and the
// result drawn back with each part's blend. The editor and every export go through this, so
// they draw the same pixels.

type KonvaNS = typeof import("konva").default;
let konva: KonvaNS | null = null;

/** Konva is loaded lazily by exports and statically by the editor; whoever loads it hands it over. */
export const provideKonva = (k: KonvaNS) => {
  konva = k;
};
export const getKonva = () => konva;

/**
 * Bumped whenever a deferred editor render lands, so a group whose content was drawn from a
 * member's stand-in render knows to draw it again.
 */
export let fxGeneration = 0;

/**
 * An asset image finished loading. A member drawn through the effects pipeline gets its image
 * inside its fx Shape, which a group's live stamp can't see, so the group's content is redrawn.
 */
export const noteImageReady = () => {
  fxGeneration++;
};

/** How far a group's members (their strokes and effects) reach past the group box, by group element. */
const groupReach = new WeakMap<Element, number>();
export const setGroupReach = (el: Element, reach: number) => groupReach.set(el, reach);

export type Pad = { l: number; t: number; r: number; b: number };

// A render's float buffers take about 50 bytes per pixel at their peak, so keep each one
// well under what a phone can spare.
const MAX_SIDE = 4096;
const MAX_PIXELS = 6_000_000;
/** How long the editor waits after a zoom or an edit before it re-renders an element's effects. */
const RERENDER_DELAY = 80;

/** Whether the element must be drawn through the effects pipeline. */
export function needsFx(el: Element): boolean {
  // An adjustment layer applies its own blend mode to what is below it (fx/adjustDraw.ts).
  if (el.type === "adjustment") return false;
  return hasActiveEffects(el.effects) || !isNativeBlend(el.blendMode) || hasActiveFilters(el.filters);
}

/** How far the plain nodes reach past the box: strokes, arrow heads, italic overhang, antialiasing. */
export function basePad(el: Element) {
  // Filters (blur) spread the pixels past their own reach.
  return ownPad(el) + (el.filters ? filterReach(el.filters) : 0);
}

function ownPad(el: Element) {
  if (el.type === "vector") return 2 + strokeReach(el);
  if (el.type === "group") return 2 + (groupReach.get(el) ?? 0);
  if (el.type === "line" || el.type === "path") return Math.max(2, el.strokeWidth * 1.5);
  if (el.type === "shape" && el.strokeWidth > 0) return Math.max(2, el.strokeWidth * 1.5);
  // Italic and swashy glyphs lean past the text box; descenders can pass a tight height.
  if (el.type === "text") return Math.max(2, maxFontSize(el) * 0.2);
  return 2;
}

function padding(el: Element, which: "all" | "body"): Pad {
  const b = basePad(el);
  const p = hasActiveEffects(el.effects) ? fxPaddingUnits(el.effects, which) : { l: 0, t: 0, r: 0, b: 0 };
  return { l: b + p.l, t: b + p.t, r: b + p.r, b: b + p.b };
}

/** Room around the element box that its drawing needs, in element units. */
export const fxPadding = (el: Element): Pad => padding(el, "all");

/** Page-space bounding box of the padded element, rotation included. */
export function visualBounds(el: Element) {
  const p = fxPadding(el);
  const a = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [-p.l, -p.t],
    [el.width + p.r, -p.t],
    [-p.l, el.height + p.b],
    [el.width + p.r, el.height + p.b],
  ]) {
    xs.push(el.x + x * cos - y * sin);
    ys.push(el.y + x * sin + y * cos);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Device pixels per element unit for a render: the on-screen scale, capped so a w×h (element
 * units) render fits. The editor quantizes it to steps of √2 so zooming re-renders only now
 * and then; exports and thumbnails pass quantize false and render at their exact scale.
 */
export function fxRatio(scale: number, w: number, h: number, quantize = true): number {
  const s = scale > 0 && Number.isFinite(scale) ? scale : 1;
  const q = quantize ? 2 ** (Math.round(2 * Math.log2(s)) / 2) : s;
  const W = Math.max(1, w);
  const H = Math.max(1, h);
  return Math.min(q, MAX_SIDE / W, MAX_SIDE / H, Math.sqrt(MAX_PIXELS / (W * H)));
}

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Changes when a text element's font finishes loading, so a fallback-font render isn't kept. */
function fontState(el: Element) {
  if (el.type !== "text" || typeof document === "undefined" || !document.fonts?.check) return "";
  try {
    return textFamilies(el).every((f) => document.fonts.check(`${el.fontSize}px "${f}"`)) ? "f1" : "f0";
  } catch {
    return "";
  }
}

/** The plain nodes drawn off-screen around the box, as a raster. */
function rasterize(nodes: NodeSpec[], el: Element, ratio: number, pad: Pad): Raster | null {
  const W = el.width + pad.l + pad.r;
  const H = el.height + pad.t + pad.b;
  const pw = Math.max(1, Math.ceil(W * ratio));
  const ph = Math.max(1, Math.ceil(H * ratio));
  const group = new konva!.Group();
  for (const n of nodes) {
    const Ctor = konva![n.kind] as unknown as new (a: Record<string, unknown>) => Konva.Shape;
    group.add(new Ctor(n.attrs));
  }
  const canvas = group.toCanvas({ x: -pad.l, y: -pad.t, width: pw / ratio, height: ph / ratio, pixelRatio: ratio });
  group.destroy();
  const ok = canvas.width >= 1 && canvas.height >= 1;
  const content = ok ? fromCanvas(canvas) : null;
  // Give the canvas memory back now; the browser would hold it until collection.
  canvas.width = canvas.height = 0;
  return content;
}

type Ratios = { body: number; outer: number };

/** Body and outer-part resolutions: a far-reaching shadow lowers only its own. */
function ratios(el: Element, scale: number, quantize: boolean): Ratios {
  const p = fxPadding(el);
  const b = padding(el, "body");
  const body = fxRatio(scale, el.width + b.l + b.r, el.height + b.t + b.b, quantize);
  const outer = Math.min(body, fxRatio(scale, el.width + p.l + p.r, el.height + p.t + p.b, quantize));
  return { body, outer };
}

/** Draws an element's content (no effects) around its box: `pad` in element units, at `ratio`. */
export type ContentSource = (ratio: number, pad: Pad) => Raster | null;

function renderEntry(el: Element, nodes: NodeSpec[], r: Ratios, seed: number, source?: ContentSource): FxEntry | null {
  if (!konva) return null;
  // Filters run on the content first, so effects follow the filtered pixels.
  const rasterize_ = (ratio: number, p: Pad) => {
    const c = source ? source(ratio, p) : rasterize(nodes, el, ratio, p);
    return c && el.filters?.length ? applyFilters(c, el.filters, ratio, seed) : c;
  };
  const pad = fxPadding(el);
  const fillOpacity = el.fillOpacity ?? 1;
  const boxAt = (p: Pad, ratio: number) => ({ x: p.l * ratio, y: p.t * ratio, w: el.width * ratio, h: el.height * ratio });
  const toPart = (p: { raster: Raster; blend: BlendMode; opacity: number }) => ({
    canvas: toCanvas(p.raster),
    blend: p.blend,
    opacity: p.opacity,
  });
  // One render when the padded box fits at the body's resolution; else outer parts at their own.
  const split = r.outer < r.body && hasOuterEffects(el.effects);
  const bodyPad = split ? padding(el, "body") : pad;
  let outer: FxEntry["outer"] = [];
  if (split) {
    const content = rasterize_(r.outer, pad);
    if (!content) return null;
    const box = boxAt(pad, r.outer);
    outer = renderEffects(content, el.effects, { ratio: r.outer, fillOpacity, box, seed, parts: "outer" }, toPart).outer;
  }
  const content = rasterize_(r.body, bodyPad);
  if (!content) return null;
  const box = boxAt(bodyPad, r.body);
  const out = renderEffects(content, el.effects, { ratio: r.body, fillOpacity, box, seed, parts: split ? "body" : "all" }, toPart);
  if (!split) outer = out.outer;
  const body = toCanvas(out.body);
  const outerPixels = outer.reduce((n, p) => n + p.canvas.width * p.canvas.height, 0);
  return {
    outer,
    outerPad: pad,
    outerRatio: split ? r.outer : r.body,
    body,
    pad: bodyPad,
    w: el.width,
    h: el.height,
    fontSize: el.type === "text" ? el.fontSize : undefined,
    ratio: r.body,
    pixels: outerPixels + body.width * body.height,
  };
}

function drawPart(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  mode: BlendMode | undefined,
  opacity: number,
  rect: [number, number, number, number],
  seed: number,
) {
  // A released (evicted) canvas is 0×0, and drawing one throws.
  if (opacity <= 0 || !img.width || !img.height) return;
  ctx.save();
  ctx.globalAlpha *= opacity;
  if (isNativeBlend(mode)) {
    ctx.globalCompositeOperation = NATIVE_BLEND[mode ?? "normal"] ?? "source-over";
    ctx.drawImage(img, ...rect);
  } else {
    drawBlended(ctx, img, ...rect, mode!, seed);
  }
  ctx.restore();
}

/** Clicks land on the element's own outline (inside its vector mask), never on its effects. */
function hitPath(el: Element, kctx: Konva.Context, shape: Konva.Shape) {
  if (!el.vectorMask) return hitOutline(el, kctx, shape);
  const c = kctx._context;
  c.save();
  try {
    clipHitToMask(c, el.vectorMask, el.width, el.height);
    hitOutline(el, kctx, shape);
  } finally {
    c.restore();
  }
}

function hitOutline(el: Element, kctx: Konva.Context, shape: Konva.Shape) {
  const w = el.width;
  const h = el.height;
  if (el.type === "vector") return hitVector(kctx._context, el, shape.colorKey);
  if (el.type === "line" || el.type === "path") {
    const pts = el.type === "line" ? [0, h / 2, w, h / 2] : el.points;
    const c = kctx._context;
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    if (pts.length === 2) c.lineTo(pts[0] + 0.01, pts[1]);
    c.lineWidth = Math.max(20, el.strokeWidth);
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = shape.colorKey;
    c.stroke();
    return;
  }
  if (el.type === "shape") traceShape(kctx, el, w, h);
  else if (el.type === "image" && el.mask) traceShape(kctx, el.mask.shape, w, h);
  else {
    kctx.beginPath();
    kctx.rect(0, 0, w, h);
    kctx.closePath();
  }
  kctx.fillStrokeShape(shape);
}

// Deferred editor renders, one per element. A later request replaces the render but keeps the
// timer, so a long zoom or drag still re-renders every RERENDER_DELAY rather than never.
const pending = new Map<string, () => void>();

function renderLater(id: string, render: () => void) {
  const queued = pending.has(id);
  pending.set(id, render);
  if (queued) return;
  setTimeout(() => {
    const run = pending.get(id);
    pending.delete(id);
    fxGeneration++;
    run?.();
  }, RERENDER_DELAY);
}

/**
 * Konva Shape attrs that draw `el` through the effects pipeline. `nodes` are its plain node
 * specs (render.ts `baseNodes`). `part` draws only the outer effects or only the body (P4 clip
 * stacks). `live` marks the editor: it renders at quantized ratios and, once an element has a
 * render, keeps drawing it (stretched) while a new one is made off the frame. Without `live`
 * (exports, thumbnails) every draw is rendered at once and at the exact ratio.
 */
export function fxShapeAttrs(
  el: Element,
  image: Bitmap | null | undefined,
  opts: {
    fontsVersion?: number;
    part?: "all" | "outer" | "body";
    nodes: NodeSpec[];
    live?: boolean;
    /** Draws the content instead of `nodes` (a group's members); `contentKey` says when it changed. */
    content?: ContentSource;
    contentKey?: string;
  },
): Record<string, unknown> {
  const part = opts.part ?? "all";
  const live = !!opts.live;
  const seed = hashString(el.id);
  // An image that hasn't loaded yet draws a placeholder; don't let that render stand in for it.
  const imageState = image ? `i${"naturalWidth" in image ? image.naturalWidth : image.width}` : "i0";
  const base = fxKey(el, 0, opts.fontsVersion ?? 0);
  // Dissolve's noise is baked into the render and seeded by the id, so then the id is part of the key.
  const seedState = base.includes('"dissolve"') ? `|s${seed}` : "";
  return {
    width: el.width,
    height: el.height,
    sceneFunc: (kctx: Konva.Context, shape?: Konva.Shape) => {
      if (!(el.width > 0) || !(el.height > 0)) return;
      const ctx = kctx._context as CanvasRenderingContext2D;
      const m = ctx.getTransform();
      const r = ratios(el, Math.hypot(m.a, m.b), live);
      const key = `${fxKey(el, r.body, opts.fontsVersion ?? 0)}|o${r.outer}|${imageState}|${fontState(el)}${seedState}${opts.contentKey ?? ""}`;
      const render = () => {
        const fresh = renderEntry(el, opts.nodes, r, seed, opts.content);
        if (fresh) fxCache.set(key, el.id, fresh);
        return fresh;
      };
      let entry = fxCache.get(key, el.id);
      if (!entry && live) {
        entry = fxCache.getStale(el.id);
        // While resizing, stretch the last render; the transform's end re-renders.
        if (entry && !useView.getState().transforming.includes(el.id)) {
          renderLater(el.id, () => {
            if (!fxCache.get(key, el.id)) render();
            shape?.getLayer()?.batchDraw();
          });
        }
      }
      entry ??= render() ?? undefined;
      if (!entry) return;
      // A stale text render scales with the font size only: re-wrapping must not stretch glyphs.
      const k = el.type === "text" && entry.fontSize ? el.fontSize / entry.fontSize : 0;
      const sx = k || el.width / entry.w;
      const sy = k || (entry.h > 0 ? el.height / entry.h : 1);
      const rectOf = (c: HTMLCanvasElement, pad: Pad, ratio: number): [number, number, number, number] => [
        -pad.l * sx,
        -pad.t * sy,
        (c.width / ratio) * sx,
        (c.height / ratio) * sy,
      ];
      const outer = part === "body" ? [] : entry.outer;
      const body = part === "outer" ? null : entry.body;
      const parts = outer.map((p) => ({
        src: p.canvas,
        rect: rectOf(p.canvas, entry.outerPad, entry.outerRatio),
        mode: p.blend,
        opacity: p.opacity,
      }));
      const mode = el.blendMode ?? "normal";
      if (body && parts.length && mode !== "normal" && mode !== "pass-through") {
        // The layer's blend mode applies to its effects too: blend the whole as one group.
        if (!body.width || parts.some((p) => !p.src.width)) return;
        parts.push({ src: body, rect: rectOf(body, entry.pad, entry.ratio), mode: "normal", opacity: 1 });
        drawGroupBlended(ctx, parts, mode, seed);
        return;
      }
      for (const p of parts) drawPart(ctx, p.src, p.mode, p.opacity, p.rect, seed);
      if (body) drawPart(ctx, body, el.blendMode, 1, rectOf(body, entry.pad, entry.ratio), seed);
    },
    hitFunc: (kctx: Konva.Context, shape: Konva.Shape) => hitPath(el, kctx, shape),
  };
}
