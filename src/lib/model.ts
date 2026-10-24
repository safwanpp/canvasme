import { z } from "zod";
import { nanoid } from "nanoid";

export const FORMAT_VERSION = 1;

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
  fill: z.string(),
  align: z.enum(["left", "center", "right"]).default("left"),
  lineHeight: z.number().positive().default(1.2),
  letterSpacing: z.number().default(0),
});

export const ShapeKind = z.enum(["rect", "ellipse", "triangle", "star", "hexagon"]);

export const ShapeElement = z.object({
  ...base,
  type: z.literal("shape"),
  shape: ShapeKind,
  fill: z.string(),
  stroke: z.string().default("#000000"),
  strokeWidth: z.number().nonnegative().default(0),
  cornerRadius: z.number().nonnegative().default(0),
});

export const LineElement = z.object({
  ...base,
  type: z.literal("line"),
  stroke: z.string(),
  strokeWidth: z.number().positive(),
  dashed: z.boolean().default(false),
  arrowEnd: z.boolean().default(false),
});

export const ImageElement = z.object({
  ...base,
  type: z.literal("image"),
  assetId: z.string(),
  cornerRadius: z.number().nonnegative().default(0),
});

export const Element = z.discriminatedUnion("type", [
  TextElement,
  ShapeElement,
  LineElement,
  ImageElement,
]);

export const Page = z.object({
  id: z.string(),
  background: z.string(),
  elements: z.array(Element),
});

export const AssetMeta = z.object({
  mime: z.string(),
  name: z.string(),
  width: z.number(),
  height: z.number(),
});

export const Design = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
  pages: z.array(Page).min(1),
  assets: z.record(z.string(), AssetMeta).default({}),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type TextElement = z.infer<typeof TextElement>;
export type ShapeKind = z.infer<typeof ShapeKind>;
export type ShapeElement = z.infer<typeof ShapeElement>;
export type LineElement = z.infer<typeof LineElement>;
export type ImageElement = z.infer<typeof ImageElement>;
export type Element = z.infer<typeof Element>;
export type Page = z.infer<typeof Page>;
export type AssetMeta = z.infer<typeof AssetMeta>;
export type Design = z.infer<typeof Design>;

export const uid = () => nanoid(12);

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
