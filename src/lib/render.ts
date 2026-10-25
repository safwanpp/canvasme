import type Konva from "konva";
import type { Design, Element, ImageCrop, ImageElement, Page, ShapeElement, ShapeKind } from "./model";
import { ensureFonts } from "./fonts";
import { loadAssetImage } from "./images";

// One description of each element's Konva nodes, in the element's local
// coordinates (0..width, 0..height). The editor renders it with react-konva and
// exports build it imperatively, so both always draw the same thing.
export type NodeSpec = {
  kind: "Rect" | "Ellipse" | "Line" | "Arrow" | "Text" | "Image" | "Shape";
  attrs: Record<string, unknown>;
};

export function polygonPoints(kind: ShapeKind, w: number, h: number): number[] {
  if (kind === "triangle") return [w / 2, 0, w, h, 0, h];
  const pts: number[] = [];
  if (kind === "hexagon") {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      pts.push(w * (0.5 + 0.5 * Math.cos(a)), h * (0.5 + 0.5 * Math.sin(a)));
    }
    return pts;
  }
  // star: 5 points, inner radius ~0.4 of outer
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.5 : 0.2;
    const a = -Math.PI / 2 + (Math.PI / 5) * i;
    pts.push(w * (0.5 + r * Math.cos(a)), h * (0.55 + r * 1.05 * Math.sin(a)));
  }
  return pts;
}

type PathCtx = Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "lineTo" | "arcTo" | "ellipse" | "closePath">;

function roundedRect(ctx: PathCtx, w: number, h: number, radius: number) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
}

/** Start a path tracing a shape's outline in a w x h box, the same outline its node draws. */
export function traceShape(ctx: PathCtx, shape: ShapeElement, w: number, h: number) {
  ctx.beginPath();
  if (shape.shape === "rect") return roundedRect(ctx, w, h, shape.cornerRadius);
  if (shape.shape === "ellipse") {
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    return ctx.closePath();
  }
  const pts = polygonPoints(shape.shape, w, h);
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

/** A decoded asset, or the canvas an erase is painting on. */
export type Bitmap = HTMLImageElement | HTMLCanvasElement;

export const bitmapSize = (b: Bitmap) =>
  b instanceof HTMLImageElement ? { w: b.naturalWidth, h: b.naturalHeight } : { w: b.width, h: b.height };

export const FULL_CROP: ImageCrop = { x: 0, y: 0, width: 1, height: 1 };

/** The crop as a source rectangle in the bitmap's pixels. */
export function cropPixels(crop: ImageCrop | undefined, b: Bitmap) {
  const c = crop ?? FULL_CROP;
  const { w, h } = bitmapSize(b);
  return { x: c.x * w, y: c.y * h, width: c.width * w, height: c.height * h };
}

// A masked image is one custom shape rather than a clipped group: a group's client
// rect would be the whole picture, and the transformer must hug the mask instead.
function maskedImageAttrs(el: ImageElement, image?: Bitmap | null) {
  const m = el.mask!;
  const r = m.image;
  return {
    width: el.width,
    height: el.height,
    sceneFunc: (kctx: Konva.Context) => {
      const ctx = kctx._context;
      ctx.save();
      traceShape(ctx, m.shape, el.width, el.height);
      ctx.clip();
      if (!image) {
        ctx.fillStyle = "#e5e7eb";
        ctx.fill();
      } else {
        ctx.translate(r.x, r.y);
        ctx.rotate((r.rotation * Math.PI) / 180);
        if (el.cornerRadius > 0) {
          ctx.beginPath();
          roundedRect(ctx, r.width, r.height, el.cornerRadius);
          ctx.clip();
        }
        // A crop made before masking still applies to the picture inside the mask.
        const c = cropPixels(el.crop, image);
        ctx.drawImage(image, c.x, c.y, c.width, c.height, 0, 0, r.width, r.height);
      }
      ctx.restore();
    },
    // Clicks land only inside the mask's outline.
    hitFunc: (kctx: Konva.Context, shape: Konva.Shape) => {
      traceShape(kctx, m.shape, el.width, el.height);
      kctx.fillStrokeShape(shape);
    },
  };
}

export function fontStyle(bold: boolean, italic: boolean) {
  return [italic && "italic", bold && "bold"].filter(Boolean).join(" ") || "normal";
}

export function textAttrs(el: Extract<Element, { type: "text" }>) {
  return {
    x: 0,
    y: 0,
    width: el.width,
    text: el.text,
    fontFamily: `"${el.fontFamily}"`,
    fontSize: el.fontSize,
    fontStyle: fontStyle(el.bold, el.italic),
    textDecoration: el.underline ? "underline" : "",
    fill: el.fill,
    align: el.align,
    lineHeight: el.lineHeight,
    letterSpacing: el.letterSpacing,
  };
}

export function elementNodes(el: Element, image?: Bitmap | null): NodeSpec[] {
  const w = el.width;
  const h = el.height;
  switch (el.type) {
    case "text":
      return [{ kind: "Text", attrs: textAttrs(el) }];
    case "image":
      if (el.mask) return [{ kind: "Shape", attrs: maskedImageAttrs(el, image) }];
      if (!image) return [{ kind: "Rect", attrs: { width: w, height: h, fill: "#e5e7eb" } }];
      return [
        {
          kind: "Image",
          attrs: { width: w, height: h, image, cornerRadius: el.cornerRadius, crop: cropPixels(el.crop, image) },
        },
      ];
    case "line": {
      const sw = el.strokeWidth;
      return [
        {
          kind: el.arrowEnd ? "Arrow" : "Line",
          attrs: {
            points: [0, h / 2, w, h / 2],
            stroke: el.stroke,
            fill: el.stroke,
            strokeWidth: sw,
            dash: el.dashed ? [sw * 3, sw * 2] : undefined,
            lineCap: el.dashed ? "butt" : "round",
            pointerLength: sw * 3,
            pointerWidth: sw * 3,
            hitStrokeWidth: Math.max(20, sw),
          },
        },
      ];
    }
    case "path":
      return [
        {
          kind: "Line",
          attrs: {
            points: el.points,
            stroke: el.stroke,
            strokeWidth: el.strokeWidth,
            tension: 0.4,
            lineCap: "round",
            lineJoin: "round",
            hitStrokeWidth: Math.max(20, el.strokeWidth),
          },
        },
      ];
    case "shape": {
      const stroke = el.strokeWidth > 0 ? { stroke: el.stroke, strokeWidth: el.strokeWidth } : { strokeEnabled: false };
      if (el.shape === "rect") {
        return [{ kind: "Rect", attrs: { width: w, height: h, fill: el.fill, cornerRadius: el.cornerRadius, ...stroke } }];
      }
      if (el.shape === "ellipse") {
        return [{ kind: "Ellipse", attrs: { x: w / 2, y: h / 2, radiusX: w / 2, radiusY: h / 2, fill: el.fill, ...stroke } }];
      }
      return [
        {
          kind: "Line",
          attrs: { points: polygonPoints(el.shape, w, h), closed: true, fill: el.fill, lineJoin: "round", ...stroke },
        },
      ];
    }
  }
}

type Pt = { x: number; y: number };

/** The two ends of a line element in page coordinates (lines are stored horizontal, rotated about x,y). */
export function lineEnds(el: Extract<Element, { type: "line" }>): [Pt, Pt] {
  const a = (el.rotation * Math.PI) / 180;
  const p0 = { x: el.x - Math.sin(a) * (el.height / 2), y: el.y + Math.cos(a) * (el.height / 2) };
  return [p0, { x: p0.x + Math.cos(a) * el.width, y: p0.y + Math.sin(a) * el.width }];
}

/** Position, length and rotation that put a line of the given height from p0 to p1. */
export function lineBetween(p0: Pt, p1: Pt, height: number) {
  const a = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  // The stroke runs along y = height / 2, so shift the origin to put that on p0.
  return {
    x: p0.x + Math.sin(a) * (height / 2),
    y: p0.y - Math.cos(a) * (height / 2),
    width: Math.max(1, Math.hypot(p1.x - p0.x, p1.y - p0.y)),
    rotation: (a * 180) / Math.PI,
  };
}

export function groupAttrs(el: Element) {
  return { x: el.x, y: el.y, rotation: el.rotation, opacity: el.opacity, visible: !el.hidden };
}

export const pageFonts = (page: Page) =>
  page.elements.flatMap((e) => (e.type === "text" ? [e.fontFamily] : []));

type KonvaNS = typeof import("konva").default;

async function loadPageImages(els: Element[]) {
  const images = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    els.map(async (e) => {
      if (e.type === "image") images.set(e.assetId, await loadAssetImage(e.assetId));
    }),
  );
  return images;
}

/** An element's Konva group, built imperatively from the same specs the editor renders. */
function buildElement(Konva: KonvaNS, el: Element, images: Map<string, HTMLImageElement | null>) {
  const g = new Konva.Group(groupAttrs(el));
  const img = el.type === "image" ? images.get(el.assetId) : undefined;
  for (const n of elementNodes(el, img)) {
    const Ctor = Konva[n.kind] as unknown as new (a: Record<string, unknown>) => InstanceType<typeof Konva.Shape>;
    g.add(new Ctor(n.attrs));
  }
  return g;
}

/** Render one page off-screen at `pixelRatio` x the design size. */
export async function renderPageCanvas(design: Design, page: Page, pixelRatio: number) {
  const Konva = (await import("konva")).default;
  await ensureFonts(pageFonts(page));
  const images = await loadPageImages(page.elements);

  const container = document.createElement("div");
  const stage = new Konva.Stage({ container, width: design.width, height: design.height });
  const layer = new Konva.Layer();
  stage.add(layer);
  layer.add(new Konva.Rect({ width: design.width, height: design.height, fill: page.background }));
  for (const el of page.elements) {
    if (el.hidden) continue;
    layer.add(buildElement(Konva, el, images));
  }
  layer.draw();
  const canvas = stage.toCanvas({ pixelRatio });
  stage.destroy();
  return canvas;
}

// Rasterize resolution: at least the 2x of PNG export, more for an image that has more
// detail than that, but never a bitmap so big that a phone runs out of canvas memory.
const RASTER_MIN_RATIO = 2;
const RASTER_MAX_SIDE = 4096;
const RASTER_MAX_PIXELS = 16_000_000;

/** Pixels per design unit an image element shows at, so rasterizing it loses no detail. */
function nativeRatio(el: Element, images: Map<string, HTMLImageElement | null>) {
  const img = el.type === "image" ? images.get(el.assetId) : null;
  if (el.type !== "image" || !img) return 0;
  const src = cropPixels(el.crop, img);
  return el.mask ? src.width / el.mask.image.width : src.width / el.width;
}

/**
 * Render elements alone, on a transparent background, for Rasterize. One element is drawn
 * upright in its own frame, so the result can keep its rotation and opacity: `box` is then
 * in the element's local coordinates. Several are drawn as they sit on the page (`box` in
 * page coordinates), each with its own opacity.
 */
export async function renderElementsCanvas(els: Element[]) {
  const Konva = (await import("konva")).default;
  await ensureFonts(els.flatMap((e) => (e.type === "text" ? [e.fontFamily] : [])));
  const images = await loadPageImages(els);

  const container = document.createElement("div");
  const stage = new Konva.Stage({ container, width: 1, height: 1 });
  const layer = new Konva.Layer();
  stage.add(layer);
  const root = new Konva.Group();
  layer.add(root);
  const single = els.length === 1;
  for (const el of els) {
    const g = buildElement(Konva, el, images);
    if (single) g.setAttrs({ x: 0, y: 0, rotation: 0, opacity: 1, visible: true });
    root.add(g);
  }
  // Strokes, arrow heads and antialiasing reach just past the boxes; keep them.
  const r = root.getClientRect({ skipShadow: true });
  const box = { x: r.x - 1, y: r.y - 1, width: r.width + 2, height: r.height + 2 };
  const want = Math.max(RASTER_MIN_RATIO, ...els.map((e) => nativeRatio(e, images)));
  const pixelRatio = Math.min(
    want,
    RASTER_MAX_SIDE / box.width,
    RASTER_MAX_SIDE / box.height,
    Math.sqrt(RASTER_MAX_PIXELS / (box.width * box.height)),
  );
  const canvas = root.toCanvas({ ...box, pixelRatio });
  stage.destroy();
  return { canvas, box };
}

export const canvasToBlob = (c: HTMLCanvasElement, type = "image/png", quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality),
  );

export async function renderThumbnail(design: Design, maxSide = 360) {
  const ratio = maxSide / Math.max(design.width, design.height);
  return canvasToBlob(await renderPageCanvas(design, design.pages[0], ratio));
}
