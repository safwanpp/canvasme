import type { Element, GroupElement } from "./model";

// Groups live in the page's flat element list (bottom first). An element's `groupId` is its parent
// group's id, and a group element sits directly above its descendants, which are contiguous:
//
//   [a, b(G), c(H), d(H), H(G), G, e]   is   a, G{ b, H{ c, d } }, e
//
// Edits that move things between levels go through a small forest built from the list and are
// flattened back, so the list always comes out in that shape.

export type RenderNode = { el: Element; children?: RenderNode[] };

export const isGroup = (el: Element | undefined): el is GroupElement => el?.type === "group";

/** A new, empty group element; its box is filled in by syncGroupBounds once it has members. */
export function makeGroup(id: string, groupId: string | null, name = "Group"): GroupElement {
  return { id, type: "group", name, x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1, locked: false, hidden: false, groupId };
}

const byIdOf = (els: Element[]) => new Map(els.map((e) => [e.id, e]));

/**
 * The deepest nesting kept: a group deeper than this starts at the page instead. It keeps the
 * tree walks (and the editor's nested Konva groups) far from the call stack's limit.
 */
export const MAX_DEPTH = 200;

type Parents = Map<string, string | null>;

/**
 * A value per element that depends on its parent's value, worked out without recursion: walk up
 * to the first element that has one (or the page), then fill in the path top down.
 */
function upward<T>(parent: Parents, memo: Map<string, T>, id: string, f: (id: string, up: T | undefined) => T): T {
  const path: string[] = [];
  let cur: string | null = id;
  while (cur !== null && !memo.has(cur)) {
    path.push(cur);
    cur = parent.get(cur) ?? null;
  }
  let up = cur === null ? undefined : memo.get(cur);
  for (let i = path.length - 1; i >= 0; i--) {
    up = f(path[i], up);
    memo.set(path[i], up);
  }
  return memo.get(id)!;
}

/** Each element's valid parent group id: dangling, self and cyclic references become null, and nesting is capped at MAX_DEPTH. */
function parentsOf(els: Element[]): Parents {
  const byId = byIdOf(els);
  const parent = new Map<string, string | null>();
  for (const e of els) {
    const p = e.groupId ?? null;
    parent.set(e.id, p && p !== e.id && isGroup(byId.get(p)) ? p : null);
  }
  // Break cycles: walk each chain once; a group met twice on one walk loses its parent.
  const done = new Set<string>();
  for (const e of els) {
    const path = new Set<string>();
    let id: string | null = e.id;
    while (id && !done.has(id)) {
      if (path.has(id)) {
        parent.set(id, null);
        break;
      }
      path.add(id);
      id = parent.get(id) ?? null;
    }
    for (const p of path) done.add(p);
  }
  // Cap the depth: the outermost levels stay, a group past the limit moves to the page.
  const depth = new Map<string, number>();
  for (const e of els) {
    upward(parent, depth, e.id, (id, up) => {
      if (up === undefined) return 0;
      if (up < MAX_DEPTH) return up + 1;
      parent.set(id, null);
      return 0;
    });
  }
  return parent;
}

/** Ancestor ids, nearest first, from a parent map. */
function chainOf(parent: Parents, id: string): string[] {
  const out: string[] = [];
  for (let p = parent.get(id) ?? null; p !== null; p = parent.get(p) ?? null) out.push(p);
  return out;
}

/** The forest the list describes; siblings keep their list order, and a group block goes where its element is. */
function forest(els: Element[]): RenderNode[] {
  const parent = parentsOf(els);
  const nodes = new Map<string, RenderNode>();
  for (const e of els) nodes.set(e.id, isGroup(e) ? { el: e, children: [] } : { el: e });
  const roots: RenderNode[] = [];
  for (const e of els) {
    const p = parent.get(e.id);
    (p ? nodes.get(p)!.children! : roots).push(nodes.get(e.id)!);
  }
  return roots;
}

/** Whether a node has a leaf somewhere under it (groups without one are dropped). */
function hasLeaf(n: RenderNode): boolean {
  return !n.children || n.children.some(hasLeaf);
}

/**
 * The list for a forest: each group above its members, empty groups left out, groupIds from the
 * structure, and the bottom element of each parent unclipped (it has nothing to clip to).
 */
function flatten(roots: RenderNode[]): Element[] {
  const out: Element[] = [];
  const walk = (list: RenderNode[], parentId: string | null) => {
    let bottom = true;
    for (const n of list) {
      if (!hasLeaf(n)) continue;
      if (n.children) walk(n.children, n.el.id);
      let el = (n.el.groupId ?? null) === parentId ? n.el : { ...n.el, groupId: parentId };
      if (bottom && el.clipped !== undefined) {
        el = { ...el };
        delete el.clipped;
      }
      bottom = false;
      out.push(el);
    }
  };
  walk(roots, null);
  return out;
}

const sameList = (a: Element[], b: Element[]) => a.length === b.length && a.every((e, i) => e === b[i]);

/** Repair the list's tree shape. Returns the same array when nothing needed fixing. */
export function normalizeTree(els: Element[]): Element[] {
  const out = flatten(forest(els));
  return sameList(out, els) ? els : out;
}

/** The page as nested nodes, bottom first, for rendering. Empty groups are left out. */
export function buildRenderTree(els: Element[]): RenderNode[] {
  const prune = (list: RenderNode[]): RenderNode[] =>
    list.filter(hasLeaf).map((n) => (n.children ? { el: n.el, children: prune(n.children) } : n));
  return prune(forest(els));
}

/** Ancestor group ids, nearest first. */
export function parentChain(els: Element[], id: string): string[] {
  return chainOf(parentsOf(els), id);
}

const outermostIn = (parent: Parents, id: string) => {
  const chain = chainOf(parent, id);
  return chain.length ? chain[chain.length - 1] : null;
};

export const outermostGroup = (els: Element[], id: string): string | null => outermostIn(parentsOf(els), id);

/** Whether each element is `ids` or inside one of them. */
function insideOf(els: Element[], ids: Iterable<string>, parent = parentsOf(els)) {
  const want = new Set(ids);
  const memo = new Map<string, boolean>();
  return (id: string): boolean => upward(parent, memo, id, (i, up) => want.has(i) || !!up);
}

/** Everything inside a group (not the group itself), in list order. */
export function descendants(els: Element[], groupId: string): Element[] {
  const inside = insideOf(els, [groupId]);
  return els.filter((e) => e.id !== groupId && inside(e.id));
}

/** The non-group elements among `ids` and inside the groups among them, in list order. */
export function leafIds(els: Element[], ids: Iterable<string>, parent = parentsOf(els)): string[] {
  const inside = insideOf(els, ids, parent);
  return els.filter((e) => !isGroup(e) && inside(e.id)).map((e) => e.id);
}

/** Selection on the canvas: an element brings every leaf of its outermost group. */
export function expandToLeaves(els: Element[], ids: string[]): string[] {
  const parent = parentsOf(els);
  return leafIds(els, ids.map((id) => outermostIn(parent, id) ?? id), parent);
}

/** Hidden and locked including the ancestors' (a hidden group hides its members). */
export function effectiveFlags(els: Element[]): Map<string, { hidden: boolean; locked: boolean }> {
  const byId = byIdOf(els);
  const parent = parentsOf(els);
  const out = new Map<string, { hidden: boolean; locked: boolean }>();
  for (const e of els) {
    upward(parent, out, e.id, (id, up) => {
      const el = byId.get(id)!;
      return { hidden: !!el.hidden || !!up?.hidden, locked: !!el.locked || !!up?.locked };
    });
  }
  return out;
}

/**
 * The groups whose leaves are exactly the selection, outermost first: more than one when a group
 * holds nothing but another group. Their own opacity, blend and effects are what the toolbar's
 * Group scope edits.
 */
export function selectedGroups(els: Element[], selected: string[]): GroupElement[] {
  if (!selected.length) return [];
  const want = new Set(selected);
  const parent = parentsOf(els);
  const chain = chainOf(parent, selected[0]);
  if (!chain.length) return [];
  // Per leaf, the nearest group of the chain it is in (chain index; groups further out hold it too).
  const at = new Map(chain.map((g, i) => [g, i]));
  const memo = new Map<string, number>();
  const nearest = (id: string) => upward(parent, memo, id, (i, up) => at.get(i) ?? up ?? -1);
  const leaves = new Array<number>(chain.length).fill(0);
  const wanted = new Array<number>(chain.length).fill(0);
  for (const e of els) {
    if (isGroup(e)) continue;
    const i = nearest(e.id);
    if (i < 0) continue;
    leaves[i]++;
    if (want.has(e.id)) wanted[i]++;
  }
  // From the outermost group in: a group's counts are its own plus every nearer one's.
  let nLeaves = leaves.reduce((x, y) => x + y, 0);
  let nWanted = wanted.reduce((x, y) => x + y, 0);
  const byId = byIdOf(els);
  const out: GroupElement[] = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    if (nLeaves === want.size && nWanted === want.size) out.push(byId.get(chain[i]) as GroupElement);
    nLeaves -= leaves[i];
    nWanted -= wanted[i];
  }
  return out;
}

/** The outermost of `selectedGroups`. */
export const selectedGroup = (els: Element[], selected: string[]): GroupElement | null => selectedGroups(els, selected)[0] ?? null;

/** Index every node with the sibling list it sits in. */
function indexForest(roots: RenderNode[]) {
  const where = new Map<string, { node: RenderNode; list: RenderNode[]; parent: RenderNode | null }>();
  const walk = (list: RenderNode[], parent: RenderNode | null) => {
    for (const n of list) {
      where.set(n.el.id, { node: n, list, parent });
      if (n.children) walk(n.children, n);
    }
  };
  walk(roots, null);
  return where;
}

/**
 * What a selection moves as: the largest wholly selected subtrees (a group whose leaves are all
 * selected moves as one block), in list order.
 */
function unitsOf(roots: RenderNode[], ids: Iterable<string>): RenderNode[] {
  const want = new Set(ids);
  const full = new Map<RenderNode, boolean>();
  const isFull = (n: RenderNode): boolean => {
    let v = full.get(n);
    if (v === undefined) {
      v = want.has(n.el.id) || (!!n.children && n.children.some(hasLeaf) && n.children.filter(hasLeaf).every(isFull));
      full.set(n, v);
    }
    return v;
  };
  const out: RenderNode[] = [];
  const walk = (list: RenderNode[]) => {
    for (const n of list) {
      if (isFull(n)) out.push(n);
      else if (n.children) walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/** Move the selection within its parents: one step, or to the top or bottom of the parent. */
export function reorderTree(els: Element[], ids: string[], dir: "up" | "down" | "top" | "bottom"): Element[] {
  const roots = forest(els);
  const units = new Set(unitsOf(roots, ids));
  const lists = new Set<RenderNode[]>();
  const where = indexForest(roots);
  for (const u of units) lists.add(where.get(u.el.id)!.list);
  for (const list of lists) {
    const moving = list.filter((n) => units.has(n));
    const rest = list.filter((n) => !units.has(n));
    if (dir === "top") list.splice(0, list.length, ...rest, ...moving);
    else if (dir === "bottom") list.splice(0, list.length, ...moving, ...rest);
    else if (dir === "up") {
      for (let i = list.length - 2; i >= 0; i--) {
        if (units.has(list[i]) && !units.has(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]];
      }
    } else {
      for (let i = 1; i < list.length; i++) {
        if (units.has(list[i]) && !units.has(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]];
      }
    }
  }
  const out = flatten(roots);
  return sameList(out, els) ? els : out;
}

/**
 * Move one element (with everything inside it) into `parentId` (null = the page) at `index`
 * among that parent's children, bottom first. Moving a group into itself is refused.
 */
export function reparentTree(els: Element[], id: string, parentId: string | null, index: number): Element[] {
  const roots = forest(els);
  const where = indexForest(roots);
  const it = where.get(id);
  if (!it) return els;
  if (parentId !== null) {
    const target = where.get(parentId);
    if (!target?.node.children) return els;
    for (let w: typeof target | undefined = target; w; w = w.parent ? where.get(w.parent.el.id) : undefined) if (w.node === it.node) return els;
  }
  it.list.splice(it.list.indexOf(it.node), 1);
  const list = parentId === null ? roots : where.get(parentId)!.node.children!;
  list.splice(Math.max(0, Math.min(index, list.length)), 0, it.node);
  const out = flatten(roots);
  return sameList(out, els) ? els : out;
}

/**
 * Put the selection in a new group `newId`, inside the selection's nearest common parent, where
 * its topmost part was. Returns the new list and the group id (null when there was nothing to group).
 */
export function groupIds(els: Element[], ids: string[], newId: string): { els: Element[]; id: string | null } {
  const roots = forest(els);
  const units = unitsOf(roots, ids);
  if (!units.length) return { els, id: null };
  const where = indexForest(roots);
  // The common parent: the deepest group every unit sits under.
  const parent = parentsOf(els);
  const chains = units.map((u) => new Set(chainOf(parent, u.el.id)));
  const lca = [...chains[0]].find((g) => chains.every((c) => c.has(g))) ?? null;
  const list = lca === null ? roots : where.get(lca)!.node.children!;
  // Each unit's ancestor (or itself) in that list; the group goes where the topmost of those is.
  const reps = units.map((u) => {
    let w = where.get(u.el.id)!;
    while ((w.parent?.el.id ?? null) !== lca) w = where.get(w.parent!.el.id)!;
    return w.node;
  });
  const top = Math.max(...reps.map((r) => list.indexOf(r)));
  const group: RenderNode = { el: makeGroup(newId, lca), children: [] };
  list.splice(top + 1, 0, group);
  for (const u of units) {
    const w = where.get(u.el.id)!;
    w.list.splice(w.list.indexOf(u), 1);
    group.children!.push(u);
  }
  return { els: flatten(roots), id: newId };
}

/** Dissolve the groups the selection wholly covers (one level): their members take their place. */
export function ungroupIds(els: Element[], ids: string[]): Element[] {
  const roots = forest(els);
  const groups = unitsOf(roots, ids).filter((u) => u.children);
  if (!groups.length) return els;
  const where = indexForest(roots);
  for (const g of groups) {
    const w = where.get(g.el.id)!;
    w.list.splice(w.list.indexOf(g), 1, ...g.children!);
  }
  return flatten(roots);
}

type Box = { x0: number; y0: number; x1: number; y1: number };

/** Page-space bounding box of an element's rotated box. */
function aabb(e: Element): Box {
  if (!e.rotation) return { x0: e.x, y0: e.y, x1: e.x + e.width, y1: e.y + e.height };
  const a = (e.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const xs = [0, e.width * cos, -e.height * sin, e.width * cos - e.height * sin];
  const ys = [0, e.width * sin, e.height * cos, e.width * sin + e.height * cos];
  return { x0: e.x + Math.min(...xs), y0: e.y + Math.min(...ys), x1: e.x + Math.max(...xs), y1: e.y + Math.max(...ys) };
}

/** Each group's box becomes the union of its members' boxes. Expects a normalized list. */
export function syncGroupBounds(els: Element[]): Element[] {
  const acc = new Map<string, Box>();
  let out: Element[] | null = null;
  els.forEach((e, i) => {
    let box: Box | undefined;
    if (isGroup(e)) {
      box = acc.get(e.id);
      if (box) {
        const next = { x: box.x0, y: box.y0, width: Math.max(box.x1 - box.x0, 1e-6), height: Math.max(box.y1 - box.y0, 0) };
        if (e.x !== next.x || e.y !== next.y || e.width !== next.width || e.height !== next.height || e.rotation) {
          out ??= els.slice();
          out[i] = { ...e, ...next, rotation: 0 };
        }
      }
    } else box = aabb(e);
    if (box && e.groupId) {
      const a = acc.get(e.groupId);
      acc.set(e.groupId, a ? { x0: Math.min(a.x0, box.x0), y0: Math.min(a.y0, box.y0), x1: Math.max(a.x1, box.x1), y1: Math.max(a.y1, box.y1) } : box);
    }
  });
  return out ?? els;
}

/** normalizeTree then syncGroupBounds: what the store keeps every page in. */
export const tidyTree = (els: Element[]) => syncGroupBounds(normalizeTree(els));

/**
 * The selection with the groups it wholly covers (and everything in them), in list order: what
 * copy and duplicate take, so a fully selected group comes along as a group.
 */
export function coveredElements(els: Element[], ids: string[]): Element[] {
  const keep = new Set<string>();
  const add = (n: RenderNode) => {
    keep.add(n.el.id);
    n.children?.forEach(add);
  };
  unitsOf(forest(els), leafIds(els, ids)).forEach(add);
  return els.filter((e) => keep.has(e.id));
}

/** A sibling and the clipped siblings directly above it (its clip stack; empty when none). */
export type ClipStack = { node: RenderNode; clipped: RenderNode[] };

/**
 * One level of the tree as clip stacks, bottom first: each clipped node joins the nearest
 * non-clipped sibling below it. A clipped node at the bottom (only in an unnormalized list)
 * stands on its own.
 */
export function clipStacks(nodes: RenderNode[]): ClipStack[] {
  const out: ClipStack[] = [];
  for (const n of nodes) {
    if (n.el.clipped && out.length) out[out.length - 1].clipped.push(n);
    else out.push({ node: n, clipped: [] });
  }
  return out;
}

/** The id of the element `id` is clipped to, or null when it isn't clipped. */
export function clipBase(els: Element[], id: string): string | null {
  const where = indexForest(forest(els));
  const it = where.get(id);
  if (!it?.node.el.clipped) return null;
  for (let i = it.list.indexOf(it.node) - 1; i >= 0; i--) {
    if (!hasLeaf(it.list[i])) continue;
    if (!it.list[i].el.clipped) return it.list[i].el.id;
  }
  return null;
}

/** `els` with `clipped` set or cleared on the given ids; the same array when nothing changes. */
function withClipped(els: Element[], on: Set<string>, off: Set<string>): Element[] {
  let out: Element[] | null = null;
  els.forEach((e, i) => {
    let next: Element | null = null;
    if (on.has(e.id) && !e.clipped) next = { ...e, clipped: true };
    else if (off.has(e.id) && e.clipped !== undefined) {
      next = { ...e };
      delete next.clipped;
    }
    if (!next) return;
    out ??= els.slice();
    out[i] = next;
  });
  return out ? normalizeTree(out) : els;
}

/**
 * Clip the selection to the layer below, like Photoshop's Create Clipping Mask: where one layer
 * (or wholly selected group) of a parent is selected it is clipped to the sibling below it; where
 * several are, all but the lowest are clipped to it. The bottom of a parent can't be clipped.
 */
export function clipIds(els: Element[], ids: string[]): Element[] {
  const roots = forest(els);
  const where = indexForest(roots);
  const byList = new Map<RenderNode[], RenderNode[]>();
  for (const u of unitsOf(roots, ids)) {
    const list = where.get(u.el.id)!.list;
    byList.set(list, [...(byList.get(list) ?? []), u]);
  }
  const on = new Set<string>();
  for (const [list, units] of byList) {
    const kept = list.filter(hasLeaf);
    const picked = units.length > 1 ? units.slice(1) : units;
    for (const u of picked) if (kept.indexOf(u) > 0) on.add(u.el.id);
  }
  return withClipped(els, on, new Set());
}

/**
 * Release the selection's clipping, like Photoshop's Release Clipping Mask: a released layer takes
 * the clipped layers above it in its stack along; releasing a base releases its whole stack.
 */
export function releaseClipIds(els: Element[], ids: string[]): Element[] {
  const roots = forest(els);
  const where = indexForest(roots);
  const off = new Set<string>();
  for (const u of unitsOf(roots, ids)) {
    const list = where.get(u.el.id)!.list.filter(hasLeaf);
    for (let i = list.indexOf(u) + 1; i < list.length && list[i].el.clipped; i++) off.add(list[i].el.id);
    if (u.el.clipped) off.add(u.el.id);
  }
  return withClipped(els, new Set(), off);
}

/**
 * Elements that don't show because the layer they are clipped to is hidden (Photoshop hides a
 * clip stack with its base), with the members of hidden clipped groups. The Layers panel dims them.
 */
export function clipHiddenIds(els: Element[]): Set<string> {
  const out = new Set<string>();
  const all = (n: RenderNode) => {
    out.add(n.el.id);
    for (const c of n.children ?? []) all(c);
  };
  const stack: RenderNode[][] = [buildRenderTree(els)];
  while (stack.length) {
    for (const s of clipStacks(stack.pop()!)) {
      if (s.node.el.hidden) s.clipped.forEach(all);
      for (const n of [s.node, ...s.clipped]) if (n.children) stack.push(n.children);
    }
  }
  return out;
}
