import { z } from "zod";
import { nanoid } from "nanoid";
import { Color } from "./color";
import { fxFields, Paint } from "./effects";
import { Adjustment, Filter, RasterMask } from "./adjustments";

/**
 * Version 2 adds layer effects, blend modes and fill opacity; version 3 adds group elements,
 * with `groupId` meaning the parent group (see migrate.ts), clipping (`clipped`), vector elements
 * and vector masks (all unreleased before version 3, so no further bump).
 */
export const FORMAT_VERSION = 3;

/**
 * One anchor of a bezier path with its two handles, in the element's local units. A corner with
 * no curve has both handles on the anchor.
 */
export const Knot = z.object({
  x: z.number(),
  y: z.number(),
  inX: z.number(),
  inY: z.number(),
  outX: z.number(),
  outY: z.number(),
});

/** How a path component combines with the ones below it (Photoshop's path operations). */
export const PathOp = z.enum(["combine", "subtract", "intersect", "exclude"]);

/**
 * A subpath. `op` starts a new component that combines with everything before it; a subpath
 * without one belongs to the component before it (filled together, with the fill rule).
 */
export const Subpath = z.object({
  closed: z.boolean(),
  knots: z.array(Knot).min(1).max(5000),
  op: PathOp.optional(),
});

export const FillRule = z.enum(["nonzero", "evenodd"]);

/** A non-destructive mask from a vector path: the element shows only inside it (outside, when inverted). */
export const VectorMask = z.object({
  subpaths: z.array(Subpath).min(1).max(500),
  fillRule: FillRule.default("nonzero"),
  invert: z.boolean().default(false),
});

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
  /** The parent group element's id; null at the top level of the page. */
  groupId: z.string().nullable().default(null),
  /**
   * Clipped to the nearest non-clipped sibling below (Photoshop clipping): shows only inside that
   * layer's pixels. Undefined = not clipped. Never set on the bottom element of its parent.
   */
  clipped: z.boolean().optional(),
  /** Shows the element only inside this path, in the element's local units (Photoshop vector masks). */
  vectorMask: VectorMask.optional(),
  /** Filters on the element's own pixels (blur, sharpen, noise, colour), run before its effects. */
  filters: z.array(Filter).max(20).optional(),
  ...fxFields,
};

/**
 * A character style run (rich text): `length` characters (UTF-16 units, like Photoshop) that
 * override the element's own style. Runs follow each other from the start of the text and their
 * lengths add up to the text's length. Absent fields use the element's value.
 */
export const TextRun = z.object({
  length: z.number().int().positive(),
  fontFamily: z.string().max(200).optional(),
  fontSize: z.number().positive().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  fill: Color.optional(),
  letterSpacing: z.number().optional(),
  /** Up, in design units. */
  baselineShift: z.number().optional(),
  caps: z.enum(["all", "small"]).optional(),
  /** Horizontal and vertical glyph scale (1 = 100%). */
  scaleX: z.number().positive().max(10).optional(),
  scaleY: z.number().positive().max(10).optional(),
});

/**
 * A paragraph style run: like TextRun, but a paragraph takes the run that covers its first
 * character. Indents and spacing are in design units.
 */
export const ParagraphRun = z.object({
  length: z.number().int().positive(),
  align: z.enum(["left", "center", "right"]).optional(),
  /** First line, on top of `startIndent`. */
  indent: z.number().optional(),
  startIndent: z.number().optional(),
  endIndent: z.number().optional(),
  spaceBefore: z.number().optional(),
  spaceAfter: z.number().optional(),
});

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
  /** Rich text: per-character style overrides (see richText.ts). Absent = one style. */
  runs: z.array(TextRun).max(2000).optional(),
  /** Rich text: per-paragraph alignment, indents and spacing. */
  paragraphs: z.array(ParagraphRun).max(2000).optional(),
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
  /** Where the bitmap came from: a Photoshop smart object's original embedded file. */
  source: z.object({ kind: z.enum(["smart-object"]), name: z.string().max(200) }).optional(),
});

/**
 * A vector shape (Photoshop shape layers): bezier subpaths in the element's local units, filled
 * and stroked with a paint. Fill, stroke and size are editable; the points are not (yet).
 */
export const VectorElement = z.object({
  ...base,
  type: z.literal("vector"),
  subpaths: z.array(Subpath).min(1).max(500),
  fillRule: FillRule.default("nonzero"),
  fill: Paint.nullable(),
  stroke: Paint.nullable(),
  strokeWidth: z.number().min(0).max(1000).default(0),
  strokeAlign: z.enum(["inside", "center", "outside"]).default("center"),
  lineCap: z.enum(["butt", "round", "square"]).default("butt"),
  lineJoin: z.enum(["miter", "round", "bevel"]).default("miter"),
  /** Dash and gap lengths in stroke widths (as in Photoshop, so they scale with the width); absent = solid. */
  dash: z.array(z.number().nonnegative()).max(16).optional(),
  /** Miter joins longer than this many stroke widths are bevelled; absent = 10 (canvas default). */
  miterLimit: z.number().min(1).max(1000).optional(),
});

/**
 * A group: a container for the elements whose `groupId` is its id, which sit directly below it
 * in the page's element list (see tree.ts). Its box is the union of its members (kept in sync by
 * the store) and its rotation is always 0. Its opacity, blend mode (undefined = pass through),
 * effects, hidden and locked apply to the whole group.
 */
export const GroupElement = z.object({
  ...base,
  type: z.literal("group"),
  /** Folded in the Layers panel. */
  collapsed: z.boolean().optional(),
});

/**
 * An adjustment layer (Photoshop's): changes the colours of what is drawn below it in its parent
 * (everything below on the page in a pass-through group; only its base when clipped), within its
 * box, its raster mask and its opacity, mixed back with its blend mode. It draws nothing itself.
 */
export const AdjustmentElement = z.object({
  ...base,
  type: z.literal("adjustment"),
  adjustment: Adjustment,
  rasterMask: RasterMask.optional(),
});

export const Element = z.discriminatedUnion("type", [
  TextElement,
  ShapeElement,
  LineElement,
  PathElement,
  ImageElement,
  GroupElement,
  VectorElement,
  AdjustmentElement,
]);

export const Page = z.object({
  id: z.string(),
  background: Color,
  elements: z.array(Element),
  /** The page's own size (Photoshop artboards); absent = the design's. */
  width: z.number().positive().max(10000).optional(),
  height: z.number().positive().max(10000).optional(),
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

export const IMPORT_ISSUE_KINDS = ["baked", "approximated", "dropped", "info"] as const;
export const ImportIssueKind = z.enum(IMPORT_ISSUE_KINDS);

/** What an import simplified, kept with the design so the user can review it later. */
export const ImportReport = z.object({
  source: z.enum(["psd", "pdf"]),
  fileName: z.string().max(200),
  at: z.number(),
  notes: z.array(z.string().max(500)).max(50),
  items: z
    .array(
      z.object({
        /** Absent when the layer didn't become an element (a group, a dropped layer). */
        elementId: z.string().optional(),
        layerName: z.string().max(120),
        kind: ImportIssueKind,
        message: z.string().max(500),
      }),
    )
    .max(2000),
});

export const Design = z.object({
  /** Format version the design was last migrated to; absent on version 1 designs. */
  version: z.number().int().positive().optional(),
  id: z.string(),
  name: z.string(),
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
  pages: z.array(Page).min(1),
  assets: z.record(z.string(), AssetMeta).default({}),
  /** Uploaded fonts used by the design; only filled in work files, by exportWorkfile. */
  fonts: z.record(z.string(), FontMeta).optional(),
  /** What the import that made this design simplified (PSD), until the user dismisses it. */
  importReport: ImportReport.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type TextElement = z.infer<typeof TextElement>;
export type TextRun = z.infer<typeof TextRun>;
export type ParagraphRun = z.infer<typeof ParagraphRun>;
export type ShapeKind = z.infer<typeof ShapeKind>;
export type ShapeElement = z.infer<typeof ShapeElement>;
export type LineElement = z.infer<typeof LineElement>;
export type PathElement = z.infer<typeof PathElement>;
export type ImageMask = z.infer<typeof ImageMask>;
export type ImageCrop = z.infer<typeof ImageCrop>;
export type ImageElement = z.infer<typeof ImageElement>;
export type GroupElement = z.infer<typeof GroupElement>;
export type AdjustmentElement = z.infer<typeof AdjustmentElement>;
export type Knot = z.infer<typeof Knot>;
export type PathOp = z.infer<typeof PathOp>;
export type Subpath = z.infer<typeof Subpath>;
export type FillRule = z.infer<typeof FillRule>;
export type VectorMask = z.infer<typeof VectorMask>;
export type VectorElement = z.infer<typeof VectorElement>;
export type Element = z.infer<typeof Element>;
export type Page = z.infer<typeof Page>;
export type AssetMeta = z.infer<typeof AssetMeta>;
export type FontMeta = z.infer<typeof FontMeta>;
export type Design = z.infer<typeof Design>;
export type ImportIssueKind = z.infer<typeof ImportIssueKind>;
export type ImportReport = z.infer<typeof ImportReport>;
export type ImportReportItem = ImportReport["items"][number];
/** One thing an importer simplified on one layer. */
export type ImportIssue = { kind: ImportIssueKind; message: string };

export const uid = () => nanoid(12);

/** Asset ids the design's elements use, including the originals kept for the Restore brush. */
export function usedAssets(d: Design) {
  const used = new Set<string>();
  for (const p of d.pages) {
    for (const e of p.elements) {
      if (e.type === "adjustment" && e.rasterMask) used.add(e.rasterMask.assetId);
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

/** A page's size: its own (an artboard) or else the design's. */
export function pageSize(design: Pick<Design, "width" | "height">, page?: Pick<Page, "width" | "height"> | null) {
  const ok = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  return {
    width: page && ok(page.width) ? page.width : design.width,
    height: page && ok(page.height) ? page.height : design.height,
  };
}

/** Width over height of a page (page strip thumbnails). */
export function pageRatio(design: Pick<Design, "width" | "height">, page?: Pick<Page, "width" | "height"> | null) {
  const { width, height } = pageSize(design, page);
  return width / height;
}

/** The asset an element draws from: an image's bitmap or an adjustment's raster mask. */
export const elementAsset = (e: Element): string | undefined =>
  e.type === "image" ? e.assetId : e.type === "adjustment" ? e.rasterMask?.assetId : undefined;

export function newPage(background = "#ffffff"): Page {
  return { id: uid(), background, elements: [] };
}

export function newDesign(name: string, width: number, height: number): Design {
  const now = Date.now();
  return {
    id: uid(),
    version: FORMAT_VERSION,
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
