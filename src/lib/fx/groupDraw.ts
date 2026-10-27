import type Konva from "konva";
import { hasActiveEffects } from "../effects";
import { hasActiveFilters } from "../adjustments";
import type { Element, GroupElement } from "../model";
import { NATIVE_BLEND } from "./blend";
import { hasOuterEffects } from "./effects";
import { fxGeneration, fxPadding, fxShapeAttrs, getKonva, needsFx, setGroupReach, type Pad } from "./fxShape";
import { fromCanvas } from "./raster";
import { drawBlended } from "./readback";

// A group is a Konva Group holding its members' nodes, which sit at page coordinates (the group
// node itself is never moved, so dragging and transforming members works as for loose elements).
// A pass-through group at full opacity with no effects just draws its members into the page.
// Any other group is isolated: its members are drawn into an off-screen canvas, and that is drawn
// onto the page once, with the group's opacity and blend mode, or run through the effects
// pipeline as one layer's content. Hit testing is untouched, so clicks still reach members.
//
// The group's Konva opacity and composite operation stay at their defaults: Konva would hand
// them down to every member, which is exactly the per-member look isolation avoids.

/** Whether the group must be composited as one layer. */
export function needsIsolation(g: GroupElement): boolean {
  return g.opacity < 1 || (!!g.blendMode && g.blendMode !== "pass-through") || hasActiveEffects(g.effects) || hasActiveFilters(g.filters);
}

export type GroupDraw = {
  el: GroupElement;
  /** The editor (quantized, deferred effect renders); unset for exports. */
  live?: boolean;
  fontsVersion?: number;
  /** Changes whenever the members' stored data does (for the effects cache). */
  key: string;
  /** How far members' strokes and effects reach past their boxes, in page units. */
  reach: number;
  /** Draw only the group's outer effects or only its body (a clip stack's base); default all. */
  part?: "all" | "outer" | "body";
};

type GroupNode = Konva.Group & { cmGroup?: GroupDraw; cmPatched?: boolean };
type KCanvas = { getContext(): Konva.Context; _canvas: HTMLCanvasElement; isCache?: boolean };

// Off-screen canvases, one per nesting depth; draws nest strictly, so a stack is enough.
const pool: KCanvas[] = [];
let depth = 0;
// A retina full-page group is ~12M px: keep that between frames rather than reallocating it.
const POOL_KEEP_PIXELS = 16_000_000;

type SceneCanvasCtor = new (c: { width: number; height: number; pixelRatio: number }) => KCanvas;
let SceneCanvas: SceneCanvasCtor | null = null;

/** A Konva scene canvas; Konva's namespace doesn't export the class, but every layer has one. */
function newSceneCanvas(): KCanvas {
  if (!SceneCanvas) {
    const layer = new (getKonva()!.Layer)();
    SceneCanvas = layer.getCanvas().constructor as unknown as SceneCanvasCtor;
    layer.destroy();
  }
  return new SceneCanvas({ width: 1, height: 1, pixelRatio: 1 });
}

function acquire(w: number, h: number): KCanvas {
  // Everything that can throw happens before the depth is taken, so a failure can't leak a level.
  const c = (pool[depth] ??= newSceneCanvas());
  const raw = c._canvas;
  if (raw.width !== w || raw.height !== h) {
    raw.width = w;
    raw.height = h;
  } else {
    const ctx = raw.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // A canvas keeps its state between uses (a clip stack leaves composite operations set).
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, h);
  }
  depth++;
  return c;
}

function release(c: KCanvas) {
  depth--;
  const raw = c._canvas;
  // Don't hold on to a big canvas between frames.
  if (raw.width * raw.height > POOL_KEEP_PIXELS) raw.width = raw.height = 1;
}

/** Draw the group's members onto `c`, whose context already maps page units to its pixels. */
function drawMembers(node: Konva.Container, c: KCanvas) {
  (node as unknown as { _drawChildren: (m: string, c: KCanvas, top: Konva.Node) => void })._drawChildren("drawScene", c, node);
}

/** A stamp of the members' live node state, so a drag shows in the group's effects before it is stored. */
function liveStamp(node: Konva.Container): string {
  let s = "";
  for (const ch of node.getChildren()) {
    const a = ch.attrs as Record<string, unknown>;
    s += `${a.x ?? 0},${a.y ?? 0},${a.scaleX ?? 1},${a.scaleY ?? 1},${a.rotation ?? 0},${a.visible ?? true},${a.opacity ?? 1}`;
    if ("image" in a) s += a.image ? "i" : "-";
    if ("getChildren" in ch) s += `[${liveStamp(ch as Konva.Container)}]`;
    s += ";";
  }
  return s;
}

/** The members' box from the live nodes, in page units (rotation-free: groups never rotate). */
function liveBox(node: Konva.Container) {
  const r = node.getClientRect({ relativeTo: node as unknown as Konva.Container, skipShadow: true });
  return r.width > 0 && r.height > 0 ? r : null;
}

function drawScene(this: GroupNode, can?: KCanvas, top?: Konva.Node, buffer?: unknown) {
  const cfg = this.cmGroup;
  const K = getKonva();
  if (!cfg || !K || !needsIsolation(cfg.el)) {
    const proto = Object.getPrototypeOf(this) as Konva.Group;
    return proto.drawScene.call(this, can as never, top, buffer as never);
  }
  const canvas = can ?? (this.getLayer()?.getCanvas() as unknown as KCanvas | undefined);
  if (!canvas || (!this.isVisible() && !canvas.isCache)) return this;
  const ctx = canvas.getContext()._context as CanvasRenderingContext2D;
  const box = liveBox(this);
  if (!box) return this;
  const m = this.getAbsoluteTransform(top).getMatrix();
  ctx.save();
  try {
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (needsFx(cfg.el)) drawWithEffects(this, cfg, ctx, canvas, box);
    else drawIsolated(this, cfg, ctx, box);
  } finally {
    ctx.restore();
  }
  return this;
}

/** Opacity and a native blend mode: members off-screen at device resolution, drawn back once. */
function drawIsolated(node: GroupNode, cfg: GroupDraw, ctx: CanvasRenderingContext2D, box: Box) {
  const R = deviceBox(ctx, box, cfg.reach + 2);
  if (!R) return;
  const { x0, y0, x1, y1, T } = R;
  const off = acquire(x1 - x0, y1 - y0);
  try {
    off._canvas.getContext("2d")!.setTransform(T.a, T.b, T.c, T.d, T.e - x0, T.f - y0);
    drawMembers(node, off);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = cfg.el.opacity * node.getAbsoluteOpacity();
    ctx.globalCompositeOperation = NATIVE_BLEND[cfg.el.blendMode ?? "normal"] ?? "source-over";
    ctx.drawImage(off._canvas, x0, y0);
  } finally {
    release(off);
  }
}

type Box = { x: number; y: number; width: number; height: number };

/** The whole device pixels `box` (grown by `pad`) covers under the context's transform, clipped to its canvas. */
function deviceBox(ctx: CanvasRenderingContext2D, box: Box, pad: number) {
  const T = ctx.getTransform();
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [box.x - pad, box.y - pad],
    [box.x + box.width + pad, box.y - pad],
    [box.x - pad, box.y + box.height + pad],
    [box.x + box.width + pad, box.y + box.height + pad],
  ]) {
    xs.push(T.a * x + T.c * y + T.e);
    ys.push(T.b * x + T.d * y + T.f);
  }
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs)));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys)));
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { x0, y0, x1, y1, T };
}

/** Effects or a software blend: the members are the content of one fx render (P1 pipeline). */
function drawWithEffects(
  node: GroupNode,
  cfg: GroupDraw,
  ctx: CanvasRenderingContext2D,
  canvas: KCanvas,
  box: Box,
) {
  const el: GroupElement = { ...cfg.el, x: box.x, y: box.y, width: box.width, height: box.height, rotation: 0 };
  setGroupReach(el, cfg.reach);
  const content = (ratio: number, pad: Pad) => {
    const w = Math.max(1, Math.ceil((el.width + pad.l + pad.r) * ratio));
    const h = Math.max(1, Math.ceil((el.height + pad.t + pad.b) * ratio));
    const off = acquire(w, h);
    try {
      off._canvas.getContext("2d")!.setTransform(ratio, 0, 0, ratio, (pad.l - el.x) * ratio, (pad.t - el.y) * ratio);
      drawMembers(node, off);
      return fromCanvas(off._canvas);
    } finally {
      release(off);
    }
  };
  const attrs = fxShapeAttrs(el, null, {
    nodes: [],
    live: cfg.live,
    fontsVersion: cfg.fontsVersion,
    part: cfg.part,
    content,
    contentKey: `|g${cfg.key}|${liveStamp(node)}|${fxGeneration}`,
  });
  ctx.translate(el.x, el.y);
  ctx.globalAlpha = cfg.el.opacity * node.getAbsoluteOpacity();
  (attrs.sceneFunc as (k: Konva.Context, s: unknown) => void)(canvas.getContext(), node);
}

/** Make a Konva Group draw as the group element `cfg.el`; call again whenever the group or its members change. */
export function setGroupDraw(node: Konva.Group, cfg: GroupDraw) {
  const n = node as GroupNode;
  n.cmGroup = cfg;
  if (!n.cmPatched) {
    n.cmPatched = true;
    (n as unknown as { drawScene: typeof drawScene }).drawScene = drawScene;
  }
}

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * How far `members` reach past their own boxes, in page units. A nested group reaches as far as
 * its own effects plus its members' reach, so its shadow isn't cut off by an outer isolation canvas.
 * `members` are descendants in list order (a group comes after its members).
 */
function membersReach(members: Element[]): number {
  const childReach = new Map<string, number>();
  let reach = 0;
  for (const m of members) {
    const p = fxPadding(m);
    const r = Math.max(p.l, p.t, p.r, p.b) + (m.type === "group" ? (childReach.get(m.id) ?? 0) : 0);
    reach = Math.max(reach, r);
    if (m.groupId) childReach.set(m.groupId, Math.max(childReach.get(m.groupId) ?? 0, r));
  }
  return reach;
}

/** Draw settings for a group from its stored members (descendants, in list order). */
export function groupDrawFor(el: GroupElement, members: Element[], o?: { live?: boolean; fontsVersion?: number }): GroupDraw {
  const reach = membersReach(members);
  // The effects cache needs to know when members change; plain isolation redraws them anyway.
  const key = needsFx(el) ? hashString(JSON.stringify(members)) : "";
  return { el, live: o?.live, fontsVersion: o?.fontsVersion, key, reach };
}

// A clip stack (Photoshop clipping) is a Konva Group at the page origin holding the base's own
// node (for hits, dragging and the transformer; the stack never draws it), the base's "ghosts"
// (listening-free copies drawn here, with the base node's live transform) and the clipped
// layers' nodes, bottom first. It draws like Photoshop's "blend clipped layers as group":
//
//   1. the base's outer effects (shadows, outer glow) straight onto the page, unclipped;
//   2. off-screen: the base's body (fill opacity and interior effects, normal blend), then each
//      clipped layer with its own opacity, blend and effects, kept only inside the base's
//      content alpha (its pixels before effects and fill opacity; a group base's members);
//   3. that drawn onto the page with the base's opacity and blend mode.
//
// A clipped layer is masked by blending the stack before and after it: before·(1 − M) +
// after·M, so its blend mode (native or software, via readback of the off-screen stack) sees the
// layers below it in the stack, and its own effects are clipped too.

/** Ghost node names: the base's outer effects, its body and its content alpha (leaf bases). */
export const CLIP_GHOST = { outer: "cm-clip-outer", body: "cm-clip-body", mask: "cm-clip-mask" } as const;
const GHOSTS = new Set<string>(Object.values(CLIP_GHOST));

export type ClipDraw = {
  /** The stored base element. */
  base: Element;
  /** How far the base's drawing reaches past its box (strokes, effects; a group's members), in page units. */
  reach: number;
  /** The base is drawn by an editor overlay (text being typed): skip its own pixels, keep the clip. */
  editing?: boolean;
};

type ClipNode = Konva.Group & { cmClip?: ClipDraw; cmClipPatched?: boolean };
type HitCanvas = KCanvas & { pixelRatio: number; setSize(w: number, h: number): void };

const maxSide = (p: Pad) => Math.max(p.l, p.t, p.r, p.b);

/** The base drawn neutral: fill opacity and effects kept, opacity and blend left to the stack. */
export function neutralBase<E extends Element>(base: E): E {
  return { ...base, opacity: 1, blendMode: undefined, clipped: undefined };
}

/** The base as its content alpha only: no effects, fill opacity or blend. */
export function maskBase<E extends Element>(base: E): E {
  return { ...base, opacity: 1, blendMode: undefined, fillOpacity: undefined, effects: undefined, clipped: undefined };
}

/** Draw settings for a clip stack; `members` are a group base's descendants (list order). */
export function clipDrawFor(base: Element, members: Element[] = [], o?: { editing?: boolean }): ClipDraw {
  const own = maxSide(fxPadding(neutralBase(base)));
  const reach = base.type === "group" ? own + membersReach(members) : own;
  return { base, reach, editing: o?.editing };
}

/** Make a Konva Group draw as a clip stack; call again whenever the base changes. */
export function setClipDraw(node: Konva.Group, cfg: ClipDraw) {
  const n = node as ClipNode;
  n.cmClip = cfg;
  if (!n.cmClipPatched) {
    n.cmClipPatched = true;
    (n as unknown as { drawScene: typeof drawClipScene }).drawScene = drawClipScene;
    (n as unknown as { drawHit: typeof drawClipHit }).drawHit = drawClipHit;
  }
}

// Hit scratch canvases, two per nesting depth (a clipped group can hold a clip stack, whose hits
// are drawn while the outer stack's are), sized to the stack's device rect and only ever grown.
const hitPool: HitCanvas[] = [];
let hitDepth = 0;

function hitScratch(i: number, like: HitCanvas, w: number, h: number): HitCanvas {
  const pr = like.pixelRatio || 1;
  let c = hitPool[i];
  if (!c || c.pixelRatio !== pr) {
    const Ctor = like.constructor as new (c: { width: number; height: number; pixelRatio: number }) => HitCanvas;
    c = hitPool[i] = new Ctor({ width: 1, height: 1, pixelRatio: pr });
  }
  const raw = c._canvas;
  if (raw.width < w || raw.height < h) {
    raw.width = Math.max(raw.width, w);
    raw.height = Math.max(raw.height, h);
  }
  const ctx = raw.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  return c;
}

/**
 * Hit regions of a clip stack: the base as usual, and the clipped layers only where the base's
 * own hit region is, so a click outside the base falls through to whatever shows there.
 */
function drawClipHit(this: ClipNode, can?: HitCanvas, top?: Konva.Node) {
  const cfg = this.cmClip;
  const proto = Object.getPrototypeOf(this) as Konva.Group;
  const canvas = can ?? (this.getLayer()?.getHitCanvas() as unknown as HitCanvas | undefined);
  if (!cfg || !canvas) return proto.drawHit.call(this, can as never, top);
  if (!this.shouldDrawHit(top)) return this;
  const kids = this.getChildren();
  const baseNode = kids.find((k) => k.id() === cfg.base.id);
  if (!baseNode) return proto.drawHit.call(this, can as never, top);
  baseNode.drawHit(canvas as never, top);
  const clipped = kids.filter((k) => k !== baseNode && !GHOSTS.has(k.name()));
  if (!clipped.length) return this;
  const ctx = canvas.getContext()._context as CanvasRenderingContext2D;
  // Clipped hits only land inside the base, so the scratch covers the base's hit box alone.
  const m = ctx.getTransform();
  const r = baseNode.getClientRect({ relativeTo: top as Konva.Container | undefined, skipShadow: true });
  // Padded for hit areas wider than the drawing (a fill-less vector's 10-unit hit stroke).
  const R = deviceBox(ctx, r, 6);
  if (!R) return this;
  const { x0, y0, x1, y1 } = R;
  const w = x1 - x0;
  const h = y1 - y0;
  const d = hitDepth++;
  try {
    const M = hitScratch(2 * d, canvas, w, h);
    const P = hitScratch(2 * d + 1, canvas, w, h);
    // The scratch canvases start from the hit canvas's transform (its pixel ratio), moved to the rect.
    M._canvas.getContext("2d")!.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
    P._canvas.getContext("2d")!.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
    baseNode.drawHit(M as never, top);
    for (const c of clipped) c.drawHit(P as never, top);
    const pctx = P._canvas.getContext("2d")!;
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.globalCompositeOperation = "destination-in";
    pctx.drawImage(M._canvas, 0, 0, w, h, 0, 0, w, h);
    pctx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(P._canvas, 0, 0, w, h, x0, y0, w, h);
    ctx.restore();
  } finally {
    hitDepth--;
  }
  return this;
}

function drawClipScene(this: ClipNode, can?: KCanvas, top?: Konva.Node, buffer?: unknown) {
  const cfg = this.cmClip;
  const K = getKonva();
  if (!cfg || !K) {
    const proto = Object.getPrototypeOf(this) as Konva.Group;
    return proto.drawScene.call(this, can as never, top, buffer as never);
  }
  const canvas = can ?? (this.getLayer()?.getCanvas() as unknown as KCanvas | undefined);
  if (!canvas || (!this.isVisible() && !canvas.isCache)) return this;
  const kids = this.getChildren();
  const baseNode = kids.find((k) => k.id() === cfg.base.id) as Konva.Group | undefined;
  // A hidden base hides its whole stack, as in Photoshop.
  if (!baseNode || !baseNode.isVisible()) return this;
  const ghost = (name: string) => kids.find((k) => k.name() === name) as Konva.Group | undefined;
  const clipped = kids.filter((k) => k !== baseNode && !GHOSTS.has(k.name()) && k.isVisible());
  const ctx = canvas.getContext()._context as CanvasRenderingContext2D;
  const m = this.getAbsoluteTransform(top).getMatrix();
  const isGroup = cfg.base.type === "group";
  const groupCfg = isGroup ? (baseNode as GroupNode).cmGroup : undefined;
  // Ghosts sit at the stack's origin; the base node's live transform (drag, resize) places them.
  const local = baseNode.getTransform().getMatrix();
  const drawGhost = (g: Konva.Group | undefined, c: KCanvas) => {
    if (!g) return;
    const cx = c.getContext()._context as CanvasRenderingContext2D;
    cx.save();
    try {
      cx.transform(local[0], local[1], local[2], local[3], local[4], local[5]);
      g.drawScene(c as never, g);
    } finally {
      cx.restore();
    }
  };
  ctx.save();
  try {
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    const box = isGroup ? liveBox(baseNode) : baseNode.getClientRect({ relativeTo: this as unknown as Konva.Container, skipShadow: true });
    if (!box || !(box.width > 0) || !(box.height > 0)) return this;
    const g = groupCfg && { ...groupCfg, el: { ...neutralBase(groupCfg.el), opacity: groupCfg.el.opacity } };

    // 1. The base's outer effects, unclipped, blending with what is below the stack.
    if (!cfg.editing) {
      if (g) {
        if (needsFx(g.el) && hasOuterEffects(g.el.effects)) {
          ctx.save();
          try {
            drawWithEffects(baseNode as GroupNode, { ...g, part: "outer" }, ctx, canvas, box);
          } finally {
            ctx.restore();
          }
        }
      } else drawGhost(ghost(CLIP_GHOST.outer), canvas);
    }

    // 2. The stack off-screen.
    const R = deviceBox(ctx, box, cfg.reach + 2);
    if (!R) return this;
    const { x0, y0, x1, y1, T } = R;
    const w = x1 - x0;
    const h = y1 - y0;
    const at = (c: KCanvas) => {
      const cx = c._canvas.getContext("2d")!;
      cx.setTransform(T.a, T.b, T.c, T.d, T.e - x0, T.f - y0);
      return cx;
    };
    const S = acquire(w, h);
    try {
      const sctx = at(S);
      if (!cfg.editing) {
        if (g) {
          const body = { ...g, el: { ...g.el, opacity: 1 }, part: "body" as const };
          sctx.save();
          try {
            if (needsFx(body.el)) drawWithEffects(baseNode as GroupNode, body, sctx, S, box);
            else drawMembers(baseNode, S);
          } finally {
            sctx.restore();
          }
        } else drawGhost(ghost(CLIP_GHOST.body), S);
      }
      const drawMask = isGroup ? (c: KCanvas) => drawMembers(baseNode, c) : (c: KCanvas) => drawGhost(ghost(CLIP_GHOST.mask), c);
      if (clipped.length) drawClipped(this, clipped, drawMask, S, w, h, at);
      // 3. Onto the page with the base's opacity and blend mode.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = cfg.base.opacity * this.getAbsoluteOpacity();
      const mode = cfg.base.blendMode && cfg.base.blendMode !== "pass-through" ? cfg.base.blendMode : "normal";
      const native = NATIVE_BLEND[mode];
      if (native) {
        ctx.globalCompositeOperation = native;
        ctx.drawImage(S._canvas, x0, y0);
      } else {
        drawBlended(ctx, S._canvas, x0, y0, w, h, mode, parseInt(hashString(cfg.base.id), 36));
      }
    } finally {
      release(S);
    }
  } finally {
    ctx.restore();
  }
  return this;
}

/** Draw each clipped node onto the stack `S`, kept only inside the base's content alpha. */
function drawClipped(
  stack: ClipNode,
  clipped: Konva.Node[],
  drawMask: (c: KCanvas) => void,
  S: KCanvas,
  w: number,
  h: number,
  at: (c: KCanvas) => CanvasRenderingContext2D,
) {
  const mask = acquire(w, h);
  try {
    at(mask);
    drawMask(mask);
    const P = acquire(w, h);
    try {
      const sctx = S._canvas.getContext("2d")!;
      const pctx = P._canvas.getContext("2d")!;
      for (const c of clipped) {
        // Keep the stack as it was, draw the layer over it, then mix the two by the mask.
        pctx.setTransform(1, 0, 0, 1, 0, 0);
        pctx.globalCompositeOperation = "source-over";
        pctx.globalAlpha = 1;
        pctx.clearRect(0, 0, w, h);
        pctx.drawImage(S._canvas, 0, 0);
        sctx.save();
        try {
          at(S);
          c.drawScene(S as never, stack);
        } finally {
          sctx.restore();
        }
        sctx.save();
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.globalAlpha = 1;
        sctx.globalCompositeOperation = "destination-in";
        sctx.drawImage(mask._canvas, 0, 0);
        pctx.globalCompositeOperation = "destination-out";
        pctx.drawImage(mask._canvas, 0, 0);
        sctx.globalCompositeOperation = "lighter";
        sctx.drawImage(P._canvas, 0, 0);
        sctx.restore();
      }
    } finally {
      release(P);
    }
  } finally {
    release(mask);
  }
}
