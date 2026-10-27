import type Konva from "konva";
import { elementAsset, pageSize, type Design, type Element, type ImageCrop, type ImageElement, type Page, type TextElement, type VectorElement } from "./model";
import { adjustmentAttrs } from "./fx/adjustDraw";
import { polygonPoints, roundedRect, traceShape } from "./shapes";
import { ensureFonts } from "./fonts";
import { loadAssetImage } from "./images";
import { NATIVE_BLEND } from "./fx/blend";
import { hasOuterEffects } from "./fx/effects";
import { basePad, fxShapeAttrs, getKonva, needsFx, provideKonva, visualBounds } from "./fx/fxShape";
import { cappedRatio, clipHitToMask, clipToMask, contentKey, drawCached, hitVector, maskCanvas, maskIsClip, strokeReach, vectorDrawer } from "./vectorDraw";
import { CLIP_GHOST, clipDrawFor, groupDrawFor, maskBase, neutralBase, setClipDraw, setGroupDraw } from "./fx/groupDraw";
import { buildRenderTree, clipStacks, normalizeTree, type RenderNode } from "./tree";
import { contextMeasure, drawRichText, hasRichStyle, layoutRichText, textFamilies, type RichLayout } from "./richText";

// One description of each element's Konva nodes, in the element's local
// coordinates (0..width, 0..height). The editor renders it with react-konva and
// exports build it imperatively, so both always draw the same thing.
export type NodeSpec = {
  kind: "Rect" | "Ellipse" | "Line" | "Arrow" | "Text" | "Image" | "Shape";
  attrs: Record<string, unknown>;
};

export { polygonPoints, roundedRect, traceShape } from "./shapes";

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

/**
 * Text with style runs: one Shape that lays the runs out (richText.ts) and draws them. The layout
 * is made on first draw with the drawing context's own font metrics and kept for this node.
 */
function richTextAttrs(el: TextElement) {
  let layout: RichLayout | null = null;
  return {
    width: el.width,
    height: el.height,
    sceneFunc: (kctx: Konva.Context) => {
      const ctx = kctx._context as CanvasRenderingContext2D;
      layout ??= layoutRichText(el, contextMeasure(ctx));
      drawRichText(ctx, layout);
    },
    hitFunc: (kctx: Konva.Context, shape: Konva.Shape) => {
      kctx.beginPath();
      kctx.rect(0, 0, el.width, el.height);
      kctx.closePath();
      kctx.fillStrokeShape(shape);
    },
  };
}

/**
 * The Konva nodes that draw an element. One with layer effects or a blend mode canvas can't
 * do natively is a single custom Shape that runs the effects pipeline over `baseNodes`.
 */
export function elementNodes(
  el: Element,
  image?: Bitmap | null,
  opts?: { fontsVersion?: number; live?: boolean; part?: "all" | "outer" | "body" },
): NodeSpec[] {
  // An adjustment draws by changing what is below it, with its own blend mode (fx/adjustDraw.ts).
  if (el.type === "adjustment") return opts?.part === "outer" ? [] : [{ kind: "Shape", attrs: adjustmentAttrs(el, image, { live: opts?.live }) }];
  if (!needsFx(el)) return opts?.part === "outer" ? [] : baseNodes(el, image);
  return [{ kind: "Shape", attrs: fxShapeAttrs(el, image, { ...opts, nodes: baseNodes(el, image) }) }];
}

/** One of a clip stack base's ghosts: nodes drawn in the base's frame, with an opacity. */
export type GhostSpec = { name: string; opacity: number; nodes: NodeSpec[] };

/**
 * The ghosts a clip stack draws for a (non-group) base, see fx/groupDraw.ts: its outer effects
 * (with its opacity), its body (fill opacity and interior effects, normal blend) and its content
 * alpha (the clipping mask).
 */
export function clipGhosts(base: Element, image?: Bitmap | null, opts?: { fontsVersion?: number; live?: boolean }): GhostSpec[] {
  const n = neutralBase(base);
  const out: GhostSpec[] = [];
  if (needsFx(n) && hasOuterEffects(n.effects)) {
    out.push({ name: CLIP_GHOST.outer, opacity: base.opacity, nodes: elementNodes(n, image, { ...opts, part: "outer" }) });
  }
  out.push({ name: CLIP_GHOST.body, opacity: groupAttrs(n).opacity, nodes: elementNodes(n, image, { ...opts, part: "body" }) });
  out.push({ name: CLIP_GHOST.mask, opacity: 1, nodes: baseNodes(maskBase(base), image) });
  return out;
}

/** The element's plain nodes, without effects or blending; inside its vector mask when it has one. */
export function baseNodes(el: Element, image?: Bitmap | null): NodeSpec[] {
  const nodes = ownNodes(el, image);
  return el.vectorMask && el.type !== "group" && el.type !== "adjustment" && nodes.length ? [{ kind: "Shape", attrs: vectorMaskedAttrs(el, nodes, image) }] : nodes;
}

/** One Shape drawing a vector element (vectorDraw.ts). */
function vectorAttrs(el: VectorElement) {
  const draw = vectorDrawer(el);
  const side = strokeReach(el, false);
  return {
    width: el.width,
    height: el.height,
    // Konva counts a stroke into the client rect (transformer, layer boxes); the drawing is our own.
    ...(side > 0 ? { stroke: "rgba(0,0,0,0)", strokeWidth: side * 2 } : {}),
    sceneFunc: (kctx: Konva.Context) => draw(kctx._context as CanvasRenderingContext2D),
    hitFunc: (kctx: Konva.Context, shape: Konva.Shape) => hitVector(kctx._context as CanvasRenderingContext2D, el, shape.colorKey),
  };
}

/**
 * An element's nodes inside its vector mask, as one Shape: a plain clip when the mask is one
 * outline, else the nodes rendered off-screen (kept per scale) with the mask's alpha applied.
 */
function vectorMaskedAttrs(el: Element, nodes: NodeSpec[], image?: Bitmap | null) {
  const m = el.vectorMask!;
  const w = el.width;
  const h = el.height;
  let group: Konva.Group | null = null;
  // Shared across element objects with the same content (see vectorDraw.ts); a text element's
  // layout also depends on fonts loading, which the content doesn't show, so it keeps its own.
  const key = maskedKey(el, image);
  const inner = () => {
    const K = getKonva();
    if (!group && K) {
      group = new K.Group();
      for (const n of nodes) {
        const Ctor = K[n.kind] as unknown as new (a: Record<string, unknown>) => Konva.Shape;
        group.add(new Ctor({ ...n.attrs, perfectDrawEnabled: false }));
      }
    }
    return group;
  };
  return {
    width: w,
    height: h,
    sceneFunc: (kctx: Konva.Context) => {
      const g = inner();
      if (!g || !(w > 0) || !(h > 0)) return;
      const ctx = kctx._context as CanvasRenderingContext2D;
      const canvas = (kctx as unknown as { canvas: unknown }).canvas;
      if (maskIsClip(m)) {
        ctx.save();
        try {
          clipToMask(ctx, m);
          g.drawScene(canvas as never, g);
        } finally {
          ctx.restore();
        }
        return;
      }
      drawCached(ctx, key, (want) => {
        const pad = basePad({ ...el, vectorMask: undefined } as Element);
        const ratio = cappedRatio(w, h, pad, want);
        const c = g.toCanvas({ x: -pad, y: -pad, width: w + 2 * pad, height: h + 2 * pad, pixelRatio: ratio });
        maskCanvas(c, m, pad, ratio);
        return {
          canvases: [c],
          pixels: c.width * c.height,
          draw: (cx: CanvasRenderingContext2D) => {
            if (c.width && c.height) cx.drawImage(c, -pad, -pad, c.width / ratio, c.height / ratio);
          },
        };
      });
    },
    hitFunc: (kctx: Konva.Context, shape: Konva.Shape) => {
      const c = kctx._context as CanvasRenderingContext2D;
      c.save();
      clipHitToMask(c, m, w, h);
      c.beginPath();
      c.rect(0, 0, w, h);
      c.fillStyle = shape.colorKey;
      c.fill();
      c.restore();
    },
  };
}

// Bitmaps get an id each, so a masked image's cached render follows the bitmap it was made from.
const bitmapIds = new WeakMap<Bitmap, number>();
let nextBitmapId = 1;
let nextTextNonce = 1;
const MASK_KEY_IGNORED = new Set(["id", "x", "y", "rotation", "opacity", "locked", "name", "hidden", "groupId", "collapsed", "clipped", "effects", "blendMode"]);

/** The cache key of an element's vector-masked content. */
function maskedKey(el: Element, image?: Bitmap | null) {
  let img = "-";
  if (image) {
    let id = bitmapIds.get(image);
    if (id === undefined) bitmapIds.set(image, (id = nextBitmapId++));
    img = `b${id}`;
  }
  const content = contentKey(el, () => Object.entries(el).filter(([k]) => !MASK_KEY_IGNORED.has(k)));
  return `m${content}|${img}${el.type === "text" ? `|t${nextTextNonce++}` : ""}`;
}

function ownNodes(el: Element, image?: Bitmap | null): NodeSpec[] {
  const w = el.width;
  const h = el.height;
  switch (el.type) {
    case "group":
      // A group draws its members (GroupNode / buildTree), never anything of its own.
      return [];
    case "adjustment":
      return [{ kind: "Shape", attrs: adjustmentAttrs(el, image) }];
    case "vector":
      return [{ kind: "Shape", attrs: vectorAttrs(el) }];
    case "text":
      // Text with one style stays a Konva.Text, exactly as before runs existed.
      return [hasRichStyle(el) ? { kind: "Shape", attrs: richTextAttrs(el) } : { kind: "Text", attrs: textAttrs(el) }];
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
  // Without effects, fill opacity is plain opacity and a native blend mode is the group's. An
  // adjustment applies its blend mode itself and fades by both opacities.
  const plain = !needsFx(el);
  if (el.type === "adjustment") {
    return { x: el.x, y: el.y, rotation: el.rotation, opacity: el.opacity * (el.fillOpacity ?? 1), visible: !el.hidden, globalCompositeOperation: "source-over" as const };
  }
  return {
    x: el.x,
    y: el.y,
    rotation: el.rotation,
    opacity: plain ? el.opacity * (el.fillOpacity ?? 1) : el.opacity,
    visible: !el.hidden,
    globalCompositeOperation: (plain && el.blendMode && NATIVE_BLEND[el.blendMode]) || "source-over",
  };
}

/** Font families an element list draws with (each text element's own and its runs'), in order, once each. */
export const elementFonts = (els: Element[]) => [...new Set(els.flatMap((e) => (e.type === "text" ? textFamilies(e) : [])))];

export const pageFonts = (page: Page) => elementFonts(page.elements);

type KonvaNS = typeof import("konva").default;

async function loadPageImages(els: Element[]) {
  const images = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    els.map(async (e) => {
      const id = elementAsset(e);
      if (id) images.set(id, await loadAssetImage(id));
    }),
  );
  return images;
}

function addNodes(Konva: KonvaNS, g: InstanceType<typeof Konva.Group>, nodes: NodeSpec[], inGroup: boolean) {
  for (const n of nodes) {
    const Ctor = Konva[n.kind] as unknown as new (a: Record<string, unknown>) => InstanceType<typeof Konva.Shape>;
    // Konva's "perfect draw" buffer assumes the layer canvas; isolated groups draw off-screen (the editor never uses it).
    g.add(new Ctor(inGroup ? { ...n.attrs, perfectDrawEnabled: false } : n.attrs));
  }
}

/** An element's Konva group, built imperatively from the same specs the editor renders. */
function buildElement(Konva: KonvaNS, el: Element, images: Map<string, HTMLImageElement | null>, inGroup = false) {
  provideKonva(Konva);
  const g = new Konva.Group({ ...groupAttrs(el), id: el.id });
  const asset = elementAsset(el);
  addNodes(Konva, g, elementNodes(el, asset ? images.get(asset) : undefined), inGroup);
  return g;
}

/** Collect a group's stored members from its render node. */
function membersOf(n: RenderNode, out: Element[] = []) {
  for (const c of n.children ?? []) {
    out.push(c.el);
    membersOf(c, out);
  }
  return out;
}

/**
 * Konva nodes for a page's tree: groups hold their members and draw isolated when they need to,
 * and a clip stack (a base with clipped layers above it) draws its layers inside the base.
 */
export function buildTree(Konva: KonvaNS, nodes: RenderNode[], images: Map<string, HTMLImageElement | null>, inGroup = false) {
  provideKonva(Konva);
  const one = (n: RenderNode, deep: boolean) => {
    if (n.el.type !== "group") return buildElement(Konva, n.el, images, deep);
    const g = new Konva.Group({ id: n.el.id });
    setGroupDraw(g, groupDrawFor(n.el, membersOf(n)));
    for (const c of buildTree(Konva, n.children ?? [], images, true)) g.add(c);
    return g;
  };
  const out: InstanceType<typeof Konva.Group>[] = [];
  for (const { node, clipped } of clipStacks(nodes)) {
    // A hidden base hides its clipped layers too.
    if (node.el.hidden) continue;
    const shown = clipped.filter((c) => !c.el.hidden);
    if (!shown.length) {
      out.push(one(node, inGroup));
      continue;
    }
    const stack = new Konva.Group();
    stack.add(one(node, true));
    if (node.el.type !== "group") {
      const asset = elementAsset(node.el);
      const img = asset ? images.get(asset) : undefined;
      for (const gh of clipGhosts(node.el, img)) {
        const g = new Konva.Group({ name: gh.name, opacity: gh.opacity, listening: false });
        addNodes(Konva, g, gh.nodes, true);
        stack.add(g);
      }
    }
    for (const c of shown) stack.add(one(c, true));
    setClipDraw(stack, clipDrawFor(node.el, membersOf(node)));
    out.push(stack);
  }
  return out;
}

/** Render one page off-screen at `pixelRatio` × its size (`pageSize`). */
export async function renderPageCanvas(design: Design, page: Page, pixelRatio: number) {
  const Konva = (await import("konva")).default;
  await ensureFonts(pageFonts(page));
  const images = await loadPageImages(page.elements);

  const { width, height } = pageSize(design, page);
  const container = document.createElement("div");
  const stage = new Konva.Stage({ container, width, height });
  const layer = new Konva.Layer();
  stage.add(layer);
  layer.add(new Konva.Rect({ width, height, fill: page.background }));
  for (const g of buildTree(Konva, buildRenderTree(page.elements), images)) layer.add(g);
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
  await ensureFonts(elementFonts(els));
  const images = await loadPageImages(els);

  const container = document.createElement("div");
  const stage = new Konva.Stage({ container, width: 1, height: 1 });
  const layer = new Konva.Layer();
  stage.add(layer);
  const root = new Konva.Group();
  layer.add(root);
  const single = els.length === 1;
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  // Several with clipping among them draw as the page does: each clipped one inside its base
  // (one clipped to a layer that isn't here draws on its own, or inside the one below it).
  const stacked = !single && els.some((e) => e.clipped);
  if (stacked) {
    const flat = normalizeTree(els.map((e) => ({ ...e, groupId: null })));
    for (const g of buildTree(Konva, buildRenderTree(flat), images)) root.add(g);
  }
  for (const el of els) {
    const g = buildElement(Konva, el, images);
    // The image keeps the element's opacity; fill opacity is drawn in (by the pipeline when there are effects).
    if (single) g.setAttrs({ x: 0, y: 0, rotation: 0, opacity: needsFx(el) ? 1 : (el.fillOpacity ?? 1), visible: true });
    // Effects reach past the element box by their padding; the fx shape's own rect doesn't.
    if (needsFx(el)) rects.push(visualBounds(single ? { ...el, x: 0, y: 0, rotation: 0 } : el));
    else rects.push(g.getClientRect({ skipShadow: true }));
    if (stacked) g.destroy();
    else root.add(g);
  }
  // Strokes, arrow heads and antialiasing reach just past the boxes; keep them.
  const r = unionRect(rects);
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

function unionRect(rects: { x: number; y: number; width: number; height: number }[]) {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Render one element as it sits on the page, for a layer in an exported file: rotation kept,
 * opacity and visibility left for the layer to carry. `box` is the whole-pixel rectangle it
 * covers, clipped to the page; null when nothing of it is on the page. With `effects: false`
 * the layer is the plain content (no effects, blend or fill opacity), for a file that carries
 * those itself.
 */
export async function renderElementLayer(design: Design, el: Element, pixelRatio = 1, opts?: { effects?: boolean; page?: Page }) {
  const size = pageSize(design, opts?.page);
  const Konva = (await import("konva")).default;
  await ensureFonts(elementFonts([el]));
  const images = await loadPageImages([el]);
  const container = document.createElement("div");
  const stage = new Konva.Stage({ container, width: size.width, height: size.height });
  const layer = new Konva.Layer();
  stage.add(layer);
  const src: Element = opts?.effects === false ? { ...el, effects: undefined, blendMode: undefined, fillOpacity: undefined } : el;
  const fx = needsFx(src);
  const g = buildElement(Konva, src, images);
  // The layer carries opacity; fill opacity is drawn in (by the pipeline when there are effects).
  g.setAttrs({ opacity: fx ? 1 : (src.fillOpacity ?? 1), visible: true });
  layer.add(g);
  const r = fx ? visualBounds(src) : g.getClientRect({ skipShadow: true });
  // Round outwards only a hair, so an image on whole pixels keeps its exact size.
  const x0 = Math.max(0, Math.floor(r.x + 0.01));
  const y0 = Math.max(0, Math.floor(r.y + 0.01));
  const x1 = Math.min(size.width, Math.ceil(r.x + r.width - 0.01));
  const y1 = Math.min(size.height, Math.ceil(r.y + r.height - 0.01));
  if (x1 <= x0 || y1 <= y0) {
    stage.destroy();
    return null;
  }
  const box = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const canvas = layer.toCanvas({ ...box, pixelRatio });
  stage.destroy();
  return { canvas, box };
}

export const canvasToBlob = (c: HTMLCanvasElement, type = "image/png", quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality),
  );

export async function renderThumbnail(design: Design, maxSide = 360) {
  const { width, height } = pageSize(design, design.pages[0]);
  const ratio = maxSide / Math.max(width, height);
  return canvasToBlob(await renderPageCanvas(design, design.pages[0], ratio));
}
