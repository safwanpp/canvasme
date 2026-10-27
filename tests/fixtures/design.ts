import type { Adjustment } from "@/lib/adjustments";
import { uid, type AdjustmentElement, type Design, type Element, type GroupElement, type ImageElement, type Knot, type ShapeElement, type Subpath, type TextElement, type VectorElement } from "@/lib/model";

const base = () => ({
  id: uid(),
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  groupId: null,
});

export const rectEl = (p?: Partial<ShapeElement>): ShapeElement => ({
  ...base(),
  type: "shape",
  shape: "rect",
  fill: "#ff0000",
  stroke: "#000000",
  strokeWidth: 0,
  cornerRadius: 0,
  ...p,
});

export const textEl = (p?: Partial<TextElement>): TextElement => ({
  ...base(),
  height: 29,
  type: "text",
  text: "Text",
  fontFamily: "Inter",
  fontSize: 24,
  bold: false,
  italic: false,
  underline: false,
  fill: "#000000",
  align: "left",
  lineHeight: 1.2,
  letterSpacing: 0,
  ...p,
});

/** A group container; its box is derived from its members by syncGroupBounds. */
export const groupEl = (p?: Partial<GroupElement>): GroupElement => ({
  ...base(),
  type: "group",
  name: "Group",
  ...p,
});

export const imageEl = (p?: Partial<ImageElement>): ImageElement => ({
  ...base(),
  type: "image",
  assetId: "asset-1",
  cornerRadius: 0,
  ...p,
});

/** A straight-sided knot (handles on the anchor). */
export const corner = (x: number, y: number): Knot => ({ x, y, inX: x, inY: y, outX: x, outY: y });

/** A closed rectangle subpath, clockwise. */
export const rectPath = (x: number, y: number, w: number, h: number, op?: Subpath["op"]): Subpath => ({
  closed: true,
  knots: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)],
  ...(op ? { op } : {}),
});

/** A vector element: a red 100×100 square at 50,50 unless overridden. */
export const vectorEl = (p?: Partial<VectorElement>): VectorElement => ({
  ...base(),
  x: 50,
  y: 50,
  type: "vector",
  subpaths: [rectPath(0, 0, 100, 100, "combine")],
  fillRule: "nonzero",
  fill: { type: "color", color: "#ff0000" },
  stroke: null,
  strokeWidth: 0,
  strokeAlign: "center",
  lineCap: "butt",
  lineJoin: "miter",
  ...p,
});

/** A full-page (200×200) adjustment layer; an invert unless given another. */
export const adjEl = (p?: Partial<AdjustmentElement> & { adjustment?: Adjustment }): AdjustmentElement => ({
  ...base(),
  width: 200,
  height: 200,
  type: "adjustment",
  name: "Adjustment",
  adjustment: { type: "invert" },
  ...p,
});

/** A one-page design holding `els`; every image element gets a PNG asset entry. */
export function makeDesign(els: Element[], o?: { width?: number; height?: number; background?: string }): Design {
  const width = o?.width ?? 200;
  const height = o?.height ?? 200;
  const assets: Design["assets"] = {};
  for (const el of els) {
    if (el.type === "image") assets[el.assetId] = { mime: "image/png", name: `${el.assetId}.png`, width: el.width, height: el.height };
  }
  return {
    id: uid(),
    name: "Test",
    width,
    height,
    pages: [{ id: uid(), background: o?.background ?? "#ffffff", elements: els }],
    assets,
    createdAt: 0,
    updatedAt: 0,
  };
}
