import type { Design, Element, Page, ShapeKind } from "./model";
import { ensureFonts } from "./fonts";
import { loadAssetImage } from "./images";

// One description of each element's Konva nodes, in the element's local
// coordinates (0..width, 0..height). The editor renders it with react-konva and
// exports build it imperatively, so both always draw the same thing.
export type NodeSpec = {
  kind: "Rect" | "Ellipse" | "Line" | "Arrow" | "Text" | "Image";
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

export function elementNodes(el: Element, image?: HTMLImageElement | null): NodeSpec[] {
  const w = el.width;
  const h = el.height;
  switch (el.type) {
    case "text":
      return [{ kind: "Text", attrs: textAttrs(el) }];
    case "image":
      if (!image) return [{ kind: "Rect", attrs: { width: w, height: h, fill: "#e5e7eb" } }];
      return [{ kind: "Image", attrs: { width: w, height: h, image, cornerRadius: el.cornerRadius } }];
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

/** Render one page off-screen at `pixelRatio` x the design size. */
export async function renderPageCanvas(design: Design, page: Page, pixelRatio: number) {
  const Konva = (await import("konva")).default;
  await ensureFonts(pageFonts(page));
  const images = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    page.elements.map(async (e) => {
      if (e.type === "image") images.set(e.assetId, await loadAssetImage(e.assetId));
    }),
  );

  const container = document.createElement("div");
  const stage = new Konva.Stage({ container, width: design.width, height: design.height });
  const layer = new Konva.Layer();
  stage.add(layer);
  layer.add(new Konva.Rect({ width: design.width, height: design.height, fill: page.background }));
  for (const el of page.elements) {
    if (el.hidden) continue;
    const g = new Konva.Group(groupAttrs(el));
    const img = el.type === "image" ? images.get(el.assetId) : undefined;
    for (const n of elementNodes(el, img)) {
      const Ctor = Konva[n.kind] as unknown as new (a: Record<string, unknown>) => InstanceType<typeof Konva.Shape>;
      g.add(new Ctor(n.attrs));
    }
    layer.add(g);
  }
  layer.draw();
  const canvas = stage.toCanvas({ pixelRatio });
  stage.destroy();
  return canvas;
}

export const canvasToBlob = (c: HTMLCanvasElement, type = "image/png", quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality),
  );

export async function renderThumbnail(design: Design, maxSide = 360) {
  const ratio = maxSide / Math.max(design.width, design.height);
  return canvasToBlob(await renderPageCanvas(design, design.pages[0], ratio));
}
