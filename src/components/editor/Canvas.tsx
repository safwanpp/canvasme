"use client";

import type Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Layer, Line, Rect, Stage, Transformer } from "react-konva";
import { useRouter } from "next/navigation";
import { ensureFonts, FONTS } from "@/lib/fonts";
import type { Element } from "@/lib/model";
import { lineBetween, lineEnds, pageFonts } from "@/lib/render";
import { importWorkfile, WORKFILE_EXT } from "@/lib/workfile";
import { currentPage, normalize, useEditor } from "@/store/editor";
import { useView } from "@/store/view";
import { useMediaQuery } from "../ui";
import {
  ASSET_DRAG_TYPE,
  addImageFiles,
  insertAsset,
  insertText,
  placeLine,
  placePath,
  placeShape,
  placeSticky,
} from "./actions";
import { ElementNode } from "./ElementNode";
import { TextEditor } from "./TextEditor";

const ACCENT = "#3e3aa8";
const GUIDE = "#9d7ff4";
const SNAP_PX = 6;

type Guide = { vertical: boolean; pos: number };

/** In-progress Draw stroke, or the box/segment being dragged out by the Shape and Line tools. */
type Draft = { kind: "draw"; points: number[] } | { kind: "box"; x0: number; y0: number; x1: number; y1: number };

export const PEN_OPACITY = { pen: 1, marker: 1, highlighter: 0.4 } as const;

/** Pen sizes are relative to the page so a stroke looks the same on a logo or a poster. */
export const penWidth = (size: number, W: number, H: number) => (size * Math.min(W, H)) / 800;

export default function Canvas({ onNotice }: { onNotice: (msg: string) => void }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const pageRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Group>());

  const design = useEditor((s) => s.design)!;
  const page = useEditor(currentPage);
  const selected = useEditor((s) => s.selected);
  const editingTextId = useEditor((s) => s.editingTextId);
  const { scale, x, y, container, fitTick, spaceDown, tool, pen, shapeKind } = useView();

  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [fontsVersion, setFontsVersion] = useState(0);
  const panning = useRef(false);
  const touchPan = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const coarse = useMediaQuery("(pointer: coarse)");
  const [draft, setDraftState] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const setDraft = (d: Draft | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const erasing = useRef(false);

  // Two-finger pinch zooms and pans, wherever the fingers land.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let last: { dist: number; cx: number; cy: number } | null = null;
    const read = (t: TouchList) => {
      const r = el.getBoundingClientRect();
      const [a, b] = [t[0], t[1]];
      return {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        cx: (a.clientX + b.clientX) / 2 - r.left,
        cy: (a.clientY + b.clientY) / 2 - r.top,
      };
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      // A pinch often starts with one finger on an element; undo that accidental
      // drag by restoring the stored position before cancelling it.
      const els = currentPage(useEditor.getState())?.elements ?? [];
      // Restore every node, since the transformer moves the whole selection together.
      nodes.current.forEach((n, id) => {
        const el = els.find((e) => e.id === id);
        if (el) n.position({ x: el.x, y: el.y });
      });
      nodes.current.forEach((n) => n.isDragging() && n.stopDrag());
      setGuides([]);
      // A second finger means pinch, not a stroke: drop whatever the first finger started.
      draftRef.current = null;
      setDraftState(null);
      erasing.current = false;
      touchPan.current = null;
      last = read(e.touches);
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !last) return;
      e.preventDefault();
      const next = read(e.touches);
      const v = useView.getState();
      v.set({ x: v.x + next.cx - last.cx, y: v.y + next.cy - last.cy });
      useView.getState().zoomAt(v.scale * (next.dist / last.dist), next.cx, next.cy);
      last = next;
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) last = null;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // Track viewport size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      useView.getState().set({ container: { width: entry.contentRect.width, height: entry.contentRect.height } });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit page to viewport on load, resize of design, or explicit request.
  const hasSize = container.width > 0;
  useEffect(() => {
    if (!hasSize) return;
    const { container: c } = useView.getState();
    const pad = c.width < 640 ? 32 : 96;
    const s = Math.min((c.width - pad) / design.width, (c.height - pad) / design.height, 2);
    useView.getState().set({ scale: s, x: (c.width - design.width * s) / 2, y: (c.height - design.height * s) / 2 });
  }, [hasSize, fitTick, design.id, design.width, design.height]);

  // Load fonts used on the page, then re-measure text once they are available.
  const fontKey = page ? [...new Set(pageFonts(page))].sort().join("|") : "";
  useEffect(() => {
    if (!fontKey) return;
    let alive = true;
    ensureFonts(fontKey.split("|")).then(() => {
      if (!alive) return;
      setFontsVersion((v) => v + 1);
      useEditor.getState().mutate(
        (d) => d.pages.forEach((p) => (p.elements = p.elements.map(normalize))),
        { history: false },
      );
    });
    return () => {
      alive = false;
    };
  }, [fontKey]);

  // Warm the rest of the Latin font list so the picker can switch instantly. Malayalam
  // fonts are larger (about 4 MB together), so they load only when a design uses them.
  useEffect(() => {
    const t = setTimeout(() => ensureFonts(FONTS.filter((f) => !f.script).map((f) => f.family)), 1500);
    return () => clearTimeout(t);
  }, []);

  const register = useCallback((id: string, node: Konva.Group | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  const byId = useMemo(() => new Map(page?.elements.map((e) => [e.id, e]) ?? []), [page]);

  // Attach transformer to selected, editable nodes.
  const selectedEls = selected.map((id) => byId.get(id)).filter((e): e is Element => !!e && !e.hidden);
  const single = selectedEls.length === 1 ? selectedEls[0] : null;
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const attach = selectedEls.filter((e) => !e.locked && e.id !== editingTextId).map((e) => nodes.current.get(e.id));
    tr.nodes(attach.filter((n): n is Konva.Group => !!n));
    tr.getLayer()?.batchDraw();
  });

  const lockedOnly = selectedEls.length > 0 && selectedEls.every((e) => e.locked);

  // A single line gets a handle on each end instead of a box: drag one to change length and
  // angle with the other end fixed. Shift snaps to 15°. Hidden while the whole line is dragged.
  const [movingLine, setMovingLine] = useState(false);
  const lineEl = single?.type === "line" && !single.locked && tool === "select" ? single : null;
  const dragLineEnd = (end: 0 | 1, e: Konva.KonvaEventObject<DragEvent>) => {
    if (!lineEl) return;
    const fixed = lineEnds(lineEl)[end === 0 ? 1 : 0];
    let p = { x: e.target.x(), y: e.target.y() };
    if (e.evt.shiftKey) {
      const step = Math.PI / 12;
      const a = Math.round(Math.atan2(p.y - fixed.y, p.x - fixed.x) / step) * step;
      const len = Math.hypot(p.x - fixed.x, p.y - fixed.y);
      p = { x: fixed.x + Math.cos(a) * len, y: fixed.y + Math.sin(a) * len };
      e.target.position(p);
    }
    const [p0, p1] = end === 0 ? [p, fixed] : [fixed, p];
    useEditor.getState().update([lineEl.id], lineBetween(p0, p1, lineEl.height), { coalesce: `line-end:${lineEl.id}` });
  };

  const onPointerDown = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, el: Element) => {
    // Other tools draw or place over elements; let the stage handle the pointer.
    if (useView.getState().spaceDown || useView.getState().tool !== "select") return;
    e.cancelBubble = true;
    const st = useEditor.getState();
    const shift = "shiftKey" in e.evt && e.evt.shiftKey;
    if (shift && st.selected.includes(el.id)) {
      const members = el.groupId
        ? (currentPage(st)?.elements.filter((o) => o.groupId === el.groupId).map((o) => o.id) ?? [el.id])
        : [el.id];
      st.select(st.selected.filter((id) => !members.includes(id)));
    } else if (shift) {
      st.select([el.id], true);
    } else if (!st.selected.includes(el.id)) {
      st.select([el.id]);
    }
  }, []);

  const onDblClick = useCallback((el: Element) => {
    if (el.type === "text" && !el.locked) useEditor.getState().setEditingText(el.id);
  }, []);

  // Alt/Option at the start of a drag leaves a copy behind (Figma/Canva behaviour).
  const altCopy = useRef(false);
  const onDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    altCopy.current = false;
    setMovingLine(true);
    if (!(e.evt as MouseEvent).altKey) return;
    const st = useEditor.getState();
    const id = e.target.id();
    st.duplicateInPlace(st.selected.includes(id) ? st.selected : [id]);
    altCopy.current = true;
  }, []);

  // Snap the dragged element's box to page and sibling edges/centres. Hold Ctrl/Cmd to skip.
  const onDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target as Konva.Group;
    const st = useEditor.getState();
    const pg = currentPage(st);
    const pageNode = pageRef.current;
    if (!pg || !pageNode || st.selected.length > 1 || (e.evt as MouseEvent).metaKey || (e.evt as MouseEvent).ctrlKey) {
      setGuides([]);
      return;
    }
    const d = st.design!;
    const box = node.getClientRect({ relativeTo: pageNode, skipShadow: true });
    const xs = [0, d.width / 2, d.width];
    const ys = [0, d.height / 2, d.height];
    for (const o of pg.elements) {
      if (o.id === node.id() || o.hidden) continue;
      xs.push(o.x, o.x + o.width / 2, o.x + o.width);
      ys.push(o.y, o.y + o.height / 2, o.y + o.height);
    }
    const tol = SNAP_PX / useView.getState().scale;
    const snap = (edges: number[], targets: number[]) => {
      let best: { delta: number; pos: number } | null = null;
      for (const edge of edges) {
        for (const t of targets) {
          const delta = t - edge;
          if (Math.abs(delta) <= tol && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, pos: t };
        }
      }
      return best;
    };
    const sx = snap([box.x, box.x + box.width / 2, box.x + box.width], xs);
    const sy = snap([box.y, box.y + box.height / 2, box.y + box.height], ys);
    if (sx) node.x(node.x() + sx.delta);
    if (sy) node.y(node.y() + sy.delta);
    const g: Guide[] = [];
    if (sx) g.push({ vertical: true, pos: sx.pos });
    if (sy) g.push({ vertical: false, pos: sy.pos });
    setGuides((prev) =>
      prev.length === g.length && prev.every((p, i) => p.pos === g[i].pos && p.vertical === g[i].vertical) ? prev : g,
    );
  }, []);

  const onDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    setGuides([]);
    setMovingLine(false);
    const st = useEditor.getState();
    const id = e.target.id();
    const ids = st.selected.includes(id) ? st.selected : [id];
    const patches: Record<string, Partial<Element>> = {};
    for (const sid of ids) {
      const n = nodes.current.get(sid);
      if (n) patches[sid] = { x: n.x(), y: n.y() };
    }
    // After an Alt-drag copy, fold the move into the copy's undo step so one undo reverts both.
    st.updateMany(patches, altCopy.current ? { history: false } : undefined);
    altCopy.current = false;
  }, []);

  // Text: side anchors change wrap width live instead of stretching glyphs.
  const onTransform = () => {
    const tr = trRef.current;
    const anchor = tr?.getActiveAnchor() ?? "";
    if (!tr || !anchor.startsWith("middle")) return;
    for (const n of tr.nodes()) {
      if (byId.get(n.id())?.type !== "text") continue;
      const t = (n as Konva.Group).findOne("Text") as Konva.Text | undefined;
      if (!t) continue;
      t.width(Math.max(20, t.width() * n.scaleX()));
      n.scaleX(1);
      n.scaleY(1);
    }
  };

  const onTransformEnd = () => {
    const tr = trRef.current;
    if (!tr) return;
    const patches: Record<string, Partial<Element>> = {};
    for (const n of tr.nodes()) {
      const el = byId.get(n.id());
      if (!el) continue;
      const sx = n.scaleX();
      const sy = n.scaleY();
      const p: Partial<Element> = { x: n.x(), y: n.y(), rotation: n.rotation() };
      if (el.type === "text") {
        const t = (n as Konva.Group).findOne("Text") as Konva.Text | undefined;
        Object.assign(p, { width: Math.max(20, (t?.width() ?? el.width) * sx), fontSize: Math.max(1, el.fontSize * sy) });
      } else if (el.type === "line") {
        p.width = Math.max(5, el.width * sx);
      } else if (el.type === "path") {
        Object.assign(p, {
          width: Math.max(1, el.width * sx),
          height: Math.max(1, el.height * sy),
          points: el.points.map((v, i) => (i % 2 ? v * sy : v * sx)),
        });
      } else {
        p.width = Math.max(5, el.width * sx);
        p.height = Math.max(5, el.height * sy);
      }
      n.scaleX(1);
      n.scaleY(1);
      patches[el.id] = p;
    }
    useEditor.getState().updateMany(patches);
  };

  // Stage: marquee selection, deselect on empty click, pan with space / middle mouse.
  const isBackground = (t: Konva.Node) => t === t.getStage() || t.name() === "page-bg";

  // Tools other than Select: draw, erase, or place an element where the pointer goes down.
  const pagePoint = () => pageRef.current?.getRelativePointerPosition() ?? null;

  const eraseAtPointer = () => {
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    let node: Konva.Node | null | undefined = pos && stage?.getIntersection(pos);
    while (node && !(node.id() && byId.has(node.id()))) node = node.getParent();
    const el = node && byId.get(node.id());
    if (el?.type === "path" && !el.locked) {
      useEditor.getState().mutate(
        (d) => {
          const pg = d.pages.find((p) => p.id === page?.id);
          if (pg) pg.elements = pg.elements.filter((o) => o.id !== el.id);
        },
        { coalesce: "erase" },
      );
    }
  };

  const toolDown = () => {
    const p = pagePoint();
    if (!p) return;
    const v = useView.getState();
    const st = useEditor.getState();
    if (tool === "draw") setDraft({ kind: "draw", points: [p.x, p.y] });
    else if (tool === "eraser") {
      erasing.current = true;
      eraseAtPointer();
    } else if (tool === "shape" || tool === "line") setDraft({ kind: "box", x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    else if (tool === "sticky" || tool === "text") {
      v.set({ tool: "select" });
      const placing = tool === "sticky" ? placeSticky(p) : insertText("body", p);
      void placing.then((id) => st.setEditingText(id));
    }
  };

  const toolMove = () => {
    if (erasing.current) return eraseAtPointer();
    const d = draftRef.current;
    const p = pagePoint();
    if (!d || !p) return;
    if (d.kind === "box") return setDraft({ ...d, x1: p.x, y1: p.y });
    const n = d.points.length;
    // Skip points closer than a screen pixel; they add size without detail.
    if (Math.hypot(p.x - d.points[n - 2], p.y - d.points[n - 1]) * scale < 1) return;
    setDraft({ kind: "draw", points: [...d.points, p.x, p.y] });
  };

  const toolUp = () => {
    erasing.current = false;
    const d = draftRef.current;
    if (!d) return;
    setDraft(null);
    if (d.kind === "draw") {
      placePath(d.points, pen.color, penWidth(pen.size, design.width, design.height), PEN_OPACITY[pen.kind]);
      return;
    }
    if (tool === "shape") {
      placeShape(shapeKind, {
        x: Math.min(d.x0, d.x1),
        y: Math.min(d.y0, d.y1),
        width: Math.abs(d.x1 - d.x0),
        height: Math.abs(d.y1 - d.y0),
      });
    } else placeLine({ x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 });
    useView.getState().set({ tool: "select" });
  };

  const onStageDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (useEditor.getState().editingTextId) useEditor.getState().setEditingText(null);
    if (useView.getState().spaceDown || e.evt.button === 1) {
      panning.current = true;
      return;
    }
    if (tool !== "select") {
      if (e.evt.button === 0) toolDown();
      return;
    }
    if (!isBackground(e.target)) return;
    if (!e.evt.shiftKey) useEditor.getState().select([]);
    const p = pageRef.current?.getRelativePointerPosition();
    if (p) setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const onStageMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (panning.current) {
      const v = useView.getState();
      v.set({ x: v.x + e.evt.movementX, y: v.y + e.evt.movementY });
      return;
    }
    if (tool !== "select") return toolMove();
    if (!marquee) return;
    const p = pageRef.current?.getRelativePointerPosition();
    if (p) setMarquee({ ...marquee, x1: p.x, y1: p.y });
  };

  const onStageUp = (e: Konva.KonvaEventObject<MouseEvent>) => {
    panning.current = false;
    if (tool !== "select") return toolUp();
    if (!marquee) return;
    const x0 = Math.min(marquee.x0, marquee.x1);
    const x1 = Math.max(marquee.x0, marquee.x1);
    const y0 = Math.min(marquee.y0, marquee.y1);
    const y1 = Math.max(marquee.y0, marquee.y1);
    setMarquee(null);
    if (x1 - x0 < 3 && y1 - y0 < 3) return;
    const hits = (page?.elements ?? [])
      .filter((el) => !el.hidden && el.x < x1 && el.x + el.width > x0 && el.y < y1 && el.y + el.height > y0)
      .map((el) => el.id);
    useEditor.getState().select(hits, e.evt.shiftKey);
  };

  // One finger on empty canvas pans; a tap without movement clears the selection.
  const onStageTouchStart = (e: Konva.KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length === 1 && tool !== "select") return toolDown();
    if (e.evt.touches.length !== 1 || !isBackground(e.target)) return;
    if (useEditor.getState().editingTextId) useEditor.getState().setEditingText(null);
    const t = e.evt.touches[0];
    touchPan.current = { x: t.clientX, y: t.clientY, moved: false };
  };

  const onStageTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    if (tool !== "select") return toolMove();
    const p = touchPan.current;
    if (!p || e.evt.touches.length !== 1) return;
    const t = e.evt.touches[0];
    const v = useView.getState();
    v.set({ x: v.x + t.clientX - p.x, y: v.y + t.clientY - p.y });
    touchPan.current = { x: t.clientX, y: t.clientY, moved: p.moved || Math.hypot(t.clientX - p.x, t.clientY - p.y) > 2 };
  };

  const onStageTouchEnd = () => {
    if (tool !== "select") return toolUp();
    if (touchPan.current && !touchPan.current.moved) useEditor.getState().select([]);
    touchPan.current = null;
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const v = useView.getState();
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const p = stageRef.current?.getPointerPosition();
      if (p) v.zoomAt(v.scale * Math.exp(-e.evt.deltaY * 0.01), p.x, p.y);
    } else {
      v.set({ x: v.x - e.evt.deltaX, y: v.y - e.evt.deltaY });
    }
  };

  // Drop: images, assets from the uploads panel, or a .canvasme work file.
  const pagePointFromClient = (clientX: number, clientY: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const v = useView.getState();
    return { x: (clientX - rect.left - v.x) / v.scale, y: (clientY - rect.top - v.y) / v.scale };
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const at = pagePointFromClient(e.clientX, e.clientY);
    const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (assetId) return insertAsset(assetId, at);
    const files = [...e.dataTransfer.files];
    const work = files.find((f) => f.name.toLowerCase().endsWith(WORKFILE_EXT));
    if (work) {
      try {
        const d = await importWorkfile(work);
        router.push(`/app/edit?id=${d.id}`);
      } catch (err) {
        onNotice((err as Error).message);
      }
      return;
    }
    const warning = await addImageFiles(files, at);
    if (warning) onNotice(warning);
  };

  if (!page) return null;
  const W = design.width;
  const H = design.height;
  const editingEl = editingTextId ? byId.get(editingTextId) : undefined;

  const anchors =
    single?.type === "text"
      ? ["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right"]
      : single?.type === "line"
        ? []
        : single?.type === "image" || selectedEls.length > 1
          ? ["top-left", "top-right", "bottom-left", "bottom-right"]
          : undefined;

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-ink-100"
      style={{ cursor: spaceDown ? "grab" : tool === "text" ? "text" : tool === "select" ? "default" : "crosshair" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {hasSize && (
        <Stage
          ref={stageRef}
          width={container.width}
          height={container.height}
          onMouseDown={onStageDown}
          onMouseMove={onStageMove}
          onMouseUp={onStageUp}
          onMouseLeave={() => {
            panning.current = false;
            if (tool !== "select") toolUp();
          }}
          onWheel={onWheel}
          onTouchStart={onStageTouchStart}
          onTouchMove={onStageTouchMove}
          onTouchEnd={onStageTouchEnd}
        >
          <Layer>
            <Group ref={pageRef} x={x} y={y} scaleX={scale} scaleY={scale}>
              <Rect
                name="page-bg"
                width={W}
                height={H}
                fill={page.background}
                shadowColor="rgba(30,34,90,0.22)"
                shadowBlur={24 / scale}
                shadowOffsetY={4 / scale}
              />
              <Group clipX={0} clipY={0} clipWidth={W} clipHeight={H}>
                {page.elements.map((el) => (
                  <ElementNode
                    key={el.id}
                    el={el}
                    editing={el.id === editingTextId}
                    fontsVersion={fontsVersion}
                    interactive={tool === "select"}
                    register={register}
                    onPointerDown={onPointerDown}
                    onDblClick={onDblClick}
                    onDragStart={onDragStart}
                    onDragMove={onDragMove}
                    onDragEnd={onDragEnd}
                  />
                ))}
              </Group>
              {guides.map((g, i) => (
                <Line
                  key={i}
                  points={g.vertical ? [g.pos, -10000, g.pos, 10000] : [-10000, g.pos, 10000, g.pos]}
                  stroke={GUIDE}
                  strokeWidth={1 / scale}
                  listening={false}
                />
              ))}
              {lockedOnly &&
                selectedEls.map((el) => (
                  <Rect
                    key={el.id}
                    x={el.x}
                    y={el.y}
                    width={el.width}
                    height={el.height}
                    rotation={el.rotation}
                    stroke={ACCENT}
                    dash={[4 / scale, 4 / scale]}
                    strokeWidth={1.5 / scale}
                    listening={false}
                  />
                ))}
              {draft?.kind === "draw" && (
                <Line
                  points={draft.points}
                  stroke={pen.color}
                  strokeWidth={penWidth(pen.size, W, H)}
                  opacity={PEN_OPACITY[pen.kind]}
                  tension={0.4}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              )}
              {draft?.kind === "box" &&
                (tool === "line" ? (
                  <Line
                    points={[draft.x0, draft.y0, draft.x1, draft.y1]}
                    stroke={ACCENT}
                    strokeWidth={2 / scale}
                    listening={false}
                  />
                ) : (
                  <Rect
                    x={Math.min(draft.x0, draft.x1)}
                    y={Math.min(draft.y0, draft.y1)}
                    width={Math.abs(draft.x1 - draft.x0)}
                    height={Math.abs(draft.y1 - draft.y0)}
                    stroke={ACCENT}
                    dash={[6 / scale, 4 / scale]}
                    strokeWidth={1.5 / scale}
                    listening={false}
                  />
                ))}
              {lineEl &&
                !movingLine &&
                lineEnds(lineEl).map((p, i) => (
                  <Circle
                    key={i}
                    x={p.x}
                    y={p.y}
                    radius={(coarse ? 9 : 6) / scale}
                    hitStrokeWidth={16 / scale}
                    fill="#ffffff"
                    stroke={ACCENT}
                    strokeWidth={1.5 / scale}
                    draggable
                    onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "move")}
                    onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = "")}
                    onDragMove={(e) => dragLineEnd(i as 0 | 1, e)}
                    onDragEnd={(e) => dragLineEnd(i as 0 | 1, e)}
                  />
                ))}
              {marquee && (
                <Rect
                  x={Math.min(marquee.x0, marquee.x1)}
                  y={Math.min(marquee.y0, marquee.y1)}
                  width={Math.abs(marquee.x1 - marquee.x0)}
                  height={Math.abs(marquee.y1 - marquee.y0)}
                  fill="rgba(62,58,168,0.08)"
                  stroke={ACCENT}
                  strokeWidth={1 / scale}
                  listening={false}
                />
              )}
            </Group>
            <Transformer
              ref={trRef}
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              rotationSnapTolerance={4}
              keepRatio={single?.type !== "shape"}
              rotateEnabled={single?.type !== "line"}
              enabledAnchors={anchors}
              borderStroke={ACCENT}
              borderStrokeWidth={1.5}
              anchorStroke={ACCENT}
              anchorFill="#ffffff"
              anchorSize={coarse ? 16 : 10}
              anchorCornerRadius={coarse ? 8 : 5}
              anchorStrokeWidth={1.5}
              rotateAnchorOffset={28}
              ignoreStroke
              onTransform={onTransform}
              onTransformEnd={onTransformEnd}
              boundBoxFunc={(oldBox, newBox) =>
                // Lines are only as tall as their stroke, so don't hold them to a minimum height.
                Math.abs(newBox.width) < 5 || (single?.type !== "line" && Math.abs(newBox.height) < 2) ? oldBox : newBox
              }
            />
          </Layer>
        </Stage>
      )}
      {editingEl?.type === "text" && <TextEditor el={editingEl} scale={scale} origin={{ x, y }} />}
    </div>
  );
}
