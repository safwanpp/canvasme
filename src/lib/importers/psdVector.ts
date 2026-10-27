// Vector shape layers and vector masks, between ag-psd and the model. ag-psd gives knot points in
// document pixels as [inX, inY, x, y, outX, outY] (P0 findings; the semantic order is checked
// with generated files only — deferred: needs real Photoshop file). Pure, so the worker and the
// tests both run it.
import type { BezierPath, Layer, LayerVectorMask, VectorContent } from "ag-psd";
import type { Gradient, Paint } from "../effects";
import type { FillRule, Subpath, VectorElement, VectorMask } from "../model";
import { vectorBounds } from "../vector";
import { colorHex, modelGradientToPsd, psdGradientToModel, rgbOf, unitsToPx } from "./psdEffects";

/** A vector shape in document pixels (the importer makes it local). */
export type PsdVector = Pick<VectorElement, "subpaths" | "fillRule" | "fill" | "stroke" | "strokeWidth" | "strokeAlign" | "lineCap" | "lineJoin" | "dash" | "miterLimit"> & {
  /** A live rectangle, rounded rectangle or ellipse that a plain shape element draws exactly. */
  shape?: { kind: "rect" | "ellipse"; cornerRadius: number };
};

/** ag-psd stores knots as 8.24 fixed-point fractions of the document: snap the float error away. */
const snap = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - v) < 1e-4 ? r : v;
};

const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Subpaths an element holds at most (the schema's cap). */
const MAX_SUBPATHS = 500;
const MAX_KNOTS = 5000;

/** Path points a whole file may bring in as live vectors; past it shapes keep their pixels. */
export const KNOT_BUDGET = 200_000;

/** Take the knots of `paths` (as imported) from a file's budget; false (nothing taken) when they don't fit. */
export function takeKnots(budget: { left: number }, paths: BezierPath[] | undefined): boolean {
  let n = 0;
  for (const p of (paths ?? []).slice(0, MAX_SUBPATHS)) n += Math.min(MAX_KNOTS, p.knots?.length ?? 0);
  if (n > budget.left) return false;
  budget.left -= n;
  return true;
}

/** ag-psd paths as model subpaths, still in document pixels. Empty paths are dropped. */
export function psdPathsToSubpaths(paths: BezierPath[], max = MAX_SUBPATHS): Subpath[] {
  const out: Subpath[] = [];
  for (const p of paths.slice(0, max)) {
    const knots = (p.knots ?? []).slice(0, MAX_KNOTS).map((k) => {
      const [inX, inY, x, y, outX, outY] = (k.points ?? []).map((v) => snap(finite(v)));
      return { x: x ?? 0, y: y ?? 0, inX: inX ?? 0, inY: inY ?? 0, outX: outX ?? 0, outY: outY ?? 0 };
    });
    if (!knots.length) continue;
    const sp: Subpath = { closed: !p.open, knots };
    if (p.operation) sp.op = p.operation;
    out.push(sp);
  }
  return out;
}

/**
 * What ag-psd's "even-odd" means is unknown: it reads a path flag of 2 as "non-zero" and anything
 * else as "even-odd", but Photoshop's usual flag is 1, so nearly every real shape would read as
 * even-odd. Photoshop shapes combine with path operations, so default to non-zero until a real
 * file shows otherwise (deferred: needs real Photoshop file).
 */
const UNKNOWN_RULE: FillRule = "nonzero";

export const fillRuleOf = (paths: BezierPath[]): FillRule => (paths[0]?.fillRule === "non-zero" ? "nonzero" : UNKNOWN_RULE);

/** Why a shape layer can't stay a vector (its pixels are kept instead). */
export type VectorBake = { reason: string };

const alphaHex = (a: number) =>
  Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, "0");

/** A vector paint, or a reason it can't be one (patterns, noise gradients). */
function paintOf(c: VectorContent | undefined, opacity: number, what: string): Paint | VectorBake | null {
  if (!c) return null;
  if (c.type === "color") {
    const hex = colorHex(c.color);
    return { type: "color", color: opacity < 1 ? `${hex}${alphaHex(opacity)}` : hex };
  }
  if (c.type === "pattern") return { reason: `Pattern ${what} on a shape` };
  const g = psdGradientToModel(c, { ...c, style: c.style as Gradient["style"] | undefined });
  if (!g) return { reason: `Noise gradient ${what} on a shape` };
  if (opacity < 1) {
    const ops = g.opacityStops?.length ? g.opacityStops : [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 1 }];
    g.opacityStops = ops.map((o) => ({ ...o, opacity: o.opacity * opacity }));
  }
  return { type: "gradient", gradient: g };
}

const isBake = (p: Paint | VectorBake | null): p is VectorBake => !!p && "reason" in p;

/** A shape layer (vectorFill + vector mask paths) as a vector, in document pixels. */
export function readVectorLayer(layer: Layer, dpi: number, doc: { width: number; height: number }): { vector: PsdVector } | VectorBake | null {
  const vm = layer.vectorMask;
  if (!layer.vectorFill || !vm || vm.disable || !vm.paths?.length) return null;
  const subpaths = withStartFill(vm, doc);
  if (!subpaths.length) return null;
  const vs = layer.vectorStroke;
  const fill = vs?.fillEnabled === false ? null : paintOf(layer.vectorFill, 1, "fill");
  if (isBake(fill)) return fill;
  const width = vs?.strokeEnabled ? unitsToPx(vs.lineWidth, dpi) : 0;
  const stroke = vs?.strokeEnabled && width > 0 ? paintOf(vs.content ?? { type: "color", color: { r: 0, g: 0, b: 0 } }, vs.opacity ?? 1, "stroke") : null;
  if (isBake(stroke)) return stroke;
  const vector: PsdVector = {
    subpaths,
    fillRule: fillRuleOf(vm.paths),
    fill,
    stroke,
    strokeWidth: stroke ? Math.min(1000, width) : 0,
    strokeAlign: vs?.lineAlignment ?? "center",
    lineCap: vs?.lineCapType ?? "butt",
    lineJoin: vs?.lineJoinType ?? "miter",
  };
  // Photoshop's dashes are in stroke widths, like ours.
  const dash = (vs?.lineDashSet ?? []).map((d) => finite(d.value)).filter((d) => d >= 0);
  if (stroke && dash.length && dash.some((d) => d > 0)) vector.dash = dash.slice(0, 16);
  // Photoshop's default miter limit is 100.
  if (stroke) vector.miterLimit = Math.max(1, Math.min(1000, finite(vs?.miterLimit) || 100));
  const shape = liveShape(layer, vector);
  if (shape) vector.shape = shape;
  return { vector };
}

/**
 * A live rectangle, rounded rectangle (equal radii) or ellipse that a shape element draws the same:
 * one path matching the origin box, a solid fill, and no stroke or a solid centred undashed one.
 */
function liveShape(layer: Layer, v: PsdVector): PsdVector["shape"] | undefined {
  const keys = layer.vectorOrigination?.keyDescriptorList ?? [];
  if (keys.length !== 1 || v.subpaths.length !== 1) return undefined;
  const k = keys[0];
  const kind = k.keyOriginType === 1 || k.keyOriginType === 2 ? "rect" : k.keyOriginType === 5 ? "ellipse" : null;
  if (!kind || v.fill?.type !== "color" || v.fillRule !== "nonzero") return undefined;
  if (v.stroke && (v.stroke.type !== "color" || v.strokeAlign !== "center" || v.dash || v.lineJoin !== "miter")) return undefined;
  const bb = k.keyOriginShapeBoundingBox;
  const b = vectorBounds(v.subpaths);
  if (!bb) return undefined;
  const near = (u: { value: number } | undefined, want: number) => !!u && Math.abs(finite(u.value) - want) < 0.5;
  if (!near(bb.left, b.x) || !near(bb.top, b.y) || !near(bb.right, b.x + b.width) || !near(bb.bottom, b.y + b.height)) return undefined;
  // A rotated or skewed live shape: its corners aren't on the box.
  const corners = k.keyOriginBoxCorners;
  if (corners?.length === 4 && !corners.every((c) => (Math.abs(c.x - b.x) < 0.5 || Math.abs(c.x - b.x - b.width) < 0.5) && (Math.abs(c.y - b.y) < 0.5 || Math.abs(c.y - b.y - b.height) < 0.5))) {
    return undefined;
  }
  let cornerRadius = 0;
  if (k.keyOriginType === 2 && k.keyOriginRRectRadii) {
    const r = k.keyOriginRRectRadii;
    const all = [r.topLeft, r.topRight, r.bottomLeft, r.bottomRight].map((u) => finite(u?.value));
    if (all.some((x) => Math.abs(x - all[0]) > 1e-3)) return undefined;
    cornerRadius = Math.max(0, all[0]);
  }
  return { kind, cornerRadius };
}

/**
 * A mask that "starts with all pixels" begins from the whole document: give it the document as
 * its first component (then the rest combine with it as in Photoshop).
 */
function withStartFill(vm: LayerVectorMask, doc: { width: number; height: number }): Subpath[] {
  // The document rect takes one of the element's subpaths.
  const subpaths = psdPathsToSubpaths(vm.paths ?? [], vm.fillStartsWithAllPixels ? MAX_SUBPATHS - 1 : MAX_SUBPATHS);
  if (!vm.fillStartsWithAllPixels || !subpaths.length) return subpaths;
  const c = (x: number, y: number) => ({ x, y, inX: x, inY: y, outX: x, outY: y });
  const all: Subpath = { closed: true, op: "combine", knots: [c(0, 0), c(doc.width, 0), c(doc.width, doc.height), c(0, doc.height)] };
  const first = subpaths[0].op ? subpaths : [{ ...subpaths[0], op: "combine" as const }, ...subpaths.slice(1)];
  return [all, ...first];
}

/** A vector mask on any layer, in document pixels; null when absent, disabled or empty. */
export function readVectorMask(vm: LayerVectorMask | undefined, doc: { width: number; height: number }): VectorMask | null {
  if (!vm || vm.disable || !vm.paths?.length) return null;
  const subpaths = withStartFill(vm, doc);
  if (!subpaths.length) return null;
  return { subpaths, fillRule: fillRuleOf(vm.paths), invert: !!vm.invert };
}

// ---- Export ----

/**
 * Even-odd subpaths as the same region in non-zero with operations: the first component's later
 * subpaths each exclude (exact for subpaths that don't cross themselves). A later component's
 * own holes have no such form and are left joined (approximate).
 */
export function evenOddAsOps(subpaths: Subpath[]): Subpath[] {
  const firstEnd = subpaths.findIndex((sp, i) => i > 0 && !!sp.op);
  const end = firstEnd < 0 ? subpaths.length : firstEnd;
  return subpaths.map((sp, i) => (i > 0 && i < end ? { ...sp, op: "exclude" as const } : sp));
}

/**
 * Model subpaths (document pixels) as ag-psd paths, written as non-zero (the importer reads every
 * shape as non-zero, see `fillRuleOf`), so the round trip keeps the rule; even-odd becomes operations.
 */
export function subpathsToPsdPaths(subpaths: Subpath[], rule: FillRule): BezierPath[] {
  return (rule === "evenodd" ? evenOddAsOps(subpaths) : subpaths).map((sp) => ({
    open: !sp.closed,
    fillRule: "non-zero",
    ...(sp.op ? { operation: sp.op } : {}),
    knots: sp.knots.map((k) => ({
      // Smooth when the handles line up through the anchor (Photoshop's "linked").
      linked: Math.abs((k.x - k.inX) * (k.outY - k.y) - (k.y - k.inY) * (k.outX - k.x)) < 1e-6 && (k.inX !== k.x || k.inY !== k.y || k.outX !== k.x || k.outY !== k.y),
      points: [k.inX, k.inY, k.x, k.y, k.outX, k.outY],
    })),
  }));
}

/** A model paint as ag-psd vector content, and the opacity a colour's alpha carries. */
export function paintToPsd(p: Paint): { content: VectorContent; opacity: number } {
  if (p.type === "color") {
    const h = p.color.slice(1);
    const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return { content: { type: "color", color: rgbOf(p.color) }, opacity: a };
  }
  return { content: modelGradientToPsd(p.gradient) as VectorContent, opacity: 1 };
}
