// Turns ag-psd's parsed document into plain layer data: a PNG per pixel layer, the properties
// of text layers, their effects, blend modes and fill opacity, and notes about anything left out
// or simplified. Runs in the worker; pure apart from `io.encode`, so tests run it too.
import type { Layer, PixelData, Psd, Warp } from "ag-psd";
import type { BlendMode, Effects } from "../effects";
import type { ImportIssue, VectorMask } from "../model";
import { vectorBounds } from "../vector";
import { BakeTooLargeError, MAX_BAKE_PIXELS, bakeEffects } from "../fx/bake";
import { fromImageData, toPixels } from "../fx/raster";
import { colorHex, mapBlendMode, psdEffectsToModel, textColorHex, type UnsupportedFx } from "./psdEffects";
import type { Adjustment } from "../adjustments";
import { psdAdjustmentToModel } from "./psdAdjust";
import { imageInfo, type ImageInfo } from "./imageSniff";
import { KNOT_BUDGET, readVectorLayer, readVectorMask, takeKnots, type PsdVector } from "./psdVector";

export { colorHex };

/** One character style run of a text layer, in document pixels (the text transform's scale applied). */
export type PsdTextRun = {
  length: number;
  fontName: string;
  fauxBold: boolean;
  fauxItalic: boolean;
  fontSize: number;
  fill: string;
  letterSpacing: number;
  underline: boolean;
  strike: boolean;
  /** Up, in document pixels. */
  baselineShift: number;
  caps?: "all" | "small";
  scaleX: number;
  scaleY: number;
};

/** One paragraph style run, in document pixels. */
export type PsdParagraphRun = {
  length: number;
  align: "left" | "center" | "right";
  indent: number;
  startIndent: number;
  endIndent: number;
  spaceBefore: number;
  spaceAfter: number;
};

export type PsdText = {
  text: string;
  /** The style of the run covering the most characters (kept for callers that read one style). */
  fontName: string;
  fauxBold: boolean;
  fauxItalic: boolean;
  /** Font size in document pixels (the text transform's scale applied). */
  fontSize: number;
  fill: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  underline: boolean;
  /** Every character style run, covering the text exactly. */
  runs: PsdTextRun[];
  /** Paragraph runs, covering the text exactly; absent when the file has none. */
  paragraphs?: PsdParagraphRun[];
  /** Clockwise, in degrees (the text transform's rotation). */
  rotation: number;
  /** Paragraph (box) text: its frame's top-left corner in document pixels, and its width. */
  box?: { x: number; y: number; width: number };
  /** Point text: the anchor of the first line's baseline. */
  anchor?: { x: number; y: number };
};

/**
 * One layer, or a group. Nodes come bottom first, each group right after (above) its members,
 * which is the editor's own element order.
 */
export type PsdNode = {
  /** "group" for a folder, "adjustment" for an adjustment layer; absent for a layer. */
  kind?: "group" | "adjustment";
  /** An adjustment layer's settings. Its box is left to the builder: the full page. */
  adjustment?: Adjustment;
  /**
   * An adjustment layer's mask as a grayscale PNG (value in colour and alpha), placed at
   * left/top in document pixels; outside it the mask is `outside` (0..1, absent = 0).
   */
  mask?: { png: Blob; left: number; top: number; width: number; height: number; outside?: number };
  /** A top-level folder that is an artboard: its rect in document pixels and page background. */
  artboard?: { left: number; top: number; width: number; height: number; background?: string };
  /** A group's key, which its members carry as `parent`. */
  key?: number;
  /** The key of the group the node sits in; null at the top level. */
  parent: number | null;
  /** A folder that was closed in Photoshop's Layers panel. */
  collapsed?: boolean;
  /** Clipped to the nearest non-clipped node below it in the same parent (Photoshop clipping). */
  clipped?: boolean;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  hidden: boolean;
  png?: Blob;
  text?: PsdText;
  /** undefined = normal. */
  blendMode?: BlendMode;
  /** Opacity of the content alone, effects unfaded; undefined = 1. */
  fillOpacity?: number;
  /** Effects that stay editable, in document pixels. */
  effects?: Effects;
  /** What was simplified on this layer. */
  issues?: ImportIssue[];
  /** A shape layer kept as a vector (document pixels); left/top/width/height are its path bounds. */
  vector?: PsdVector;
  /** The layer's vector mask, in document pixels. */
  vectorMask?: VectorMask;
  /**
   * Clockwise degrees about (left, top): a smart object drawn from its original, whose box
   * (left/top/width/height) is then its own frame, not its pixel bounds.
   */
  rotation?: number;
  /** A smart object's original embedded image, used instead of the layer's pixels. */
  original?: { blob: Blob; mime: ImageInfo["mime"]; width: number; height: number; name: string };
  /** How far baked effects grew the layer past its own pixels (already in left/top/width/height). */
  pad?: { l: number; t: number; r: number; b: number };
};

/** An issue on a layer that didn't become a node (a dropped layer). */
export type PsdLayerIssue = ImportIssue & { layerName: string };

export type PsdResult = {
  width: number;
  height: number;
  nodes: PsdNode[];
  composite?: Blob;
  notes: string[];
  layerIssues: PsdLayerIssue[];
  /** Layers couldn't be read, so `nodes` is empty and only the flattened image came through. */
  flattened: boolean;
  /** Something visible was dropped or approximated, so the flattened image is worth keeping as a hidden layer. */
  lossy: boolean;
};

export type Encode = (rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number) => Promise<Blob>;

const MAX_LAYERS = 1000;

const UNSUPPORTED_LABELS: Record<UnsupportedFx, string> = {
  bevel: "Bevel & emboss",
  satin: "Satin",
  patternOverlay: "Pattern overlay",
  patternStroke: "Pattern stroke",
  noiseGradient: "Noise gradient",
};


/** 8-bit RGBA copy of any bit depth ag-psd decodes (8, 16 or 32 bits per channel). */
export function toRgba8(p: PixelData): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(p.width * p.height * 4);
  const d = p.data;
  if (d instanceof Uint16Array) for (let i = 0; i < out.length; i++) out[i] = d[i] >> 8;
  else if (d instanceof Float32Array) for (let i = 0; i < out.length; i++) out[i] = d[i] * 255;
  else out.set(d);
  return out;
}

/** Apply a layer's pixel mask to its alpha, in place. Vector masks aren't drawn. */
function applyMask(rgba: Uint8ClampedArray, layer: Layer, w: number, h: number) {
  const m = layer.mask;
  if (!m || m.disabled || !m.imageData) return false;
  const md = toRgba8(m.imageData);
  const mw = m.imageData.width;
  const mh = m.imageData.height;
  const ml = m.left ?? 0;
  const mt = m.top ?? 0;
  const def = m.defaultColor ?? 0;
  const lx = layer.left ?? 0;
  const ly = layer.top ?? 0;
  for (let y = 0; y < h; y++) {
    const my = ly + y - mt;
    for (let x = 0; x < w; x++) {
      const mx = lx + x - ml;
      const v = mx >= 0 && my >= 0 && mx < mw && my < mh ? md[(my * mw + mx) * 4] : def;
      const i = (y * w + x) * 4 + 3;
      rgba[i] = (rgba[i] * v) / 255;
    }
  }
  return true;
}

const isBlank = (rgba: Uint8ClampedArray) => {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) return false;
  return true;
};

const JUSTIFY = new Map<string, PsdText["align"]>([
  ["left", "left"],
  ["center", "center"],
  ["right", "right"],
  ["justify-left", "left"],
  ["justify-center", "center"],
  ["justify-right", "right"],
  ["justify-all", "left"],
]);

/** Why a text layer can't be an editable text box, or its properties. */
function readText(layer: Layer): PsdText | { reason: string } | null {
  const t = layer.text;
  if (!t || !t.text.trim()) return null;
  if (t.orientation === "vertical") return { reason: "vertical" };
  if (t.textPath) return { reason: "on-path" };
  if (t.warp?.style && t.warp.style !== "none") return { reason: "warped" };
  const [xx, xy, yx, yy, tx, ty] = t.transform ?? [1, 0, 0, 1, layer.left ?? 0, layer.top ?? 0];
  // Rotation and scale stay editable; skew and mirroring can't be a text box here.
  const sx = Math.hypot(xx, xy);
  const sy = Math.hypot(yx, yy);
  const ok = [xx, xy, yx, yy, tx, ty].every(Number.isFinite) && sx > 1e-6 && sy > 1e-6;
  if (!ok || Math.abs(xx * yx + xy * yy) / (sx * sy) > 1e-3 || xx * yy - xy * yx <= 0) return { reason: "skewed" };
  const rotation = (Math.atan2(xy, xx) * 180) / Math.PI;
  // A horizontal stretch beyond the vertical one becomes the runs' horizontal scale.
  const stretch = Math.abs(sx / sy - 1) < 1e-3 ? 1 : sx / sy;

  // The text as the editor keeps it, with the run covering each character carried along.
  const raw = t.text;
  const runOf = new Int32Array(raw.length).fill(-1);
  const styleRuns = t.styleRuns?.length ? t.styleRuns : [{ length: raw.length, style: {} }];
  for (let i = 0, k = 0; k < styleRuns.length && i < raw.length; k++) {
    const n = Math.max(0, Math.floor(styleRuns[k].length) || 0);
    runOf.fill(k, i, Math.min(raw.length, i + n));
    i += n;
  }
  const lastRun = styleRuns.length - 1;
  const paraRuns = t.paragraphStyleRuns ?? [];
  const paraOf = new Int32Array(raw.length).fill(-1);
  for (let i = 0, k = 0; k < paraRuns.length && i < raw.length; k++) {
    const n = Math.max(0, Math.floor(paraRuns[k].length) || 0);
    paraOf.fill(k, i, Math.min(raw.length, i + n));
    i += n;
  }
  let text = "";
  const chars: number[] = [];
  const paras: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    let c = raw[i];
    if (c === "\n" && raw[i - 1] === "\r") continue;
    if (c === "\r" || c === "\u0003") c = "\n";
    text += c;
    chars.push(runOf[i] < 0 ? lastRun : runOf[i]);
    paras.push(paraOf[i] < 0 ? paraRuns.length - 1 : paraOf[i]);
  }
  while (text.endsWith("\n")) {
    text = text.slice(0, -1);
    chars.pop();
    paras.pop();
  }
  if (!text.trim()) return null;

  const supSize = t.superscriptSize ?? 0.583;
  const supPos = t.superscriptPosition ?? 0.333;
  const subSize = t.subscriptSize ?? 0.583;
  const subPos = t.subscriptPosition ?? 0.333;
  const runStyle = (k: number): Omit<PsdTextRun, "length"> => {
    const st = { ...t.style, ...styleRuns[k]?.style };
    let size = (st.fontSize ?? 12) * sy;
    let shift = (st.baselineShift ?? 0) * sy;
    // Superscript and subscript: Photoshop's sizes and positions for them, as a size and a shift.
    if (st.fontBaseline === 1) {
      shift += size * supPos;
      size *= supSize;
    } else if (st.fontBaseline === 2) {
      shift -= size * subPos;
      size *= subSize;
    }
    const scale = (v: number | undefined) => (v !== undefined && Number.isFinite(v) && v > 0 ? Math.min(10, v) : 1);
    return {
      fontName: st.font?.name ?? "",
      fauxBold: !!st.fauxBold,
      fauxItalic: !!st.fauxItalic,
      fontSize: Math.max(0.1, size),
      fill: textColorHex(st.fillColor),
      // Tracking is in thousandths of the size, before super/subscript.
      letterSpacing: ((st.tracking ?? 0) / 1000) * (st.fontSize ?? 12) * sy,
      underline: !!st.underline,
      strike: !!st.strikethrough,
      baselineShift: Number.isFinite(shift) ? shift : 0,
      ...(st.fontCaps === 2 ? { caps: "all" as const } : st.fontCaps === 1 ? { caps: "small" as const } : {}),
      scaleX: Math.min(10, scale(st.horizontalScale) * stretch),
      scaleY: scale(st.verticalScale),
    };
  };
  const runs: PsdTextRun[] = [];
  for (let i = 0; i < chars.length; ) {
    let j = i + 1;
    while (j < chars.length && chars[j] === chars[i]) j++;
    runs.push({ length: j - i, ...runStyle(chars[i]) });
    i = j;
  }
  let paragraphs: PsdParagraphRun[] | undefined;
  if (paraRuns.length) {
    paragraphs = [];
    for (let i = 0; i < paras.length; ) {
      let j = i + 1;
      while (j < paras.length && paras[j] === paras[i]) j++;
      const ps = { ...t.paragraphStyle, ...paraRuns[paras[i]]?.style };
      const num = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? v * sy : 0);
      paragraphs.push({
        length: j - i,
        align: JUSTIFY.get(ps.justification ?? "left") ?? "left",
        indent: num(ps.firstLineIndent),
        startIndent: num(ps.startIndent),
        endIndent: num(ps.endIndent),
        spaceBefore: num(ps.spaceBefore),
        spaceAfter: num(ps.spaceAfter),
      });
      i = j;
    }
  }
  // The single-style fields: the run covering the most characters.
  const main = runs.reduce((a, b) => (b.length > a.length ? b : a), runs[0]);
  const mainStyle = { ...t.style, ...styleRuns[chars[runs.slice(0, runs.indexOf(main)).reduce((n, r) => n + r.length, 0)]]?.style };
  const size = mainStyle.fontSize ?? 12;
  const leading = !mainStyle.autoLeading && mainStyle.leading ? mainStyle.leading / size : 1.2;
  const firstAlign = paragraphs?.[0]?.align ?? JUSTIFY.get(t.paragraphStyle?.justification ?? "left") ?? "left";
  const base = {
    text,
    fontName: main.fontName,
    fauxBold: main.fauxBold,
    fauxItalic: main.fauxItalic,
    fontSize: main.fontSize,
    fill: main.fill,
    align: firstAlign,
    lineHeight: Math.max(0.5, Math.min(5, leading)),
    letterSpacing: main.letterSpacing,
    underline: main.underline,
    runs,
    ...(paragraphs ? { paragraphs } : {}),
    rotation: Math.abs(rotation) < 1e-6 ? 0 : rotation,
  };
  if (t.shapeType === "box" && t.boxBounds?.length === 4) {
    const [l, top, r] = t.boxBounds;
    return { ...base, box: { x: tx + l * xx + top * yx, y: ty + l * xy + top * yy, width: (r - l) * sx } };
  }
  return { ...base, anchor: { x: tx, y: ty } };
}

/** A smart object's original may be at most this big (the editor's upload limit) and this many pixels a side. */
export const MAX_SMART_BYTES = 25 * 1024 * 1024;
export const MAX_SMART_SIDE = 16384;
/** All originals of a file together (each is copied out of the file buffer). */
export const MAX_SMART_TOTAL = 150 * 1024 * 1024;

/** Whether a warp is none or the identity mesh (what writers put on an unwarped smart object). */
function isFlatWarp(w: Warp | undefined) {
  if (!w || !w.style || w.style === "none") return true;
  if (w.style !== "custom") return false;
  const pts = w.customEnvelopeWarp?.meshPoints ?? [];
  if (pts.length !== 16) return false;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const tol = Math.max(x1 - x0, y1 - y0, 1) * 1e-4;
  return pts.every((p, i) => Math.abs(p.x - (x0 + ((x1 - x0) * (i % 4)) / 3)) <= tol && Math.abs(p.y - (y0 + ((y1 - y0) * Math.floor(i / 4)) / 3)) <= tol);
}

type SmartFrame = { left: number; top: number; width: number; height: number; rotation: number };

/**
 * A smart object's placed frame when its transform is a rotated, scaled rectangle (no skew,
 * perspective or mirroring); corners are top-left, top-right, bottom-right, bottom-left.
 */
export function smartFrame(t: number[] | undefined): SmartFrame | null {
  if (!t || t.length !== 8 || !t.every(Number.isFinite)) return null;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = t;
  const ux = x1 - x0;
  const uy = y1 - y0;
  const vx = x3 - x0;
  const vy = y3 - y0;
  const w = Math.hypot(ux, uy);
  const h = Math.hypot(vx, vy);
  if (w < 1e-3 || h < 1e-3) return null;
  const tol = Math.max(0.5, Math.max(w, h) * 1e-3);
  // A parallelogram ...
  if (Math.abs(x0 + x2 - x1 - x3) > tol || Math.abs(y0 + y2 - y1 - y3) > tol) return null;
  // ... with square corners, not mirrored.
  if (Math.abs(ux * vx + uy * vy) / (w * h) > 2e-3 || ux * vy - uy * vx <= 0) return null;
  const rotation = (Math.atan2(uy, ux) * 180) / Math.PI;
  return { left: x0, top: y0, width: w, height: h, rotation: Math.abs(rotation) < 1e-6 ? 0 : rotation };
}

/**
 * The original image of a smart object and its frame, or why the layer's pixels are used.
 * `reason` is null when there's nothing to tell (no embedded file).
 */
function smartOriginal(layer: Layer, psd: Psd, budget: { left: number }): { frame: SmartFrame; original: NonNullable<PsdNode["original"]> } | { reason: ImportIssue | null } {
  const placed = layer.placedLayer!;
  const file = psd.linkedFiles?.find((f) => f.id === placed.id);
  if (!file?.data?.length) return { reason: null };
  const info = imageInfo(file.data);
  if (!info) return { reason: { kind: "info", message: "Embedded PSD, AI or PDF smart object: its pixels were used." } };
  if (placed.filter) return { reason: { kind: "baked", message: "Smart filters were baked: the smart object's pixels were used." } };
  if (!isFlatWarp(placed.warp)) return { reason: { kind: "baked", message: "Warped smart object kept as its pixels." } };
  const frame = smartFrame(placed.nonAffineTransform ?? placed.transform);
  if (!frame) return { reason: { kind: "baked", message: "Distorted (perspective or skew) smart object kept as its pixels." } };
  if (file.data.length > MAX_SMART_BYTES || file.data.length > budget.left || info.width > MAX_SMART_SIDE || info.height > MAX_SMART_SIDE) {
    return { reason: { kind: "info", message: "The smart object's original is too large to open here; its pixels were used." } };
  }
  budget.left -= file.data.length;
  // Copied out of the file buffer, so the parsed file can go once the worker is done.
  const blob = new Blob([file.data.slice() as Uint8Array<ArrayBuffer>], { type: info.mime });
  return { frame, original: { blob, mime: info.mime, width: info.width, height: info.height, name: (file.name || layer.name || "Smart object").slice(0, 200) } };
}

/** The file's resolution in pixels per inch (Points in effects scale with it). */
function dpiOf(psd: Psd) {
  const r = psd.imageResources?.resolutionInfo;
  const v = r?.horizontalResolution;
  if (!v || !Number.isFinite(v) || v <= 0) return 72;
  return r.horizontalResolutionUnit === "PPCM" ? v * 2.54 : v;
}


/** Plain layer data from a parsed file. */
export async function convert(
  psd: Psd,
  report: (done: number, total: number) => void,
  io: { encode: Encode },
  o?: { knotBudget?: number },
): Promise<PsdResult> {
  const png = io.encode;
  const notes = new Set<string>();
  const nodes: PsdNode[] = [];
  const layerIssues: PsdLayerIssue[] = [];
  let lossy = false;
  let count = 0;
  let groups = 0;
  const ctx = { dpi: dpiOf(psd), globalAngle: psd.imageResources?.globalAngle ?? 120 };
  const doc = { width: psd.width, height: psd.height };
  // Live path points left for this file (drawing and editing cost grows with them).
  const knots = { left: o?.knotBudget ?? KNOT_BUDGET };
  const smartBudget = { left: MAX_SMART_TOTAL };
  // Counted without recursion, stopping past the limit: a deep folder chain can't overflow the stack.
  let total = 0;
  for (const stack: Layer[][] = [psd.children ?? []]; stack.length && total <= MAX_LAYERS; ) {
    for (const l of stack.pop()!) {
      total++;
      if (l.children) stack.push(l.children);
    }
  }
  if (total > MAX_LAYERS) throw new Error(`This file has more than ${MAX_LAYERS} layers; canvas.me imports up to ${MAX_LAYERS}.`);

  // `hidden`: an enclosing group is hidden, so nothing here shows (for `lossy` only).
  // Layers that became nodes, so a clipped layer knows whether its base came through.
  const emitted = new Set<Layer>();
  const walk = async (layers: Layer[], group: number | null, hidden: boolean) => {
    // The last non-clipped layer of this level was left out: what's clipped to it is released.
    let baseGone = false;
    // Whether anything of this level came through below: a clipped bottom layer clips to nothing.
    let below = false;
    let prev: Layer | null = null;
    for (const layer of layers) {
      if (prev && !prev.clipping) baseGone = !emitted.has(prev);
      if (prev && emitted.has(prev)) below = true;
      prev = layer;
      report(++count, total);
      const name = layer.name || "Layer";
      const layerHidden = hidden || !!layer.hidden;
      const layerOpacity = layer.opacity ?? 1;
      const issues: ImportIssue[] = [];
      const flag = (i: ImportIssue) => {
        issues.push(i);
        if (!layerHidden && i.kind !== "baked" && i.kind !== "info") lossy = true;
      };
      // Clipping stays clipping, unless the layer it clips to was left out (then it shows in full).
      const clip = (node: PsdNode) => {
        if (!layer.clipping || !below) return;
        if (!baseGone) node.clipped = true;
        else {
          notes.add("Some layers were clipped to a layer that was left out; they show in full.");
          if (!layerHidden) lossy = true;
        }
      };
      if (layer.children) {
        const key = ++groups;
        const gfx = psdEffectsToModel(layer.effects, ctx);
        const node: PsdNode = { kind: "group", key, parent: group, name, left: 0, top: 0, width: 0, height: 0, opacity: layerOpacity, hidden: !!layer.hidden };
        if (layer.opened === false) node.collapsed = true;
        const ab = layer.artboard;
        if (ab && group === null && ab.rect) {
          const r = ab.rect;
          const bgType = ab.backgroundType;
          node.artboard = {
            left: r.left,
            top: r.top,
            width: Math.max(1, r.right - r.left),
            height: Math.max(1, r.bottom - r.top),
            // 4 = a custom colour, 2 = black; white or transparent come out white.
            ...(bgType === 4 && ab.color ? { background: colorHex(ab.color) } : bgType === 2 ? { background: "#000000" } : {}),
          };
        }
        clip(node);
        // A group's mode: absent or "pass through" is pass-through (undefined); normal isolates and is kept.
        if (layer.blendMode && layer.blendMode !== "pass through") {
          const blend = layer.blendMode === "normal" ? { mode: "normal" as const } : mapBlendMode(layer.blendMode);
          if (blend.mode) node.blendMode = blend.mode;
          if (blend.approximated) flag({ kind: "approximated", message: `Blend mode "${layer.blendMode}" has no equivalent here and shows as Normal.` });
        }
        if (gfx.effects) node.effects = gfx.effects;
        if (gfx.approximated.length) flag({ kind: "approximated", message: "Glow noise, jitter and range were simplified." });
        if (gfx.unsupported.length) {
          const labels = gfx.unsupported.map((u) => UNSUPPORTED_LABELS[u]).join(", ");
          flag({ kind: "dropped", message: `${labels} on a group can't be drawn here and ${gfx.unsupported.length > 1 ? "were" : "was"} left out.` });
        }
        if (layer.fillOpacity !== undefined && layer.fillOpacity < 1) {
          flag({ kind: "dropped", message: "The group's fill opacity was left out (groups here have opacity only)." });
        }
        if (readVectorMask(layer.vectorMask, doc)) flag({ kind: "dropped", message: "The group's vector mask was left out (groups here can't be masked)." });
        await walk(layer.children, key, layerHidden);
        if (issues.length) node.issues = issues;
        nodes.push(node);
        emitted.add(layer);
        continue;
      }
      if (layer.adjustment) {
        const adj = psdAdjustmentToModel(layer.adjustment);
        if (!adj) {
          const what = layer.adjustment.type === "color lookup" ? "Color lookup" : layer.adjustment.type === "selective color" ? "Selective color" : "This adjustment";
          notes.add(`${what} adjustment layers can't be drawn here and were left out; the flattened image keeps their look.`);
          flag({ kind: "dropped", message: `${what} adjustment layer left out.` });
          layerIssues.push(...issues.map((i) => ({ ...i, layerName: name })));
          continue;
        }
        const node: PsdNode = {
          kind: "adjustment",
          adjustment: adj,
          parent: group,
          name,
          left: 0,
          top: 0,
          width: doc.width,
          height: doc.height,
          // An adjustment has no effects, so its fill opacity fades it just like opacity.
          opacity: layerOpacity * Math.max(0, Math.min(1, layer.fillOpacity ?? 1)),
          hidden: !!layer.hidden,
        };
        clip(node);
        const blend = mapBlendMode(layer.blendMode);
        if (blend.mode) node.blendMode = blend.mode;
        if (blend.approximated) flag({ kind: "approximated", message: `Blend mode "${layer.blendMode}" has no equivalent here and shows as Normal.` });
        const m = layer.mask;
        if (m && !m.disabled) {
          const outside = Math.max(0, Math.min(1, (m.defaultColor ?? 0) / 255));
          const mw = m.imageData?.width ?? 0;
          const mh = m.imageData?.height ?? 0;
          if (m.imageData && mw > 0 && mh > 0) {
            const src = toRgba8(m.imageData);
            const out = new Uint8ClampedArray(mw * mh * 4);
            for (let i = 0; i < mw * mh * 4; i += 4) {
              const v = src[i];
              out[i] = out[i + 1] = out[i + 2] = out[i + 3] = v;
            }
            node.mask = { png: await png(out, mw, mh), left: m.left ?? 0, top: m.top ?? 0, width: mw, height: mh, ...(outside > 0 ? { outside } : {}) };
          } else if (outside < 1) {
            // A mask with no pixels is its default colour everywhere: black hides the whole adjustment.
            if (outside === 0) node.hidden = true;
            else flag({ kind: "approximated", message: "The layer mask was simplified." });
          }
        }
        if (layer.vectorMask && readVectorMask(layer.vectorMask, doc)) flag({ kind: "dropped", message: "The adjustment's vector mask was left out." });
        if (issues.length) node.issues = issues;
        nodes.push(node);
        emitted.add(layer);
        continue;
      }

      const blend = mapBlendMode(layer.blendMode);
      if (blend.approximated) flag({ kind: "approximated", message: `Blend mode "${layer.blendMode}" has no equivalent here and shows as Normal.` });
      const fill = Math.max(0, Math.min(1, layer.fillOpacity ?? 1));
      const fx = psdEffectsToModel(layer.effects, ctx);
      if (fx.approximated.length) flag({ kind: "approximated", message: "Glow noise, jitter and range were simplified." });

      let left = layer.left ?? 0;
      let top = layer.top ?? 0;
      let w = (layer.right ?? 0) - left;
      let h = (layer.bottom ?? 0) - top;
      const node: PsdNode = { parent: group, name, left, top, width: w, height: h, opacity: layerOpacity, hidden: !!layer.hidden };
      clip(node);
      if (blend.mode) node.blendMode = blend.mode;
      if (fill < 1) node.fillOpacity = fill;
      if (fx.effects) node.effects = fx.effects;
      const unsupported = fx.unsupported.map((u) => UNSUPPORTED_LABELS[u]).join(", ");
      const finish = () => {
        if (issues.length) node.issues = issues;
        nodes.push(node);
        emitted.add(layer);
      };

      // A shape layer stays a vector unless something on it needs its pixels (baked effects, a pattern).
      // A pixel mask can't sit on a vector here, so a masked shape keeps its pixels with the mask applied.
      const pixelMasked = !!layer.mask && !layer.mask.disabled && !!layer.mask.imageData && !!layer.imageData;
      if (layer.vectorFill && layer.vectorMask) {
        const rv = readVectorLayer(layer, ctx.dpi, doc);
        if (rv && "vector" in rv && pixelMasked) flag({ kind: "baked", message: "Shape with pixel mask kept as image." });
        else if (rv && "vector" in rv && !unsupported && !takeKnots(knots, layer.vectorMask.paths)) {
          flag({ kind: "baked", message: "Too many path points in this file: the shape was kept as an image." });
        } else if (rv && "vector" in rv && !unsupported) {
          const b = vectorBounds(rv.vector.subpaths);
          Object.assign(node, { left: b.x, top: b.y, width: Math.max(b.width, 0.1), height: Math.max(b.height, 0.1), vector: rv.vector });
          finish();
          continue;
        }
        if (rv && "reason" in rv) flag({ kind: "baked", message: `${rv.reason} was baked into pixels.` });
      }
      // A vector mask on any other layer stays a live mask (a shape layer's pixels are already its shape).
      let vmask = layer.vectorFill ? null : readVectorMask(layer.vectorMask, doc);
      if (vmask && !takeKnots(knots, layer.vectorMask?.paths)) {
        vmask = null;
        flag({ kind: "dropped", message: "Too many path points in this file: the vector mask was left out." });
      }

      const read = readText(layer);
      const text = read && "text" in read ? read : null;
      if (text) {
        if (vmask) flag({ kind: "dropped", message: "The vector mask on this text was left out." });
        // Editable text can't carry pixels, so what can't stay editable is left out rather than baked.
        if (unsupported) flag({ kind: "dropped", message: `${unsupported} can't be drawn on editable text and ${fx.unsupported.length > 1 ? "were" : "was"} left out.` });
        node.text = text;
        finish();
        continue;
      }
      // A smart object draws its original embedded image, unless something needs its pixels.
      if (layer.placedLayer) {
        const r = unsupported || pixelMasked ? { reason: null } : smartOriginal(layer, psd, smartBudget);
        if ("original" in r) {
          const f = r.frame;
          Object.assign(node, { left: f.left, top: f.top, width: f.width, height: f.height, original: r.original });
          if (f.rotation) node.rotation = f.rotation;
          if (vmask) node.vectorMask = vmask;
          finish();
          continue;
        }
        notes.add("Some smart objects came in as their flattened pixels.");
        if (r.reason) flag(r.reason);
      }
      if (read && "reason" in read) {
        notes.add("Warped, skewed, vertical or on-path text came in as images.");
        flag({ kind: "baked", message: `Text that is ${read.reason} was kept as pixels.` });
      }
      if (!layer.imageData || w <= 0 || h <= 0) {
        if (layer.vectorFill || layer.placedLayer) {
          notes.add("Some shape or fill layers had no pixels saved and were left out.");
          if (!layerHidden) lossy = true;
        }
        continue;
      }
      let rgba = toRgba8(layer.imageData);
      applyMask(rgba, layer, w, h);
      if (isBlank(rgba)) continue;
      const tooLarge = () => flag({ kind: "dropped", message: `${unsupported} left out: the layer is too large to bake.` });
      // Checked before the float raster (16 bytes a pixel) is made; the bake checks again with its padding.
      if (unsupported && layer.effects && w * h > MAX_BAKE_PIXELS) tooLarge();
      else if (unsupported && layer.effects) {
        try {
          const res = bakeEffects(fromImageData({ width: w, height: h, data: rgba }), layer.effects, {
            ...ctx,
            fillOpacity: fill,
            patterns: psd.patterns,
            seed: count,
            origin: { x: left, y: top },
          });
          rgba = toPixels(res.raster) as Uint8ClampedArray<ArrayBuffer>;
          const { pad } = res;
          left -= pad.l;
          top -= pad.t;
          w = res.raster.w;
          h = res.raster.h;
          Object.assign(node, { left, top, width: w, height: h });
          if (pad.l || pad.t || pad.r || pad.b) node.pad = pad;
          if (res.keep) node.effects = res.keep;
          else delete node.effects;
          delete node.fillOpacity;
          flag({ kind: "baked", message: `Baked into pixels: ${res.baked.join(", ")}.` });
          res.issues.forEach(flag);
        } catch (err) {
          if (err instanceof BakeTooLargeError) tooLarge();
          else flag({ kind: "dropped", message: `Couldn't bake ${unsupported}; ${fx.unsupported.length > 1 ? "they were" : "it was"} left out.` });
        }
      }
      node.png = await png(rgba, w, h);
      if (vmask) node.vectorMask = vmask;
      finish();
    }
  };
  await walk(psd.children ?? [], null, false);

  const composite = psd.imageData ? await png(toRgba8(psd.imageData), psd.imageData.width, psd.imageData.height) : undefined;
  return { width: psd.width, height: psd.height, nodes, composite, notes: [...notes], layerIssues, flattened: false, lossy };
}
