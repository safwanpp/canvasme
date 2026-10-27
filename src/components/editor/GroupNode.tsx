"use client";

import Konva from "konva";
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Arrow, Ellipse, Group, Image, Line, Rect, Shape, Text } from "react-konva";
import { provideKonva } from "@/lib/fx/fxShape";
import { clipDrawFor, groupDrawFor, setClipDraw, setGroupDraw } from "@/lib/fx/groupDraw";
import { elementAsset, type Element, type GroupElement } from "@/lib/model";
import { clipGhosts } from "@/lib/render";
import { clipStacks, type ClipStack, type RenderNode } from "@/lib/tree";
import { ElementNode, useAssetImage } from "./ElementNode";

provideKonva(Konva);

/** What every node of the page tree needs from the canvas. */
export type TreeProps = {
  /** Elements drawn by an editor overlay instead (text being typed, crop, erase). */
  editingIds: ReadonlySet<string>;
  /** Locked themselves or inside a locked group. */
  lockedIds: ReadonlySet<string>;
  fontsVersion: number;
  interactive: boolean;
  register: (id: string, node: Konva.Group | null) => void;
  onPointerDown: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, el: Element) => void;
  onDblClick: (el: Element) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
};

/**
 * The page's elements: leaves as ElementNodes, groups as GroupNodes holding their members, and a
 * layer with clipped layers above it as a ClipStackNode holding them all.
 */
export function LayerTree({ nodes, ...p }: TreeProps & { nodes: RenderNode[] }) {
  // Stable stacks while the tree is, so the memoized stack nodes skip unrelated renders.
  const stacks = useMemo(() => clipStacks(nodes), [nodes]);
  return (
    <>
      {stacks.map((s) =>
        s.clipped.length ? <ClipStackNode key={`clip:${s.node.el.id}`} stack={s} {...p} /> : <TreeNode key={s.node.el.id} node={s.node} {...p} />,
      )}
    </>
  );
}

/** One node of the tree on its own. */
function TreeNode({ node: n, ...p }: TreeProps & { node: RenderNode }) {
  return n.el.type === "group" ? (
    <GroupNode node={n} {...p} />
  ) : (
    <ElementNode
      el={n.el}
      editing={p.editingIds.has(n.el.id)}
      locked={p.lockedIds.has(n.el.id)}
      fontsVersion={p.fontsVersion}
      interactive={p.interactive}
      register={p.register}
      onPointerDown={p.onPointerDown}
      onDblClick={p.onDblClick}
      onDragStart={p.onDragStart}
      onDragMove={p.onDragMove}
      onDragEnd={p.onDragEnd}
    />
  );
}

const NO_NODES: RenderNode[] = [];

const SPEC_NODES = { Arrow, Ellipse, Image, Line, Rect, Shape, Text };

/** A leaf base's ghosts (outer effects, body, content alpha), drawn by the stack only. */
function ClipGhostsImpl({ el, fontsVersion }: { el: Element; fontsVersion: number }) {
  const img = useAssetImage(elementAsset(el));
  const ghosts = useMemo(() => clipGhosts(el, img, { fontsVersion, live: true }), [el, img, fontsVersion]);
  return (
    <>
      {ghosts.map((g) => (
        <Group key={g.name} name={g.name} opacity={g.opacity} listening={false}>
          {g.nodes.map((n, i) => {
            const C = SPEC_NODES[n.kind] as unknown as React.ComponentType<Record<string, unknown>>;
            const remount = n.kind === "Text" || (n.kind === "Shape" && el.type === "text");
            return <C key={remount ? `${i}-${fontsVersion}` : i} {...n.attrs} perfectDrawEnabled={false} />;
          })}
        </Group>
      ))}
    </>
  );
}

const ClipGhosts = memo(ClipGhostsImpl);

/**
 * A clip stack: the base's own node (hits, dragging, the transformer), its ghosts and the clipped
 * layers' nodes in one Konva Group at the page origin, drawn by fx/groupDraw.ts `setClipDraw`.
 */
function ClipStackNodeImpl({ stack, ...p }: TreeProps & { stack: ClipStack }) {
  const base = stack.node.el;
  const ref = useRef<Konva.Group | null>(null);
  const editing = p.editingIds.has(base.id);
  const cfg = useMemo(() => clipDrawFor(base, members(stack.node), { editing }), [base, stack.node, editing]);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const attach = useCallback((n: Konva.Group | null) => {
    ref.current = n;
    if (n) setClipDraw(n, cfgRef.current);
  }, []);
  useLayoutEffect(() => {
    const n = ref.current;
    if (!n) return;
    setClipDraw(n, cfg);
    n.getLayer()?.batchDraw();
  }, [cfg]);
  return (
    <Group ref={attach} name="cm-clip" visible={!base.hidden}>
      <TreeNode node={stack.node} {...p} />
      {base.type !== "group" && <ClipGhosts el={base} fontsVersion={p.fontsVersion} />}
      {stack.clipped.map((c) => (
        <TreeNode key={c.el.id} node={c} {...p} />
      ))}
    </Group>
  );
}

const ClipStackNode = memo(ClipStackNodeImpl);

function members(n: RenderNode, out: Element[] = []) {
  for (const c of n.children ?? []) {
    out.push(c.el);
    members(c, out);
  }
  return out;
}

/**
 * A group: a Konva Group at the page origin holding its members, so their own positions,
 * dragging and the transformer work unchanged. Isolation (opacity, blend, effects) happens in
 * the group's draw (fx/groupDraw.ts); hit testing still reaches the members.
 */
function GroupNodeImpl({ node, ...p }: TreeProps & { node: RenderNode }) {
  const el = node.el as GroupElement;
  const ref = useRef<Konva.Group | null>(null);
  const { fontsVersion } = p;
  // The tree is rebuilt when the page changes, so this (and its hash of the members) runs once per edit.
  const cfg = useMemo(() => groupDrawFor(el, members(node), { live: true, fontsVersion }), [el, node, fontsVersion]);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const attach = useCallback((n: Konva.Group | null) => {
    ref.current = n;
    if (n) setGroupDraw(n, cfgRef.current);
  }, []);
  useLayoutEffect(() => {
    const n = ref.current;
    if (!n) return;
    setGroupDraw(n, cfg);
    n.getLayer()?.batchDraw();
  }, [cfg]);
  return (
    <Group ref={attach} id={el.id} name="cm-group" visible={!el.hidden}>
      <LayerTree nodes={node.children ?? NO_NODES} {...p} />
    </Group>
  );
}

export const GroupNode = memo(GroupNodeImpl);
