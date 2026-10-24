"use client";

import type Konva from "konva";
import { memo, useEffect, useState } from "react";
import { Arrow, Ellipse, Group, Image, Line, Rect, Text } from "react-konva";
import { getReadyImage, loadAssetImage } from "@/lib/images";
import type { Element } from "@/lib/model";
import { elementNodes, groupAttrs } from "@/lib/render";

const NODES = { Arrow, Ellipse, Image, Line, Rect, Text };

function useAssetImage(id: string | undefined) {
  const [img, setImg] = useState(() => (id ? getReadyImage(id) : undefined));
  useEffect(() => {
    if (!id) return;
    let alive = true;
    loadAssetImage(id).then((i) => alive && setImg(i ?? undefined));
    return () => {
      alive = false;
    };
  }, [id]);
  return img;
}

type Props = {
  el: Element;
  editing: boolean;
  /** Bumped when web fonts finish loading; remounts text so Konva re-measures it. */
  fontsVersion: number;
  register: (id: string, node: Konva.Group | null) => void;
  onPointerDown: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, el: Element) => void;
  onDblClick: (el: Element) => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
};

function ElementNodeImpl({ el, editing, fontsVersion, register, onPointerDown, onDblClick, onDragMove, onDragEnd }: Props) {
  const img = useAssetImage(el.type === "image" ? el.assetId : undefined);
  const attrs = groupAttrs(el);
  return (
    <Group
      ref={(n) => register(el.id, n)}
      id={el.id}
      {...attrs}
      opacity={editing ? 0 : attrs.opacity}
      draggable={!el.locked}
      onMouseDown={(e) => onPointerDown(e, el)}
      onTouchStart={(e) => onPointerDown(e, el)}
      onDblClick={() => onDblClick(el)}
      onDblTap={() => onDblClick(el)}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    >
      {elementNodes(el, img).map((n, i) => {
        const C = NODES[n.kind] as unknown as React.ComponentType<Record<string, unknown>>;
        return <C key={n.kind === "Text" ? `${i}-${fontsVersion}` : i} {...n.attrs} perfectDrawEnabled={false} />;
      })}
    </Group>
  );
}

export const ElementNode = memo(ElementNodeImpl);
