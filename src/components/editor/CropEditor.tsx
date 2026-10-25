"use client";

import type Konva from "konva";
import { useEffect, useRef } from "react";
import { Group, Image as KonvaImage, Line, Rect } from "react-konva";
import { cropTo, fullPicture, MIN_CROP, slidePicture } from "@/lib/crop";
import { rotate } from "@/lib/mask";
import type { ImageElement } from "@/lib/model";
import { useEditor } from "@/store/editor";
import { useView } from "@/store/view";
import { useAssetImage } from "./ElementNode";

type Pt = { x: number; y: number };

type Props = {
  el: ImageElement;
  scale: number;
  accent: string;
  coarse: boolean;
  /** Page coordinates of a point on screen. */
  toPage: (clientX: number, clientY: number) => Pt;
};

// Handle positions as fractions of the crop box: corners, then edge midpoints.
const HANDLES: { hx: 0 | 0.5 | 1; hy: 0 | 0.5 | 1; cursor: string }[] = [
  { hx: 0, hy: 0, cursor: "nwse-resize" },
  { hx: 1, hy: 0, cursor: "nesw-resize" },
  { hx: 1, hy: 1, cursor: "nwse-resize" },
  { hx: 0, hy: 1, cursor: "nesw-resize" },
  { hx: 0.5, hy: 0, cursor: "ns-resize" },
  { hx: 1, hy: 0.5, cursor: "ew-resize" },
  { hx: 0.5, hy: 1, cursor: "ns-resize" },
  { hx: 0, hy: 0.5, cursor: "ew-resize" },
];

type Drag = { kind: "move" | number; from: Pt; el: ImageElement; pointerId: number };

/**
 * Crop an image: the whole picture shows faded with the crop box bright on top of it.
 * Drag the handles to change the crop, or the picture to slide it under the box.
 */
export function CropEditor({ el, scale, accent, coarse, toPage }: Props) {
  const img = useAssetImage(el.assetId);
  const pic = fullPicture(el);
  const drag = useRef<Drag | null>(null);
  const toPageRef = useRef(toPage);
  useEffect(() => {
    toPageRef.current = toPage;
  });

  // Every move is worked out from the element as it was when the drag began, so the
  // store's updates during the drag never feed back into it.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const p = toPageRef.current(e.clientX, e.clientY);
      const delta = rotate(p.x - d.from.x, p.y - d.from.y, -d.el.rotation);
      const start = d.el;
      const full = fullPicture(start);
      let patch: Partial<ImageElement>;
      if (d.kind === "move") {
        patch = slidePicture(start, full.x + delta.x, full.y + delta.y);
      } else {
        const { hx, hy } = HANDLES[d.kind];
        let [x0, y0, x1, y1] = [0, 0, start.width, start.height];
        const min = Math.min(MIN_CROP, full.width, full.height);
        if (hx === 0) x0 = Math.min(x1 - min, Math.max(full.x, delta.x));
        if (hx === 1) x1 = Math.max(x0 + min, Math.min(full.x + full.width, start.width + delta.x));
        if (hy === 0) y0 = Math.min(y1 - min, Math.max(full.y, delta.y));
        if (hy === 1) y1 = Math.max(y0 + min, Math.min(full.y + full.height, start.height + delta.y));
        patch = cropTo(start, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
      }
      useEditor.getState().update([start.id], patch, { coalesce: `crop:${start.id}` });
    };
    const onUp = (e: PointerEvent) => {
      if (drag.current?.pointerId === e.pointerId) drag.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const begin = (kind: Drag["kind"]) => (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.cancelBubble = true;
    const now = useEditor.getState();
    const fresh = now.design?.pages.flatMap((p) => p.elements).find((o) => o.id === el.id);
    if (fresh?.type !== "image") return;
    drag.current = {
      kind,
      from: toPage(e.evt.clientX, e.evt.clientY),
      el: fresh,
      pointerId: e.evt.pointerId,
    };
  };

  const setCursor = (e: Konva.KonvaEventObject<MouseEvent>, cursor: string) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = cursor;
  };

  const w = el.width;
  const h = el.height;
  const done = () => useView.getState().set({ cropEditId: null });
  const arm = Math.min(18 / scale, w / 3, h / 3);
  const thick = (coarse ? 5 : 4) / scale;
  return (
    <Group x={el.x} y={el.y} rotation={el.rotation}>
      <KonvaImage
        image={img}
        {...pic}
        opacity={0.4}
        onPointerDown={begin("move")}
        onMouseEnter={(e) => setCursor(e, "move")}
        onMouseLeave={(e) => setCursor(e, "")}
        onDblClick={done}
        onDblTap={done}
      />
      <Group clipX={0} clipY={0} clipWidth={w} clipHeight={h} listening={false}>
        <KonvaImage image={img} {...pic} />
      </Group>
      <Rect width={w} height={h} stroke="#ffffff" strokeWidth={1 / scale} listening={false} />
      <Rect width={w} height={h} stroke={accent} strokeWidth={1 / scale} dash={[4 / scale, 4 / scale]} listening={false} />
      {[1, 2].map((i) => (
        <Group key={i} listening={false} opacity={0.6}>
          <Line points={[(w * i) / 3, 0, (w * i) / 3, h]} stroke="#ffffff" strokeWidth={1 / scale} />
          <Line points={[0, (h * i) / 3, w, (h * i) / 3]} stroke="#ffffff" strokeWidth={1 / scale} />
        </Group>
      ))}
      {HANDLES.map((hd, i) => {
        const x = hd.hx * w;
        const y = hd.hy * h;
        const corner = hd.hx !== 0.5 && hd.hy !== 0.5;
        // Corners are an L hugging the box; edges a short bar along the edge.
        const points = corner
          ? [x + (hd.hx === 0 ? arm : -arm), y, x, y, x, y + (hd.hy === 0 ? arm : -arm)]
          : hd.hx === 0.5
            ? [x - arm, y, x + arm, y]
            : [x, y - arm, x, y + arm];
        return (
          <Line
            key={i}
            points={points}
            stroke="#ffffff"
            strokeWidth={thick}
            lineCap="round"
            lineJoin="round"
            shadowColor="rgba(0,0,0,0.45)"
            shadowBlur={3 / scale}
            hitStrokeWidth={(coarse ? 28 : 16) / scale}
            onPointerDown={begin(i)}
            onMouseEnter={(e) => setCursor(e, hd.cursor)}
            onMouseLeave={(e) => setCursor(e, "")}
          />
        );
      })}
    </Group>
  );
}
