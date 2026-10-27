"use client";

import type Konva from "konva";
import { useEffect, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Rect } from "react-konva";
import { loadAssetImage, primeAssetImage } from "@/lib/images";
import { rotate } from "@/lib/mask";
import { type ImageElement, uid } from "@/lib/model";
import { baseNodes, canvasToBlob, cropPixels, groupAttrs } from "@/lib/render";
import { saveAsset } from "@/lib/storage";
import { useEditor } from "@/store/editor";
import { useView } from "@/store/view";

type Pt = { x: number; y: number };

/**
 * One erase session: strokes paint on `canvas`, an off-screen copy of the bitmap at full
 * size, and nothing reaches the store (or IndexedDB) until the session ends.
 */
type Session = {
  elId: string;
  /** The asset the session started from. */
  assetId: string;
  canvas: HTMLCanvasElement;
  /** What the Restore brush paints back: the bitmap from before the first erase. */
  source: HTMLImageElement;
  dirty: boolean;
};

let session: Session | null = null;
let finishing = false;

/**
 * Leave Erase mode. The painted bitmap becomes a new asset in one undo step; the first
 * erase of an image also remembers the original, for the Restore brush. `discard` drops
 * the session's strokes instead.
 */
export async function finishErase(opts: { discard?: boolean } = {}) {
  if (finishing) return;
  const s = session;
  const done = () => {
    session = null;
    useView.getState().set({ eraseEditId: null });
  };
  if (!s || !s.dirty || opts.discard) return done();
  finishing = true;
  try {
    const blob = await canvasToBlob(s.canvas);
    const id = uid();
    await saveAsset(id, blob);
    await primeAssetImage(id, blob);
    useEditor.getState().mutate((d) => {
      const prev = d.assets[s.assetId];
      let used = false;
      for (const p of d.pages) {
        for (const e of p.elements) {
          if (e.id !== s.elId || e.type !== "image" || e.assetId !== s.assetId) continue;
          e.eraseSource ??= s.assetId;
          e.assetId = id;
          used = true;
        }
      }
      if (!used) return;
      d.assets[id] = {
        mime: "image/png",
        name: `${(prev?.name ?? "Image").replace(/\.[^.]+$/, "").replace(/ \(erased\)$/, "")} (erased).png`,
        width: s.canvas.width,
        height: s.canvas.height,
        generated: true,
      };
    });
  } catch {
    // Storage full or the encode failed: keep the bitmap as it was.
  } finally {
    finishing = false;
    done();
  }
}

type Props = {
  el: ImageElement;
  scale: number;
  /** Page coordinates of a point on screen. */
  toPage: (clientX: number, clientY: number) => Pt;
};

/** Erase (or restore) pixels of an image with a round brush, previewed live on the canvas. */
export function EraseEditor({ el, scale, toPage }: Props) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const groupRef = useRef<Konva.Group>(null);
  const cursorRef = useRef<Konva.Group>(null);
  /** Begins a stroke; set while the session's canvas is ready. */
  const startRef = useRef<((e: PointerEvent) => void) | null>(null);
  const latest = useRef({ el, scale, toPage });
  useEffect(() => {
    latest.current = { el, scale, toPage };
  });

  // Start the session: copy the bitmap into an off-screen canvas at its full size.
  const { id: elId, assetId, eraseSource } = el;
  useEffect(() => {
    let alive = true;
    void Promise.all([loadAssetImage(assetId), loadAssetImage(eraseSource ?? assetId)]).then(([img, src]) => {
      if (!alive || !img) return;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      session = { elId, assetId, canvas: c, source: src ?? img, dirty: false };
      setCanvas(c);
    });
    return () => {
      alive = false;
      // Unmounted without Done (page switch, element gone): keep what was painted.
      if (session?.elId === elId) void finishErase();
    };
  }, [elId, assetId, eraseSource]);

  // Painting and the brush cursor follow window pointer events, so a stroke carries on
  // past the image's edge and works the same for mouse, pen and touch.
  useEffect(() => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const scratch = document.createElement("canvas");
    let stroke: { pointerId: number; last: Pt } | null = null;

    /** Brush centre and radii in the bitmap's pixels, from a point on screen. */
    const toBitmap = (clientX: number, clientY: number) => {
      const { el: e, scale: s, toPage: tp } = latest.current;
      const p = tp(clientX, clientY);
      const l = rotate(p.x - e.x, p.y - e.y, -e.rotation);
      const c = cropPixels(e.crop, canvas);
      const r = useView.getState().eraseBrush.size / 2 / s;
      return {
        x: c.x + (l.x / e.width) * c.width,
        y: c.y + (l.y / e.height) * c.height,
        rx: Math.max(0.5, (r * c.width) / e.width),
        ry: Math.max(0.5, (r * c.height) / e.height),
      };
    };

    // A unit-circle brush, scaled to the radii: solid inside, fading to nothing over `softness`.
    const brush = (c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) => {
      const soft = useView.getState().eraseBrush.softness;
      c.save();
      c.translate(x, y);
      c.scale(rx, ry);
      const g = c.createRadialGradient(0, 0, Math.min(0.99, 1 - soft), 0, 0, 1);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, 1, 0, Math.PI * 2);
      c.fill();
      c.restore();
    };

    const dab = (x: number, y: number, rx: number, ry: number, restore: boolean) => {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      brush(ctx, x, y, rx, ry);
      ctx.restore();
      if (!restore) return;
      // Restore = mix the original back in by the brush's strength: the brush already took
      // that share out above, so add the original's share on top ("lighter" adds).
      const bx = Math.floor(x - rx) - 1;
      const by = Math.floor(y - ry) - 1;
      const bw = Math.ceil(rx * 2) + 3;
      const bh = Math.ceil(ry * 2) + 3;
      if (scratch.width < bw || scratch.height < bh) {
        scratch.width = Math.max(scratch.width, bw);
        scratch.height = Math.max(scratch.height, bh);
      }
      const sc = scratch.getContext("2d")!;
      sc.clearRect(0, 0, bw, bh);
      brush(sc, x - bx, y - by, rx, ry);
      sc.save();
      sc.globalCompositeOperation = "source-in";
      sc.drawImage(session!.source, -bx, -by, canvas.width, canvas.height);
      sc.restore();
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(scratch, 0, 0, bw, bh, bx, by, bw, bh);
      ctx.restore();
    };

    const paintTo = (clientX: number, clientY: number) => {
      if (!stroke || !session) return;
      const b = toBitmap(clientX, clientY);
      const restore = useView.getState().eraseBrush.restore;
      const { last } = stroke;
      // Dabs along the segment, close enough together to read as one stroke.
      const step = Math.max(1, Math.min(b.rx, b.ry) * 0.25);
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - last.x, b.y - last.y) / step));
      for (let i = 1; i <= n; i++) {
        dab(last.x + ((b.x - last.x) * i) / n, last.y + ((b.y - last.y) * i) / n, b.rx, b.ry, restore);
      }
      stroke.last = { x: b.x, y: b.y };
      session.dirty = true;
    };

    const moveCursor = (e: PointerEvent) => {
      const cur = cursorRef.current;
      const stage = cur?.getStage();
      if (!cur || !stage) return;
      const over = stage.container().contains(e.target as Node);
      const p = latest.current.toPage(e.clientX, e.clientY);
      cur.position(p);
      cur.visible(over || !!stroke);
    };

    const onDown = (e: PointerEvent) => {
      // A second finger means pinch-zoom, not painting.
      if (stroke && e.pointerId !== stroke.pointerId) stroke = null;
    };
    const onMove = (e: PointerEvent) => {
      moveCursor(e);
      if (stroke?.pointerId === e.pointerId) {
        const events = e.getCoalescedEvents?.() ?? [];
        for (const ce of events.length ? events : [e]) paintTo(ce.clientX, ce.clientY);
      }
      groupRef.current?.getLayer()?.batchDraw();
    };
    const onUp = (e: PointerEvent) => {
      if (stroke?.pointerId === e.pointerId) stroke = null;
    };
    const start = (e: PointerEvent) => {
      if (finishing || (e.pointerType === "mouse" && e.button !== 0)) return;
      const b = toBitmap(e.clientX, e.clientY);
      stroke = { pointerId: e.pointerId, last: { x: b.x, y: b.y } };
      dab(b.x, b.y, b.rx, b.ry, useView.getState().eraseBrush.restore);
      if (session) session.dirty = true;
      moveCursor(e);
      groupRef.current?.getLayer()?.batchDraw();
    };
    startRef.current = start;

    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      startRef.current = null;
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [canvas]);

  const size = useView((s) => s.eraseBrush.size);
  const restore = useView((s) => s.eraseBrush.restore);
  const r = size / 2 / scale;
  return (
    <>
      <Group ref={groupRef} {...groupAttrs(el)}>
        {canvas &&
          baseNodes(el, canvas).map((n, i) =>
            n.kind === "Image" ? <KonvaImage key={i} {...(n.attrs as Konva.ImageConfig)} listening={false} /> : null,
          )}
        {/* Where a stroke can start: the image's box. */}
        <Rect
          width={el.width}
          height={el.height}
          fill="rgba(0,0,0,0)"
          onPointerDown={(e) => {
            e.cancelBubble = true;
            startRef.current?.(e.evt);
          }}
        />
      </Group>
      <Group ref={cursorRef} visible={false} listening={false}>
        <Circle radius={r} stroke="rgba(0,0,0,0.6)" strokeWidth={2.5 / scale} />
        <Circle radius={r} stroke="#ffffff" strokeWidth={1.2 / scale} dash={restore ? [4 / scale, 3 / scale] : undefined} />
      </Group>
    </>
  );
}
