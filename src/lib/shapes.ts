import type { ImageMask, Knot, ShapeElement, ShapeKind, Subpath, VectorElement } from "./model";

// Shape outlines as plain canvas paths, shared by the Konva node specs, masks and hit tests.

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

export type PathCtx = Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "lineTo" | "arcTo" | "ellipse" | "closePath">;

export function roundedRect(ctx: PathCtx, w: number, h: number, radius: number) {
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

const KAPPA = 0.5522847498;

const corner = (x: number, y: number): Knot => ({ x, y, inX: x, inY: y, outX: x, outY: y });

/** The outline `traceShape` draws, as bezier subpaths in a w x h box (arcs as four-curve circles). */
export function shapeSubpaths(shape: Pick<ShapeElement, "shape" | "cornerRadius">, w: number, h: number): Subpath[] {
  if (shape.shape === "ellipse") {
    const rx = w / 2;
    const ry = h / 2;
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;
    const knot = (x: number, y: number, ix: number, iy: number, ox: number, oy: number): Knot => ({ x, y, inX: x + ix, inY: y + iy, outX: x + ox, outY: y + oy });
    return [
      {
        closed: true,
        knots: [
          knot(rx, 0, -kx, 0, kx, 0),
          knot(w, ry, 0, -ky, 0, ky),
          knot(rx, h, kx, 0, -kx, 0),
          knot(0, ry, 0, ky, 0, -ky),
        ],
      },
    ];
  }
  if (shape.shape === "rect") {
    const r = Math.max(0, Math.min(shape.cornerRadius, w / 2, h / 2));
    if (r === 0) return [{ closed: true, knots: [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)] }];
    const k = r * KAPPA;
    const knot = (x: number, y: number, ix: number, iy: number, ox: number, oy: number): Knot => ({ x, y, inX: x + ix, inY: y + iy, outX: x + ox, outY: y + oy });
    return [
      {
        closed: true,
        knots: [
          knot(r, 0, -k, 0, 0, 0),
          knot(w - r, 0, 0, 0, k, 0),
          knot(w, r, 0, -k, 0, 0),
          knot(w, h - r, 0, 0, 0, k),
          knot(w - r, h, k, 0, 0, 0),
          knot(r, h, 0, 0, -k, 0),
          knot(0, h - r, 0, k, 0, 0),
          knot(0, r, 0, 0, 0, -k),
        ],
      },
    ];
  }
  const pts = polygonPoints(shape.shape, w, h);
  const knots: Knot[] = [];
  for (let i = 0; i < pts.length; i += 2) knots.push(corner(pts[i], pts[i + 1]));
  return [{ closed: true, knots }];
}

/** A shape element as the same outline drawn as a vector element: its fill and stroke become paints. */
export function shapeToVector(el: ShapeElement): VectorElement {
  const { shape: _kind, fill, stroke, strokeWidth, cornerRadius: _r, ...rest } = el;
  void _kind;
  void _r;
  return {
    ...rest,
    type: "vector",
    subpaths: shapeSubpaths(el, el.width, el.height),
    fillRule: "nonzero",
    lineCap: "butt",
    // As the editor draws them (render.ts): Konva's Rect and Ellipse join mitred (an ellipse has no
    // corners anyway), the polygon shapes are drawn as a Line with round joins.
    lineJoin: el.shape === "rect" || el.shape === "ellipse" ? "miter" : "round",
    strokeAlign: "center",
    fill: { type: "color", color: fill },
    stroke: strokeWidth > 0 ? { type: "color", color: stroke } : null,
    strokeWidth: strokeWidth > 0 ? strokeWidth : 0,
  };
}

/** An image's clip-to-shape mask as a vector mask in the image's local units. */
export const maskToVectorMask = (el: { width: number; height: number }, m: ImageMask) => ({
  subpaths: shapeSubpaths(m.shape, el.width, el.height),
  fillRule: "nonzero" as const,
  invert: false,
});
