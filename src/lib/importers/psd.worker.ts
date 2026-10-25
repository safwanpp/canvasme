// Parses a Photoshop file off the main thread with ag-psd (MIT) and hands back plain layer data:
// a PNG per pixel layer, the properties of text layers, and notes about anything left out.
import { initializeCanvas, readPsd, type Color, type Layer, type PixelData, type Psd } from "ag-psd";

export type PsdText = {
  text: string;
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
  /** Paragraph (box) text: its frame in document pixels. */
  box?: { x: number; y: number; width: number };
  /** Point text: the anchor of the first line's baseline. */
  anchor?: { x: number; y: number };
};

export type PsdNode = {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  hidden: boolean;
  /** Index of the top-level group the layer sits in. */
  group: number | null;
  png?: Blob;
  text?: PsdText;
};

export type PsdRequest = { id: number; buffer: ArrayBuffer };
export type PsdResult = {
  width: number;
  height: number;
  nodes: PsdNode[];
  composite?: Blob;
  notes: string[];
  /** Layers couldn't be read, so `nodes` is empty and only the flattened image came through. */
  flattened: boolean;
  /** Something visible was simplified, so the flattened image is worth keeping as a hidden layer. */
  lossy: boolean;
};
export type PsdResponse =
  | { id: number; type: "progress"; done: number; total: number }
  | { id: number; type: "done"; result: PsdResult }
  | { id: number; type: "error"; message: string };

const MAX_LAYERS = 1000;

// No DOM in a worker: ag-psd only needs a canvas for a few conversions, and image data otherwise.
initializeCanvas(
  (w, h) => new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement,
  (w, h) => new ImageData(w, h),
);

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

function colorHex(c: Color | undefined): string {
  if (!c) return "#000000";
  if ("r" in c) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  if ("fr" in c) return `#${hex2(c.fr * 255)}${hex2(c.fg * 255)}${hex2(c.fb * 255)}`;
  if ("k" in c && "c" in c) {
    const k = 1 - c.k / 255;
    return `#${hex2(255 * (1 - c.c / 255) * k)}${hex2(255 * (1 - c.m / 255) * k)}${hex2(255 * (1 - c.y / 255) * k)}`;
  }
  return "#000000";
}

/** 8-bit RGBA copy of any bit depth ag-psd decodes (8, 16 or 32 bits per channel). */
function toRgba8(p: PixelData): Uint8ClampedArray<ArrayBuffer> {
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

async function png(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

const isBlank = (rgba: Uint8ClampedArray) => {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) return false;
  return true;
};

const JUSTIFY: Record<string, PsdText["align"]> = {
  left: "left",
  center: "center",
  right: "right",
  "justify-left": "left",
  "justify-center": "center",
  "justify-right": "right",
  "justify-all": "left",
};

/** Text-layer properties, or null when the text can't be an editable text box (warped, vertical, rotated, on a path). */
function readText(layer: Layer): PsdText | null {
  const t = layer.text;
  if (!t || !t.text.trim()) return null;
  if (t.orientation === "vertical" || t.textPath || (t.warp?.style && t.warp.style !== "none")) return null;
  const [xx, xy, yx, yy, tx, ty] = t.transform ?? [1, 0, 0, 1, layer.left ?? 0, layer.top ?? 0];
  if (Math.abs(xy) > 1e-3 || Math.abs(yx) > 1e-3 || xx <= 0 || yy <= 0) return null;
  const style = { ...t.style, ...t.styleRuns?.[0]?.style };
  const size = style.fontSize ?? 12;
  const leading = !style.autoLeading && style.leading ? style.leading / size : 1.2;
  const base = {
    text: t.text.replace(/\r\n?/g, "\n").replace(/\u0003/g, "\n").replace(/\n+$/, ""),
    fontName: style.font?.name ?? "",
    fauxBold: !!style.fauxBold,
    fauxItalic: !!style.fauxItalic,
    fontSize: size * yy,
    fill: colorHex(style.fillColor),
    align: JUSTIFY[t.paragraphStyle?.justification ?? t.paragraphStyleRuns?.[0]?.style.justification ?? "left"] ?? "left",
    lineHeight: Math.max(0.5, Math.min(5, leading)),
    letterSpacing: ((style.tracking ?? 0) / 1000) * size * yy,
    underline: !!style.underline,
  };
  if (t.shapeType === "box" && t.boxBounds?.length === 4) {
    const [l, top, r] = t.boxBounds;
    return { ...base, box: { x: tx + l * xx, y: ty + top * yy, width: (r - l) * xx } };
  }
  return { ...base, anchor: { x: tx, y: ty } };
}

function hasEffects(layer: Layer) {
  const fx = layer.effects;
  if (!fx || fx.disabled) return false;
  return Object.values(fx).some((e) =>
    Array.isArray(e) ? e.some((x) => x?.enabled !== false) : !!e && typeof e === "object" && e.enabled !== false,
  );
}

const NORMAL_BLENDS = new Set(["normal", "pass through", undefined]);

async function convert(psd: Psd, report: (done: number, total: number) => void): Promise<PsdResult> {
  const notes = new Set<string>();
  const nodes: PsdNode[] = [];
  let lossy = false;
  let count = 0;
  let groups = 0;
  const total = (function countLayers(ls: Layer[] = []): number {
    return ls.reduce((n, l) => n + 1 + countLayers(l.children), 0);
  })(psd.children);
  if (total > MAX_LAYERS) throw new Error(`This file has ${total} layers; canvas.me imports up to ${MAX_LAYERS}.`);

  const walk = async (layers: Layer[], group: number | null, opacity: number, hidden: boolean) => {
    for (const layer of layers) {
      report(++count, total);
      const name = layer.name || "Layer";
      const layerHidden = hidden || !!layer.hidden;
      const layerOpacity = opacity * (layer.opacity ?? 1) * (layer.fillOpacity ?? 1);
      if (!NORMAL_BLENDS.has(layer.blendMode)) {
        notes.add("Blend modes (multiply, screen, overlay…) show as Normal.");
        if (!layerHidden) lossy = true;
      }
      if (layer.children) {
        const g = group ?? ++groups;
        await walk(layer.children, g, layerOpacity, layerHidden);
        continue;
      }
      if (layer.adjustment) {
        notes.add("Adjustment layers (curves, levels, hue…) were left out.");
        if (!layerHidden) lossy = true;
        continue;
      }
      if (hasEffects(layer)) {
        notes.add("Layer effects (shadows, strokes, glows…) were left out.");
        if (!layerHidden) lossy = true;
      }
      if (layer.clipping) {
        notes.add("Clipping masks were released: clipped layers show in full.");
        if (!layerHidden) lossy = true;
      }
      if (layer.vectorMask && !layer.mask?.imageData) {
        notes.add("Vector masks were left out.");
        if (!layerHidden) lossy = true;
      }
      if (layer.placedLayer) notes.add("Smart objects came in as flat images.");

      const left = layer.left ?? 0;
      const top = layer.top ?? 0;
      const w = (layer.right ?? 0) - left;
      const h = (layer.bottom ?? 0) - top;
      const base = { name, left, top, width: w, height: h, opacity: layerOpacity, hidden: layerHidden, group };

      const text = readText(layer);
      if (text) {
        nodes.push({ ...base, text });
        continue;
      }
      if (layer.text) notes.add("Warped, rotated or vertical text came in as images.");
      if (!layer.imageData || w <= 0 || h <= 0) {
        if (layer.vectorFill || layer.placedLayer) {
          notes.add("Some shape or fill layers had no pixels saved and were left out.");
          if (!layerHidden) lossy = true;
        }
        continue;
      }
      const rgba = toRgba8(layer.imageData);
      applyMask(rgba, layer, w, h);
      if (isBlank(rgba)) continue;
      nodes.push({ ...base, png: await png(rgba, w, h) });
    }
  };
  await walk(psd.children ?? [], null, 1, false);

  const composite = psd.imageData ? await png(toRgba8(psd.imageData), psd.imageData.width, psd.imageData.height) : undefined;
  return { width: psd.width, height: psd.height, nodes, composite, notes: [...notes], flattened: false, lossy };
}

self.onmessage = async ({ data }: MessageEvent<PsdRequest>) => {
  const { id, buffer } = data;
  const post = (msg: PsdResponse) => self.postMessage(msg);
  try {
    let result: PsdResult;
    try {
      const psd = readPsd(buffer, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
      result = await convert(psd, (done, total) => post({ id, type: "progress", done, total }));
      if (!result.nodes.length && result.composite) result = { ...result, flattened: true };
    } catch (err) {
      // Layer data we can't read: fall back to the flattened image Photoshop saves with the file.
      if (err instanceof Error && err.message.startsWith("This file has")) throw err;
      let psd: Psd;
      try {
        psd = readPsd(buffer, { useImageData: true, skipLayerImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
      } catch {
        throw new Error("This Photoshop file is damaged or uses a format canvas.me can't read.");
      }
      if (!psd.imageData) throw new Error("This Photoshop file is damaged or uses a format canvas.me can't read.");
      result = {
        width: psd.width,
        height: psd.height,
        nodes: [],
        composite: await png(toRgba8(psd.imageData), psd.imageData.width, psd.imageData.height),
        notes: [],
        flattened: true,
        lossy: false,
      };
    }
    post({ id, type: "done", result });
  } catch (err) {
    post({ id, type: "error", message: (err as Error)?.message || "Couldn't read this Photoshop file." });
  }
};
