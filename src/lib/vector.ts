import type { Element, Knot, PathOp, Subpath, VectorElement } from "./model";

// Bezier path geometry for vector elements and vector masks: tracing onto a canvas path,
// bounds, and the transforms a resize or an import needs. Pure; drawing lives in vectorDraw.ts.

export type BezierCtx = {
  moveTo(x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  closePath(): void;
};

/** Add the subpaths to the current canvas path (no beginPath). */
export function traceSubpaths(ctx: BezierCtx, subpaths: Subpath[]) {
  for (const sp of subpaths) {
    const k = sp.knots;
    if (!k.length) continue;
    ctx.moveTo(k[0].x, k[0].y);
    for (let i = 1; i < k.length; i++) ctx.bezierCurveTo(k[i - 1].outX, k[i - 1].outY, k[i].inX, k[i].inY, k[i].x, k[i].y);
    if (sp.closed) {
      const last = k[k.length - 1];
      if (k.length > 1) ctx.bezierCurveTo(last.outX, last.outY, k[0].inX, k[0].inY, k[0].x, k[0].y);
      ctx.closePath();
    }
  }
}

/** The segments of a subpath as cubic control polygons [p0, c1, c2, p1]. */
function segments(sp: Subpath): [number, number, number, number, number, number, number, number][] {
  const k = sp.knots;
  const out: [number, number, number, number, number, number, number, number][] = [];
  const seg = (a: Knot, b: Knot) => out.push([a.x, a.y, a.outX, a.outY, b.inX, b.inY, b.x, b.y]);
  for (let i = 1; i < k.length; i++) seg(k[i - 1], k[i]);
  if (sp.closed && k.length > 1) seg(k[k.length - 1], k[0]);
  return out;
}

/** Parameters in (0,1) where one coordinate of a cubic has a zero derivative. */
function extremaT(p0: number, p1: number, p2: number, p3: number): number[] {
  // B'(t)/3 = a t² + b t + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b);
  } else {
    const d = b * b - 4 * a * c;
    if (d >= 0) {
      const s = Math.sqrt(d);
      ts.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return ts.filter((t) => t > 0 && t < 1);
}

const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/** The tight box of the drawn curves (handles count only where the curve reaches them). */
export function vectorBounds(subpaths: Subpath[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (const sp of subpaths) {
    for (const k of sp.knots) add(k.x, k.y);
    for (const [ax, ay, bx, by, cx, cy, dx, dy] of segments(sp)) {
      for (const t of extremaT(ax, bx, cx, dx)) add(cubic(ax, bx, cx, dx, t), cubic(ay, by, cy, dy, t));
      for (const t of extremaT(ay, by, cy, dy)) add(cubic(ax, bx, cx, dx, t), cubic(ay, by, cy, dy, t));
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Every point (anchor and handles) mapped through `f`; a new array. */
export function transformSubpaths(subpaths: Subpath[], f: (x: number, y: number) => [number, number]): Subpath[] {
  return subpaths.map((sp) => ({
    ...sp,
    knots: sp.knots.map((k) => {
      const [x, y] = f(k.x, k.y);
      const [inX, inY] = f(k.inX, k.inY);
      const [outX, outY] = f(k.outX, k.outY);
      return { x, y, inX, inY, outX, outY };
    }),
  }));
}

export const scaleSubpaths = (sp: Subpath[], sx: number, sy: number) => transformSubpaths(sp, (x, y) => [x * sx, y * sy]);
export const translateSubpaths = (sp: Subpath[], dx: number, dy: number) => transformSubpaths(sp, (x, y) => [x + dx, y + dy]);

/** Miter limit when a vector has none (the canvas default). */
export const DEFAULT_MITER_LIMIT = 10;

export type PathComponent = { op: PathOp; paths: Subpath[] };

/**
 * Subpaths grouped into components: each one with an `op` starts one, the rest join the one before.
 * The first component always adds (there is nothing below it to subtract from or intersect with).
 */
export function pathComponents(subpaths: Subpath[]): PathComponent[] {
  const out: PathComponent[] = [];
  for (const sp of subpaths) {
    if (!out.length) out.push({ op: "combine", paths: [sp] });
    else if (sp.op) out.push({ op: sp.op, paths: [sp] });
    else out[out.length - 1].paths.push(sp);
  }
  return out;
}

/** The path fields of an element scaled by sx, sy for a resize: a vector's subpaths, any vector mask. */
export function scalePathFields(el: Element, sx: number, sy: number): Partial<VectorElement> {
  const out: Partial<VectorElement> = {};
  if (el.type === "vector") out.subpaths = scaleSubpaths(el.subpaths, sx, sy);
  if (el.vectorMask) out.vectorMask = { ...el.vectorMask, subpaths: scaleSubpaths(el.vectorMask.subpaths, sx, sy) };
  return out;
}
