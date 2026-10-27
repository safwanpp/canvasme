"use client";

import Konva from "konva";
import { memo, useEffect, useState } from "react";
import { Arrow, Ellipse, Group, Image, Line, Rect, Shape, Text } from "react-konva";
import { getReadyImage, loadAssetImage } from "@/lib/images";
import { elementAsset, type Element } from "@/lib/model";
import { noteImageReady, provideKonva } from "@/lib/fx/fxShape";
import { elementNodes, groupAttrs } from "@/lib/render";

// react-konva has loaded Konva already; the effects pipeline builds its off-screen nodes with it.
provideKonva(Konva);

const NODES = { Arrow, Ellipse, Image, Line, Rect, Shape, Text };

export function useAssetImage(id: string | undefined) {
  const [img, setImg] = useState(() => (id ? getReadyImage(id) : undefined));
  useEffect(() => {
    if (!id) return;
    let alive = true;
    loadAssetImage(id).then((i) => {
      if (!alive) return;
      if (i) noteImageReady();
      setImg(i ?? undefined);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return img;
}

type Props = {
  el: Element;
  editing: boolean;
  /** Locked itself or inside a locked group. */
  locked?: boolean;
  /** Bumped when web fonts finish loading; remounts text so Konva re-measures it. */
  fontsVersion: number;
  /** False while a drawing tool is active: elements must not drag under the pen. */
  interactive: boolean;
  register: (id: string, node: Konva.Group | null) => void;
  onPointerDown: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, el: Element) => void;
  onDblClick: (el: Element) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
};

function ElementNodeImpl({
  el,
  editing,
  locked,
  fontsVersion,
  interactive,
  register,
  onPointerDown,
  onDblClick,
  onDragStart,
  onDragMove,
  onDragEnd,
}: Props) {
  const img = useAssetImage(elementAsset(el));
  const attrs = groupAttrs(el);
  return (
    <Group
      ref={(n) => register(el.id, n)}
      id={el.id}
      {...attrs}
      opacity={editing ? 0 : attrs.opacity}
      draggable={interactive && !el.locked && !locked}
      onMouseDown={(e) => onPointerDown(e, el)}
      onTouchStart={(e) => onPointerDown(e, el)}
      onDblClick={() => onDblClick(el)}
      onDblTap={() => onDblClick(el)}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    >
      {elementNodes(el, img, { fontsVersion, live: true }).map((n, i) => {
        const C = NODES[n.kind] as unknown as React.ComponentType<Record<string, unknown>>;
        // Text (and the fx shape that draws text with effects) remounts when fonts load, to re-measure.
        const remount = n.kind === "Text" || (n.kind === "Shape" && el.type === "text");
        return <C key={remount ? `${i}-${fontsVersion}` : i} {...n.attrs} perfectDrawEnabled={false} />;
      })}
    </Group>
  );
}

export const ElementNode = memo(ElementNodeImpl);
