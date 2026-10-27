"use client";

import Konva from "konva";
import { create } from "zustand";
import { type AdjustmentElement, type Design, type Element, type Page, newPage, pageSize, uid } from "@/lib/model";
import { ADJUSTMENT_LABELS, type AdjustmentType, defaultAdjustment } from "@/lib/adjustments";
import { maskImage, unmaskImage } from "@/lib/mask";
import { migrateDesign } from "@/lib/migrate";
import { textAttrs } from "@/lib/render";
import { contextMeasure, hasRichStyle, layoutRichText } from "@/lib/richText";
import {
  clipIds,
  coveredElements,
  effectiveFlags,
  expandToLeaves,
  groupIds,
  leafIds,
  releaseClipIds,
  reorderTree,
  reparentTree,
  tidyTree,
  ungroupIds,
} from "@/lib/tree";

const HISTORY_LIMIT = 100;
const COALESCE_MS = 600;

let measurer: Konva.Text | null = null;
let richCtx: CanvasRenderingContext2D | null = null;

/** Keep derived geometry (text height, line height) consistent with props. */
export function normalize(el: Element): Element {
  if (el.type === "group") return el;
  if (el.type === "text") {
    if (hasRichStyle(el)) {
      richCtx ??= Konva.Util.createCanvasElement().getContext("2d");
      if (richCtx) return { ...el, height: Math.ceil(layoutRichText(el, contextMeasure(richCtx)).height) };
    }
    measurer ??= new Konva.Text();
    measurer.setAttrs({ ...textAttrs(el), height: undefined });
    return { ...el, height: Math.ceil(measurer.height()) };
  }
  if (el.type === "line") {
    return { ...el, height: Math.max(el.strokeWidth * (el.arrowEnd ? 3 : 1), 1) };
  }
  return el;
}

type Patch = Partial<Element> | ((el: Element) => Partial<Element>);

type MutateOpts = { history?: boolean; coalesce?: string };

export type EditorState = {
  design: Design | null;
  pageId: string;
  selected: string[];
  editingTextId: string | null;
  past: Design[];
  future: Design[];
  lastCommit: { key?: string; at: number };

  load: (d: Design) => void;
  mutate: (fn: (d: Design) => void, opts?: MutateOpts) => void;
  undo: () => void;
  redo: () => void;

  setPage: (id: string) => void;
  /**
   * Select elements; a group stands for its leaves. Normally an element brings every leaf of its
   * outermost group (canvas clicks); `deep` selects exactly the given elements (Layers rows,
   * Ctrl/Cmd-click).
   */
  select: (ids: string[], additive?: boolean, deep?: boolean) => void;
  setEditingText: (id: string | null) => void;

  addElement: (el: Element) => void;
  /**
   * Add an adjustment layer covering the page, directly above the selection's front-most element
   * (in its parent), or at the top of the page; selects it. Returns its id.
   */
  addAdjustment: (type: AdjustmentType) => string | null;
  update: (ids: string[], patch: Patch, opts?: MutateOpts) => void;
  updateMany: (patches: Record<string, Partial<Element>>, opts?: MutateOpts) => void;
  /** Leave copies of the elements where they are, directly beneath each original. */
  duplicateInPlace: (ids: string[]) => void;
  remove: (ids: string[]) => void;
  duplicate: (ids: string[]) => void;
  paste: (els: Element[]) => void;
  reorder: (ids: string[], dir: "up" | "down" | "top" | "bottom") => void;
  /** Move an element (a group with its contents) into `parentId` (null = page) at `index` among its children, bottom first. */
  reparent: (id: string, parentId: string | null, index: number) => void;
  /** Put the selection in a new group, inside the selection's common parent. */
  group: (ids: string[]) => void;
  /** Dissolve the groups the selection wholly covers, one level. */
  ungroup: (ids: string[]) => void;
  /** Clip the selection to the layer below it (Photoshop clipping); see tree.ts `clipIds`. */
  clipToBelow: (ids: string[]) => void;
  /** Release the selection's clipping (and the clipped layers above it in its stack). */
  releaseClip: (ids: string[]) => void;
  /** Clip the selection to the layer below, or release it when there is nothing to clip. */
  toggleClip: (ids: string[]) => void;
  /** Clip an image to a shape's outline; the pair becomes one element with the image's id. */
  clipToShape: (imageId: string, shapeId: string) => void;
  /** Give back the shape and the image of a masked image. */
  releaseMask: (id: string) => void;

  addPage: () => void;
  duplicatePage: (id: string) => void;
  deletePage: (id: string) => void;
  movePage: (id: string, dir: -1 | 1) => void;
};

export const currentPage = (s: EditorState): Page | undefined =>
  s.design?.pages.find((p) => p.id === s.pageId);

/** Ids of elements that can't be edited: locked themselves or inside a locked group. */
export function lockedIds(els: Element[]) {
  const out = new Set<string>();
  for (const [id, f] of effectiveFlags(els)) if (f.locked) out.add(id);
  return out;
}

/**
 * Copies with fresh ids. Group elements among `els` are copied too and their members point at
 * the copy; a member whose group isn't among `els` stays in that group.
 */
function cloneWithNewIds(els: Element[], offset: number): Element[] {
  const ids = new Map(els.map((e) => [e.id, uid()]));
  return els.map((e) => {
    const groupId = (e.groupId && ids.get(e.groupId)) ?? e.groupId ?? null;
    const copy = { ...structuredClone(e), id: ids.get(e.id)!, groupId, x: e.x + offset, y: e.y + offset };
    // The shape kept inside a mask comes back out on release, so it needs its own id too.
    if (copy.type === "image" && copy.mask) copy.mask.shape.id = uid();
    return copy;
  });
}

/**
 * `to` with the groups' `collapsed` flags of `from`. Folding a group in the Layers panel isn't an
 * undo step, so undo and redo keep the panel as it is now instead of restoring an old fold.
 */
function keepCollapsed(to: Design, from: Design): Design {
  const folded = new Map<string, boolean>();
  for (const p of from.pages) for (const e of p.elements) if (e.type === "group") folded.set(e.id, !!e.collapsed);
  let changed = false;
  const pages = to.pages.map((p) => {
    let els: Element[] | null = null;
    p.elements.forEach((e, i) => {
      const want = folded.get(e.id);
      if (e.type !== "group" || want === undefined || want === !!e.collapsed) return;
      els ??= p.elements.slice();
      els[i] = { ...e, collapsed: want || undefined };
    });
    if (!els) return p;
    changed = true;
    return { ...p, elements: els };
  });
  return changed ? { ...to, pages } : to;
}

export const useEditor = create<EditorState>((set, get) => {
  /** Replace the current page's elements with `fn`'s list; nothing is committed when it returns the same list. */
  const editElements = (fn: (els: Element[], locked: Set<string>) => Element[]) => {
    const page = currentPage(get());
    if (!page) return;
    const next = fn(page.elements, lockedIds(page.elements));
    if (next === page.elements) return;
    get().mutate((d) => {
      const pg = d.pages.find((p) => p.id === page.id);
      if (pg) pg.elements = structuredClone(next);
    });
  };
  const unlocked = (ids: string[], locked: Set<string>) => ids.filter((id) => !locked.has(id));

  return {
    design: null,
    pageId: "",
    selected: [],
    editingTextId: null,
    past: [],
    future: [],
    lastCommit: { at: 0 },

    load: (raw) => {
      const d = migrateDesign(raw) as Design;
      set({
        design: { ...d, pages: d.pages.map((p) => ({ ...p, elements: tidyTree(p.elements.map(normalize)) })) },
        pageId: d.pages[0].id,
        selected: [],
        editingTextId: null,
        past: [],
        future: [],
      });
    },

    mutate: (fn, opts = {}) => {
      const { design, past, lastCommit } = get();
      if (!design) return;
      const next = structuredClone(design);
      fn(next);
      // Keep every page's groups well formed: members contiguous below their group, no empty
      // groups, group boxes the union of their members.
      for (const p of next.pages) p.elements = tidyTree(p.elements);
      next.updatedAt = Date.now();
      const now = Date.now();
      const merge = opts.coalesce && lastCommit.key === opts.coalesce && now - lastCommit.at < COALESCE_MS;
      if (opts.history === false || merge) {
        set({ design: next, lastCommit: { key: opts.coalesce ?? lastCommit.key, at: now } });
        return;
      }
      set({
        design: next,
        past: [...past, design].slice(-HISTORY_LIMIT),
        future: [],
        lastCommit: { key: opts.coalesce, at: now },
      });
    },

    undo: () => {
      const { past, design, future, pageId } = get();
      if (!past.length || !design) return;
      const prev = keepCollapsed(past[past.length - 1], design);
      set({
        design: prev,
        past: past.slice(0, -1),
        future: [design, ...future],
        selected: [],
        lastCommit: { at: 0 },
        pageId: prev.pages.some((p) => p.id === pageId) ? pageId : prev.pages[0].id,
      });
    },

    redo: () => {
      const { past, design, future, pageId } = get();
      if (!future.length || !design) return;
      const next = keepCollapsed(future[0], design);
      set({
        design: next,
        past: [...past, design],
        future: future.slice(1),
        selected: [],
        lastCommit: { at: 0 },
        pageId: next.pages.some((p) => p.id === pageId) ? pageId : next.pages[0].id,
      });
    },

    setPage: (id) => set({ pageId: id, selected: [], editingTextId: null }),

    select: (ids, additive, deep) => {
      const els = currentPage(get())?.elements ?? [];
      const picked = deep ? leafIds(els, ids) : expandToLeaves(els, ids);
      set({ selected: additive ? leafIds(els, [...get().selected, ...picked]) : picked });
    },

    setEditingText: (id) => set({ editingTextId: id }),

    addElement: (el) => {
      get().mutate((d) => {
        const page = d.pages.find((p) => p.id === get().pageId);
        if (!page) return;
        // Cascade inserts so repeated adds don't stack exactly on top of each other.
        const placed = { ...el };
        while (page.elements.some((o) => Math.abs(o.x - placed.x) < 1 && Math.abs(o.y - placed.y) < 1)) {
          placed.x += 24;
          placed.y += 24;
        }
        page.elements.push(normalize(placed));
      });
      set({ selected: [el.id] });
    },

    addAdjustment: (type) => {
      const { design, pageId, selected } = get();
      const page = design?.pages.find((p) => p.id === pageId);
      if (!design || !page) return null;
      const { width, height } = pageSize(design, page);
      const el: AdjustmentElement = {
        id: uid(),
        name: ADJUSTMENT_LABELS[type],
        type: "adjustment",
        adjustment: defaultAdjustment(type),
        x: 0,
        y: 0,
        width,
        height,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        groupId: null,
      };
      get().mutate((d) => {
        const pg = d.pages.find((p) => p.id === pageId);
        if (!pg) return;
        let at = -1;
        pg.elements.forEach((e, i) => {
          if (selected.includes(e.id)) at = i;
        });
        if (at < 0) {
          pg.elements.push(el);
          return;
        }
        pg.elements.splice(at + 1, 0, { ...el, groupId: pg.elements[at].groupId ?? null });
      });
      set({ selected: [el.id] });
      return el.id;
    },

    update: (ids, patch, opts) =>
      get().mutate((d) => {
        const page = d.pages.find((p) => p.id === get().pageId);
        if (!page) return;
        page.elements = page.elements.map((e) => {
          if (!ids.includes(e.id)) return e;
          const p = typeof patch === "function" ? patch(e) : patch;
          return normalize({ ...e, ...p } as Element);
        });
      }, opts),

    updateMany: (patches, opts) =>
      get().mutate((d) => {
        const page = d.pages.find((p) => p.id === get().pageId);
        if (!page) return;
        page.elements = page.elements.map((e) => (patches[e.id] ? normalize({ ...e, ...patches[e.id] } as Element) : e));
      }, opts),

    duplicateInPlace: (ids) =>
      get().mutate((d) => {
        const page = d.pages.find((p) => p.id === get().pageId);
        if (!page) return;
        const locked = lockedIds(page.elements);
        const originals = coveredElements(page.elements, ids).filter((e) => !locked.has(e.id));
        const copies = new Map(cloneWithNewIds(originals, 0).map((c, i) => [originals[i].id, c]));
        page.elements = page.elements.flatMap((e) => (copies.has(e.id) ? [copies.get(e.id)!, e] : [e]));
      }),

    remove: (ids) => {
      get().mutate((d) => {
        const page = d.pages.find((p) => p.id === get().pageId);
        if (!page) return;
        const locked = lockedIds(page.elements);
        const gone = new Set(leafIds(page.elements, ids).filter((id) => !locked.has(id)));
        page.elements = page.elements.filter((e) => !gone.has(e.id));
      });
      set({ selected: [] });
    },

    duplicate: (ids) => {
      const page = currentPage(get());
      if (!page) return;
      get().paste(coveredElements(page.elements, ids));
    },

    paste: (els) => {
      if (!els.length) return;
      const copies = cloneWithNewIds(els, 20);
      get().mutate((d) => {
        const page = d.pages.find((p) => p.id === get().pageId);
        if (!page) return;
        // A copy whose group is locked (or inside a locked one) lands at the page instead.
        const locked = lockedIds(page.elements);
        page.elements.push(...copies.map((c) => ({ ...c, locked: false, groupId: c.groupId && locked.has(c.groupId) ? null : c.groupId })));
      });
      set({ selected: copies.filter((c) => c.type !== "group").map((c) => c.id) });
    },

    reorder: (ids, dir) => editElements((els, locked) => reorderTree(els, unlocked(ids, locked), dir)),

    // Nothing moves into, out of or within a locked group (a locked element is one inside it too).
    reparent: (id, parentId, index) =>
      editElements((els, locked) => (locked.has(id) || (parentId && locked.has(parentId)) ? els : reparentTree(els, id, parentId, index))),

    group: (ids) =>
      editElements((els, locked) => {
        const free = unlocked(ids, locked);
        return leafIds(els, free).length < 2 ? els : groupIds(els, free, uid()).els;
      }),

    ungroup: (ids) => editElements((els, locked) => ungroupIds(els, unlocked(ids, locked))),

    clipToBelow: (ids) => editElements((els, locked) => clipIds(els, unlocked(ids, locked))),

    releaseClip: (ids) => editElements((els, locked) => releaseClipIds(els, unlocked(ids, locked))),

    toggleClip: (ids) =>
      editElements((els, locked) => {
        const free = unlocked(ids, locked);
        const clipped = clipIds(els, free);
        return clipped !== els ? clipped : releaseClipIds(els, free);
      }),

    clipToShape: (imageId, shapeId) => {
      let done = false;
      get().mutate((d) => {
        const page = d.pages.find((p) => p.id === get().pageId);
        const img = page?.elements.find((e) => e.id === imageId);
        const shape = page?.elements.find((e) => e.id === shapeId);
        if (!page || img?.type !== "image" || img.mask || shape?.type !== "shape") return;
        const locked = lockedIds(page.elements);
        if (locked.has(imageId) || locked.has(shapeId)) return;
        const iImg = page.elements.indexOf(img);
        const iShape = page.elements.indexOf(shape);
        // The masked image takes the shape's place in the layer order.
        page.elements[iShape] = maskImage(img, shape, iShape > iImg);
        page.elements.splice(iImg, 1);
        done = true;
      });
      if (done) set({ selected: [imageId] });
    },

    releaseMask: (id) => {
      let out: string[] = [];
      get().mutate((d) => {
        const page = d.pages.find((p) => p.id === get().pageId);
        const el = page?.elements.find((e) => e.id === id);
        if (!page || el?.type !== "image" || lockedIds(page.elements).has(id)) return;
        const parts = unmaskImage(el);
        if (!parts) return;
        const { shape, image } = parts;
        if (page.elements.some((e) => e.id === shape.id)) shape.id = uid();
        page.elements.splice(page.elements.indexOf(el), 1, ...(el.mask!.shapeAbove ? [image, shape] : [shape, image]));
        out = [shape.id, image.id];
      });
      if (out.length) set({ selected: out });
    },

    addPage: () => {
      // A new page takes the current page's own size (artboards), if it has one.
      const cur = currentPage(get());
      const page: Page = { ...newPage(), ...(cur?.width && cur.height ? { width: cur.width, height: cur.height } : {}) };
      get().mutate((d) => {
        const i = d.pages.findIndex((p) => p.id === get().pageId);
        d.pages.splice(i + 1, 0, page);
      });
      get().setPage(page.id);
    },

    duplicatePage: (id) => {
      const src = get().design?.pages.find((p) => p.id === id);
      if (!src) return;
      const copy: Page = {
        id: uid(),
        background: src.background,
        elements: cloneWithNewIds(src.elements, 0),
        ...(src.width && src.height ? { width: src.width, height: src.height } : {}),
      };
      get().mutate((d) => {
        const i = d.pages.findIndex((p) => p.id === id);
        d.pages.splice(i + 1, 0, copy);
      });
      get().setPage(copy.id);
    },

    deletePage: (id) => {
      const d = get().design;
      if (!d || d.pages.length <= 1) return;
      const i = d.pages.findIndex((p) => p.id === id);
      get().mutate((dd) => {
        dd.pages = dd.pages.filter((p) => p.id !== id);
      });
      const pages = get().design!.pages;
      get().setPage(pages[Math.min(i, pages.length - 1)].id);
    },

    movePage: (id, dir) =>
      get().mutate((d) => {
        const i = d.pages.findIndex((p) => p.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= d.pages.length) return;
        [d.pages[i], d.pages[j]] = [d.pages[j], d.pages[i]];
      }),
  };
});
