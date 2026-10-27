// Builds the ag-psd document for one page: a background, one layer per element with its
// blend mode, opacity, fill opacity and effects as live layer styles, clipping, and text
// elements as editable text layers. Pure apart from `renderLayer`, so tests run it with a stub renderer.
import type { Layer, LayerTextData, Psd, TextStyle } from "ag-psd";
import { FONTS } from "../fonts";
import { pageSize, type AdjustmentElement, type Design, type Element, type GroupElement, type Page, type Subpath, type TextElement, type VectorElement } from "../model";
import { DEFAULT_MITER_LIMIT, transformSubpaths } from "../vector";
import { maskToVectorMask, shapeToVector } from "../shapes";
import { buildRenderTree, tidyTree, type RenderNode } from "../tree";
import { maxFontSize, normalizeRuns, resolvedParagraphs, resolvedRuns, type ResolvedStyle } from "../richText";
import { hasActiveEffects } from "../effects";
import { BLEND_TO_PSD, modelEffectsToPsd, rgbOf } from "./psdEffects";
import { modelAdjustmentToPsd } from "./psdAdjust";
import { paintToPsd, subpathsToPsdPaths } from "./psdVector";

export type LayerBox = { x: number; y: number; width: number; height: number };
/** The element's own pixels (no effects, blend or fill opacity) and the page box they cover. */
export type RenderLayer = (el: Element, o: { effects: false }) => Promise<{ canvas: HTMLCanvasElement; box: LayerBox } | null>;

/** Grayscale mask pixels (value in red) resampled to the box a layer mask covers. */
export type MaskPixels = { width: number; height: number; data: Uint8ClampedArray };
/** What the builder needs beyond the renderer: the stored raster mask of an adjustment, at a size. */
export type BuildIo = { loadMask?: (assetId: string, width: number, height: number) => Promise<MaskPixels | null> };
type Cx = { renderLayer: RenderLayer; io: BuildIo; notes: string[] };

/** The gap between artboards in the exported row, in pixels. */
export const ARTBOARD_GAP = 100;

/** The editor's raster caps: a composite beyond them isn't allocated (see exportPsd). */
export const COMPOSITE_MAX_SIDE = 4096;
export const COMPOSITE_MAX_PIXELS = 16_000_000;
export const compositeFits = (w: number, h: number) => w <= COMPOSITE_MAX_SIDE && h <= COMPOSITE_MAX_SIDE && w * h <= COMPOSITE_MAX_PIXELS;

const addNote = (notes: string[], note: string) => {
  if (!notes.includes(note)) notes.push(note);
};

/** Photoshop's default global light; effects are written with their own angle anyway. */
const GLOBAL_ANGLE = 120;

export const layerName = (el: Element) =>
  (el.name || (el.type === "text" ? el.text.replace(/\s+/g, " ").trim().slice(0, 60) : null) || el.type).slice(0, 120) ||
  "Layer";

/** Whether a built-in family ships a face for this weight and style (uploaded fonts: unknown, so no). */
function hasFace(family: string, bold: boolean, italic: boolean) {
  const font = FONTS.find((f) => f.family === family);
  if (!font) return !bold && !italic;
  if (font.faces) {
    return font.faces.some((f) => {
      const ws = f.weight.split(/\s+/).map(Number);
      const w = bold ? 700 : 400;
      const inRange = ws.length > 1 ? ws[0] <= w && w <= ws[1] : ws[0] === w;
      return inRange && (f.style === "italic") === italic;
    });
  }
  const spec = font.spec ?? "";
  const axes = spec.split(":")[1];
  if (!axes) return !bold && !italic;
  const [names, values] = axes.split("@");
  const keys = names.split(",");
  const tuples = (values ?? "").split(";").map((t) => t.split(","));
  return tuples.some((t) => {
    const ital = keys.includes("ital") ? t[keys.indexOf("ital")] === "1" : false;
    const wght = keys.includes("wght") ? Number(t[keys.indexOf("wght")]) : 400;
    return ital === italic && wght === (bold ? 700 : 400);
  });
}

/**
 * A PostScript-style font name ("PlayfairDisplay-BoldItalic") for the nearest real face, and
 * faux bold/italic for what that face lacks. The importer's `matchFont` reads these back.
 */
export function psdFont(family: string, bold: boolean, italic: boolean) {
  let b = bold;
  let i = italic;
  if (!hasFace(family, b, i)) {
    if (b && i && hasFace(family, true, false)) i = false;
    else if (b && i && hasFace(family, false, true)) b = false;
    else {
      b = false;
      i = false;
    }
  }
  const style = `${b ? "Bold" : ""}${i ? "Italic" : ""}` || "Regular";
  return { name: `${family.replace(/\s+/g, "")}-${style}`, fauxBold: bold && !b, fauxItalic: italic && !i };
}

/** A run's style as Photoshop text style (the font as the nearest real face plus faux styles). */
function runStyle(s: ResolvedStyle, lineHeight: number): TextStyle {
  const font = psdFont(s.fontFamily, s.bold, s.italic);
  return {
    font: { name: font.name },
    fontSize: s.fontSize,
    fillColor: rgbOf(s.fill),
    tracking: s.fontSize ? (s.letterSpacing / s.fontSize) * 1000 : 0,
    autoLeading: false,
    leading: lineHeight * s.fontSize,
    underline: s.underline,
    strikethrough: s.strike,
    fauxBold: font.fauxBold,
    fauxItalic: font.fauxItalic,
    baselineShift: s.baselineShift,
    fontCaps: s.caps === "all" ? 2 : s.caps === "small" ? 1 : 0,
    horizontalScale: s.scaleX,
    verticalScale: s.scaleY,
  };
}

/** Paragraph (box) text in the element's frame, so Photoshop re-lays it out with the real font. */
export function textData(el: TextElement): LayerTextData {
  const a = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const font = psdFont(el.fontFamily, el.bold, el.italic);
  const text = el.text.replace(/\r\n?/g, "\n");
  const out: LayerTextData = {
    text: text.replace(/\n/g, "\r"),
    transform: [cos, sin, -sin, cos, el.x, el.y],
    antiAlias: "smooth",
    shapeType: "box",
    boxBounds: [0, 0, el.width, Math.max(el.height, maxFontSize(el) * el.lineHeight)],
    style: {
      font: { name: font.name },
      fontSize: el.fontSize,
      fillColor: rgbOf(el.fill),
      tracking: (el.letterSpacing / el.fontSize) * 1000,
      autoLeading: false,
      leading: el.lineHeight * el.fontSize,
      underline: el.underline,
      fauxBold: font.fauxBold,
      fauxItalic: font.fauxItalic,
    },
    paragraphStyle: { justification: el.align },
  };
  // Rich text: every run written in full (ag-psd merges each over `style`); lengths match the text
  // because only \r\n pairs could change its length and the editor never stores those.
  const fitted = { ...el, text, ...normalizeRuns({ ...el, text }) };
  const runs = resolvedRuns(fitted);
  if (fitted.runs && runs.length) out.styleRuns = runs.map((r) => ({ length: r.length, style: runStyle(r.style, el.lineHeight) }));
  const paras = resolvedParagraphs(fitted);
  if (fitted.paragraphs && paras.length) {
    out.paragraphStyleRuns = paras.map((p) => ({
      length: p.length,
      style: {
        justification: p.align,
        firstLineIndent: p.indent,
        startIndent: p.startIndent,
        endIndent: p.endIndent,
        spaceBefore: p.spaceBefore,
        spaceAfter: p.spaceAfter,
      },
    }));
  }
  return out;
}

/** One element's layer. Keys beyond the plain ones appear only when the element uses them. */
async function elementLayer(source: Element, cx: Cx): Promise<Layer> {
  const { renderLayer } = cx;
  const vec = liveVector(source);
  const el: Element = vec ?? source;
  const out = await renderLayer(pixelsOnly(el, !!vec), { effects: false });
  const layer: Layer = {
    name: layerName(el),
    opacity: el.opacity,
    hidden: el.hidden,
    ...(out ? { left: out.box.x, top: out.box.y, canvas: out.canvas } : {}),
  };
  if (el.clipped) layer.clipping = true;
  // pass-through means something on groups only; a leaf with it is normal.
  if (el.blendMode && el.blendMode !== "normal" && el.blendMode !== "pass-through") layer.blendMode = BLEND_TO_PSD[el.blendMode];
  // A translucent solid fill (no stroke, no effects: see liveVector) is fill opacity: it scales the fill alone.
  const fillAlpha = vec ? solidAlpha(vec.fill) : 1;
  const fillOpacity = (el.fillOpacity ?? 1) * fillAlpha;
  if (fillOpacity < 1) layer.fillOpacity = Math.max(0, fillOpacity);
  const fx = modelEffectsToPsd(el.effects);
  if (fx && Object.keys(fx).length) layer.effects = fx;
  if (el.type === "text" && el.text.trim()) layer.text = textData(el);
  if (vec) Object.assign(layer, vectorLayer(vec));
  else if (el.vectorMask || (el.type === "image" && el.mask)) {
    // An image clipped to a shape also carries the shape as its vector mask (the pixels are masked already).
    const imgMask = el.type === "image" ? el.mask : undefined;
    const m = el.vectorMask ?? maskToVectorMask(el, imgMask!);
    layer.vectorMask = { paths: subpathsToPsdPaths(toDocument(el, m.subpaths), m.fillRule ?? "nonzero"), ...(m.invert ? { invert: true } : {}) };
  }
  return layer;
}

/**
 * An adjustment element as an adjustment layer: no pixels, its raster mask as the layer mask
 * (outside the mask rectangle = `defaultColor`). Photoshop applies it to what is below, like ours.
 */
async function adjustmentLayer(el: AdjustmentElement, cx: Cx): Promise<Layer> {
  const layer: Layer = { name: layerName(el), opacity: el.opacity, hidden: el.hidden, adjustment: modelAdjustmentToPsd(el.adjustment) };
  if (el.clipped) layer.clipping = true;
  if (el.blendMode && el.blendMode !== "normal" && el.blendMode !== "pass-through") layer.blendMode = BLEND_TO_PSD[el.blendMode];
  const m = el.rasterMask;
  if (m) {
    const w = Math.max(1, Math.round(m.width));
    const h = Math.max(1, Math.round(m.height));
    const px = await cx.io.loadMask?.(m.assetId, w, h).catch(() => null);
    if (px && px.width === w && px.height === h) {
      const left = Math.round(m.x);
      const top = Math.round(m.y);
      layer.mask = {
        left,
        top,
        right: left + w,
        bottom: top + h,
        defaultColor: Math.round((m.outside ?? 0) * 255),
        imageData: { width: w, height: h, data: px.data } as unknown as ImageData,
      };
    } else {
      addNote(cx.notes, "An adjustment layer's mask couldn't be read and was left out.");
    }
  }
  return layer;
}

/** The alpha of a solid paint (1 for gradients and none). */
function solidAlpha(p: VectorElement["fill"]) {
  return p && p.type === "color" ? paintToPsd(p).opacity : 1;
}

/**
 * The element as a vector when its shape layer says all of it: a PSD layer has one vector-mask slot
 * (the shape) and Photoshop ignores a shape layer's pixels, so an element with its own vector mask
 * or filters keeps its pixels instead (null). So does a translucent solid fill with a stroke (fill
 * opacity would fade the stroke too) or with any active effect: our effects follow the content's
 * alpha, Photoshop's follow the opaque shape, so a shadow would come out stronger.
 */
function liveVector(el: Element): VectorElement | null {
  if ((el.type !== "shape" && el.type !== "vector") || el.vectorMask || el.filters?.length) return null;
  const v = el.type === "shape" ? shapeToVector(el) : el;
  if (solidAlpha(v.fill) < 1 && ((v.stroke && v.strokeWidth) || hasActiveEffects(el.effects))) return null;
  return v;
}

/**
 * The element as its layer's pixels: without what the layer also carries as live vector data,
 * which Photoshop applies itself (a shape layer's stroke, a layer's vector mask).
 */
function pixelsOnly(el: Element, live: boolean): Element {
  if (live && el.type === "vector") return el.stroke ? { ...el, stroke: null, strokeWidth: 0 } : el;
  return el.vectorMask ? { ...el, vectorMask: undefined } : el;
}

/** Local subpaths in document pixels: the element's rotation (about x, y) and position applied. */
function toDocument(el: Element, subpaths: Subpath[]) {
  const a = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return transformSubpaths(subpaths, (x, y) => [el.x + x * cos - y * sin, el.y + x * sin + y * cos]);
}

/**
 * A vector as a Photoshop shape layer: its paths (document pixels) as the vector mask, the fill as
 * vectorFill and the stroke as vectorStroke. No vectorOrigination (Photoshop may reject a
 * malformed one); the layer opens as a path with fill. A colour's alpha becomes the stroke's
 * opacity; a solid fill colour's alpha is folded into the layer's fill opacity by elementLayer.
 */
function vectorLayer(el: VectorElement): Partial<Layer> {
  const fill = el.fill ? paintToPsd(el.fill) : null;
  const sw = el.strokeWidth ?? 0;
  const stroke = el.stroke && sw > 0 ? paintToPsd(el.stroke) : null;
  const black = { type: "color" as const, color: { r: 0, g: 0, b: 0 } };
  const px = (value: number) => ({ units: "Pixels" as const, value });
  return {
    vectorMask: { paths: subpathsToPsdPaths(toDocument(el, el.subpaths), el.fillRule ?? "nonzero") },
    vectorFill: fill?.content ?? black,
    vectorStroke: {
      strokeEnabled: !!stroke,
      fillEnabled: !!fill,
      lineWidth: px(stroke ? sw : 1),
      lineDashOffset: px(0),
      miterLimit: el.miterLimit ?? DEFAULT_MITER_LIMIT,
      lineCapType: el.lineCap ?? "butt",
      lineJoinType: el.lineJoin ?? "miter",
      lineAlignment: el.strokeAlign ?? "center",
      scaleLock: false,
      strokeAdjust: false,
      // Both in stroke widths.
      lineDashSet: stroke && el.dash?.length ? el.dash.map((d) => ({ units: "None" as const, value: d })) : [],
      blendMode: "normal",
      opacity: stroke?.opacity ?? 1,
      content: stroke?.content ?? black,
      resolution: 72,
    },
  };
}

/** The ag-psd document for a page, without the composite (the caller renders that). */
export async function buildPsd(design: Design, page: Page, renderLayer: RenderLayer, notes: string[] = [], io: BuildIo = {}): Promise<Psd> {
  const { width, height } = pageSize(design, page);
  const { r, g, b } = rgbOf(page.background);
  // #rgba / #rrggbbaa backgrounds keep their alpha.
  const hex = page.background.slice(1);
  const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) : hex.length === 8 ? parseInt(hex.slice(6), 16) : 255;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, a], i);
  // ag-psd reads only width, height and data, so no DOM ImageData is needed.
  const bg = { width, height, data } as unknown as ImageData;

  const layers: Layer[] = [{ name: "Background", left: 0, top: 0, imageData: bg }];
  layers.push(...(await pageLayers(page, { renderLayer, io, notes })));
  return { width, height, children: layers, imageResources: { globalAngle: GLOBAL_ANGLE, globalAltitude: 30 } };
}

/** A page's element layers, bottom first, in page coordinates. */
async function pageLayers(page: Page, cx: Cx): Promise<Layer[]> {
  if (page.elements.some((e) => e.filters?.length && !e.hidden)) addNote(cx.notes, "Filters (blur, sharpen, noise, colour) were baked into their layers' pixels.");
  return treeLayers(buildRenderTree(tidyTree(page.elements)), cx);
}

/** Move a layer (and its children) by whole document pixels: pixels, text, paths and masks. */
function shiftLayer(l: Layer, dx: number, dy: number) {
  if (l.left !== undefined) l.left += dx;
  if (l.top !== undefined) l.top += dy;
  if (l.mask) {
    l.mask.left = (l.mask.left ?? 0) + dx;
    l.mask.top = (l.mask.top ?? 0) + dy;
    l.mask.right = (l.mask.right ?? 0) + dx;
    l.mask.bottom = (l.mask.bottom ?? 0) + dy;
  }
  if (l.text?.transform) l.text.transform = [...l.text.transform.slice(0, 4), l.text.transform[4] + dx, l.text.transform[5] + dy];
  for (const path of l.vectorMask?.paths ?? []) {
    for (const k of path.knots) k.points = k.points.map((v, i) => v + (i % 2 === 0 ? dx : dy));
  }
  for (const c of l.children ?? []) shiftLayer(c, dx, dy);
}

/** Photoshop's largest PSD side (bigger needs PSB, which ag-psd and canvas.me don't write). */
export const ARTBOARD_MAX_SIDE = 30_000;
/**
 * The most document pixels an artboard export may have: ag-psd allocates about 12 bytes per
 * document pixel while writing (even with no composite), so 50 M px is ~600 MB.
 */
export const ARTBOARD_MAX_PIXELS = 50_000_000;
export const ARTBOARDS_TOO_BIG = "Too many or too large pages to export as artboards — export the current page instead.";

export type ArtboardLayout = { width: number; height: number; rects: { left: number; top: number; right: number; bottom: number }[] };

/**
 * Where each page goes: a grid in reading order (left to right, then the next row), the same
 * number of pages in every row except the last, 100 px between pages and rows, each row as tall
 * as its tallest page. One row when it fits; otherwise the fewest rows whose document stays within
 * 30,000 px a side and `ARTBOARD_MAX_PIXELS` (of those, the smallest document). Throws
 * `ARTBOARDS_TOO_BIG` when no grid fits, before anything is rendered or allocated.
 */
export function artboardLayout(sizes: { width: number; height: number }[]): ArtboardLayout {
  let best: (ArtboardLayout & { rows: number }) | null = null;
  for (let cols = sizes.length; cols >= 1; cols--) {
    const rects: ArtboardLayout["rects"] = [];
    let width = 0;
    let top = 0;
    for (let i = 0; i < sizes.length; i += cols) {
      const row = sizes.slice(i, i + cols);
      let x = 0;
      for (const p of row) {
        rects.push({ left: x, top, right: x + p.width, bottom: top + p.height });
        x += p.width + ARTBOARD_GAP;
      }
      width = Math.max(width, x - ARTBOARD_GAP);
      top += Math.max(...row.map((p) => p.height)) + ARTBOARD_GAP;
    }
    const height = Math.max(1, top - ARTBOARD_GAP);
    width = Math.max(1, width);
    if (width > ARTBOARD_MAX_SIDE || height > ARTBOARD_MAX_SIDE || width * height > ARTBOARD_MAX_PIXELS) continue;
    const rows = Math.ceil(sizes.length / cols);
    if (!best || rows < best.rows || (rows === best.rows && width * height < best.width * best.height)) best = { width, height, rects, rows };
  }
  if (!best) throw new Error(ARTBOARDS_TOO_BIG);
  return { width: best.width, height: best.height, rects: best.rects };
}

/**
 * Several pages as one document of artboards laid out by `artboardLayout`, each a top-level
 * folder with its rect, its page background as the artboard colour and its elements inside, each
 * page at its own size. The caller renders the composite. Throws (before rendering anything) when
 * the document would be too big to write.
 */
export async function buildArtboardPsd(design: Design, pages: Page[], renderLayer: RenderLayer, notes: string[] = [], io: BuildIo = {}): Promise<Psd> {
  const layout = artboardLayout(pages.map((p) => pageSize(design, p)));
  const cx: Cx = { renderLayer, io, notes };
  const children: Layer[] = [];
  for (const [i, page] of pages.entries()) {
    const rect = layout.rects[i];
    const inner = await pageLayers(page, cx);
    for (const l of inner) shiftLayer(l, rect.left, rect.top);
    children.push({
      name: `Artboard ${i + 1}`,
      opened: true,
      blendMode: "pass through",
      children: inner,
      artboard: { rect: { ...rect }, color: rgbOf(page.background), backgroundType: 4, presetName: "Custom" },
    });
  }
  return {
    width: layout.width,
    height: layout.height,
    children,
    artboards: { count: pages.length, docDefaultNewArtboardBackgroundColor: { r: 255, g: 255, b: 255 }, docDefaultNewArtboardBackgroundType: 1 },
    imageResources: { globalAngle: GLOBAL_ANGLE, globalAltitude: 30 },
  };
}

/** Layers for a level of the page tree, bottom first; groups become folders. */
async function treeLayers(nodes: RenderNode[], cx: Cx): Promise<Layer[]> {
  const out: Layer[] = [];
  for (const n of nodes) {
    if (n.el.type === "group") out.push(await groupLayer(n.el, n.children ?? [], cx));
    else if (n.el.type === "adjustment") out.push(await adjustmentLayer(n.el, cx));
    else out.push(await elementLayer(n.el, cx));
  }
  return out;
}

/** A group's folder: its own opacity, blend mode (undefined = pass through), effects and visibility. */
async function groupLayer(el: GroupElement, children: RenderNode[], cx: Cx): Promise<Layer> {
  const layer: Layer = {
    name: layerName(el),
    opened: !el.collapsed,
    opacity: el.opacity,
    hidden: el.hidden,
    blendMode: el.blendMode && el.blendMode !== "pass-through" ? BLEND_TO_PSD[el.blendMode] : "pass through",
    children: await treeLayers(children, cx),
  };
  if (el.clipped) layer.clipping = true;
  const fx = modelEffectsToPsd(el.effects);
  if (fx && Object.keys(fx).length) layer.effects = fx;
  return layer;
}
