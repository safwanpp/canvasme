import { z } from "zod";
import { nanoid } from "nanoid";

export const FORMAT_VERSION = 1;

// Colours are hex only: they reach CSS and canvas, so never accept url() or other values.
const Color = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Expected a hex colour");

const base = {
  id: z.string(),
  name: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().nonnegative(),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  groupId: z.string().nullable().default(null),
};

export const TextElement = z.object({
  ...base,
  type: z.literal("text"),
  text: z.string(),
  fontFamily: z.string(),
  fontSize: z.number().positive(),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  fill: Color,
  align: z.enum(["left", "center", "right"]).default("left"),
  lineHeight: z.number().positive().default(1.2),
  letterSpacing: z.number().default(0),
});

export const ShapeKind = z.enum(["rect", "ellipse", "triangle", "star", "hexagon"]);

export const ShapeElement = z.object({
  ...base,
  type: z.literal("shape"),
  shape: ShapeKind,
  fill: Color,
  stroke: Color.default("#000000"),
  strokeWidth: z.number().nonnegative().default(0),
  cornerRadius: z.number().nonnegative().default(0),
});

export const LineElement = z.object({
  ...base,
  type: z.literal("line"),
  stroke: Color,
  strokeWidth: z.number().positive(),
  dashed: z.boolean().default(false),
  arrowEnd: z.boolean().default(false),
});

// Freehand drawing. `points` are x,y pairs in the element's local coordinates.
export const PathElement = z.object({
  ...base,
  type: z.literal("path"),
  points: z.array(z.number()).min(2),
  stroke: Color,
  strokeWidth: z.number().positive(),
});

/**
 * Clipping mask: the image element's box becomes the shape's box, and the image
 * shows only inside the shape's outline. `shape` is kept whole so releasing the
 * mask gives it back; `image` is where the picture sits in the element's local
 * coordinates.
 */
export const ImageMask = z.object({
  shape: ShapeElement,
  image: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    rotation: z.number().default(0),
  }),
  /** The shape was stacked above the image before clipping. */
  shapeAbove: z.boolean().default(false),
});

/**
 * Crop: the part of the picture that shows, as fractions (0..1) of its full width and
 * height. Fractions rather than pixels, so the crop survives swapping the bitmap for one
 * the same shape (background removal, erasing).
 */
export const ImageCrop = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
});

export const ImageElement = z.object({
  ...base,
  type: z.literal("image"),
  assetId: z.string(),
  cornerRadius: z.number().nonnegative().default(0),
  mask: ImageMask.optional(),
  crop: ImageCrop.optional(),
  /** Made by Rasterize from other elements. */
  rasterized: z.boolean().optional(),
  /** The bitmap before the first erase, which the Restore brush paints back from. */
  eraseSource: z.string().optional(),
});

export const Element = z.discriminatedUnion("type", [
  TextElement,
  ShapeElement,
  LineElement,
  PathElement,
  ImageElement,
]);

export const Page = z.object({
  id: z.string(),
  background: Color,
  elements: z.array(Element),
});

// Raster types only: assets become same-origin blob: URLs, so active types
// (text/html, image/svg+xml) must never be stored.
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"] as const;
export const isAllowedImage = (mime: string) => (IMAGE_MIMES as readonly string[]).includes(mime);

export const AssetMeta = z.object({
  mime: z.enum(IMAGE_MIMES),
  name: z.string(),
  width: z.number(),
  height: z.number(),
  /**
   * Made by the editor (Rasterize, Erase) rather than uploaded: kept out of the Uploads
   * panel, and dropped once no element uses it.
   */
  generated: z.boolean().optional(),
});

export const FONT_MIMES = ["font/ttf", "font/otf", "font/woff", "font/woff2"] as const;

/** An uploaded font as carried in a work file (the font file itself sits next to the design). */
export const FontMeta = z.object({
  family: z.string().min(1).max(100),
  name: z.string().max(255),
  mime: z.enum(FONT_MIMES),
});

export const Design = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
  pages: z.array(Page).min(1),
  assets: z.record(z.string(), AssetMeta).default({}),
  /** Uploaded fonts used by the design; only filled in work files, by exportWorkfile. */
  fonts: z.record(z.string(), FontMeta).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type TextElement = z.infer<typeof TextElement>;
export type ShapeKind = z.infer<typeof ShapeKind>;
export type ShapeElement = z.infer<typeof ShapeElement>;
export type LineElement = z.infer<typeof LineElement>;
export type PathElement = z.infer<typeof PathElement>;
export type ImageMask = z.infer<typeof ImageMask>;
export type ImageCrop = z.infer<typeof ImageCrop>;
export type ImageElement = z.infer<typeof ImageElement>;
export type Element = z.infer<typeof Element>;
export type Page = z.infer<typeof Page>;
export type AssetMeta = z.infer<typeof AssetMeta>;
export type FontMeta = z.infer<typeof FontMeta>;
export type Design = z.infer<typeof Design>;

export const uid = () => nanoid(12);

/** Asset ids the design's elements use, including the originals kept for the Restore brush. */
export function usedAssets(d: Design) {
  const used = new Set<string>();
  for (const p of d.pages) {
    for (const e of p.elements) {
      if (e.type !== "image") continue;
      used.add(e.assetId);
      if (e.eraseSource) used.add(e.eraseSource);
    }
  }
  return used;
}

/**
 * Drop generated assets nothing uses any more (earlier erase versions, deleted
 * rasterized images). Only safe when no undo history can bring them back.
 */
export function pruneAssets(d: Design): Design {
  const used = usedAssets(d);
  const keep = Object.entries(d.assets).filter(([id, meta]) => !meta.generated || used.has(id));
  return keep.length === Object.keys(d.assets).length ? d : { ...d, assets: Object.fromEntries(keep) };
}

export function newPage(background = "#ffffff"): Page {
  return { id: uid(), background, elements: [] };
}

export function newDesign(name: string, width: number, height: number): Design {
  const now = Date.now();
  return {
    id: uid(),
    name,
    width,
    height,
    pages: [newPage()],
    assets: {},
    createdAt: now,
    updatedAt: now,
  };
}

export const SIZE_PRESETS = [
  { label: "Instagram Post", width: 1080, height: 1080 },
  { label: "Instagram Story", width: 1080, height: 1920 },
  { label: "Presentation", width: 1920, height: 1080 },
  { label: "A4 Document", width: 794, height: 1123 },
  { label: "Poster", width: 1587, height: 2245 },
  { label: "YouTube Thumbnail", width: 1280, height: 720 },
  { label: "Facebook Cover", width: 1640, height: 624 },
  { label: "Logo", width: 500, height: 500 },
] as const;
