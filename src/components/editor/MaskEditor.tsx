"use client";

import type Konva from "konva";
import { Group, Image as KonvaImage, Shape } from "react-konva";
import type { ImageElement } from "@/lib/model";
import { traceShape } from "@/lib/render";
import { useEditor } from "@/store/editor";
import { useView } from "@/store/view";
import { useAssetImage } from "./ElementNode";

type Props = {
  el: ImageElement;
  scale: number;
  accent: string;
  /** The see-through picture, for the canvas transformer to attach to. */
  nodeRef: (node: Konva.Image | null) => void;
};

/**
 * Adjust a masked image: the whole picture shows faded over the page so it can be
 * dragged, and resized or rotated with the canvas transformer, inside the mask.
 */
export function MaskEditor({ el, scale, accent, nodeRef }: Props) {
  const img = useAssetImage(el.assetId);
  const m = el.mask!;
  const r = m.image;
  const moveTo = (n: Konva.Node) =>
    useEditor
      .getState()
      .update([el.id], { mask: { ...m, image: { ...r, x: n.x(), y: n.y() } } }, { coalesce: `mask-move:${el.id}` });
  return (
    <Group x={el.x} y={el.y} rotation={el.rotation}>
      <KonvaImage
        ref={nodeRef}
        name="mask-image"
        image={img}
        x={r.x}
        y={r.y}
        width={r.width}
        height={r.height}
        rotation={r.rotation}
        cornerRadius={el.cornerRadius}
        opacity={0.45}
        draggable
        onDragMove={(e) => moveTo(e.target)}
        onDragEnd={(e) => moveTo(e.target)}
        onDblClick={() => useView.getState().set({ maskEditId: null })}
        onDblTap={() => useView.getState().set({ maskEditId: null })}
      />
      <Shape
        listening={false}
        stroke={accent}
        strokeWidth={1.5 / scale}
        dash={[6 / scale, 4 / scale]}
        sceneFunc={(ctx, shape) => {
          traceShape(ctx, m.shape, el.width, el.height);
          ctx.strokeShape(shape);
        }}
      />
    </Group>
  );
}
