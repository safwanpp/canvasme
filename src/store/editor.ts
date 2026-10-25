"use client";

import Konva from "konva";
import { create } from "zustand";
import { type Design, type Element, type Page, newPage, uid } from "@/lib/model";
import { maskImage, unmaskImage } from "@/lib/mask";
import { textAttrs } from "@/lib/render";

const HISTORY_LIMIT = 100;
const COALESCE_MS = 600;

let measurer: Konva.Text | null = null;

/** Keep derived geometry (text height, line height) consistent with props. */
export function normalize(el: Element): Element {
  if (el.type === "text") {
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
  select: (ids: string[], additive?: boolean) => void;
  setEditingText: (id: string | null) => void;

  addElement: (el: Element) => void;
  update: (ids: string[], patch: Patch, opts?: MutateOpts) => void;
  updateMany: (patches: Record<string, Partial<Element>>, opts?: MutateOpts) => void;
  /** Leave copies of the elements where they are, directly beneath each original. */
  duplicateInPlace: (ids: string[]) => void;
  remove: (ids: string[]) => void;
  duplicate: (ids: string[]) => void;
  paste: (els: Element[]) => void;
  reorder: (ids: string[], dir: "up" | "down" | "top" | "bottom") => void;
  moveTo: (id: string, index: number) => void;
  group: (ids: string[]) => void;
  ungroup: (ids: string[]) => void;
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

/** Expand a selection so grouped elements are always selected together. */
function withGroups(page: Page | undefined, ids: string[]) {
  if (!page) return ids;
  const groups = new Set(page.elements.filter((e) => ids.includes(e.id) && e.groupId).map((e) => e.groupId));
  return page.elements.filter((e) => ids.includes(e.id) || (e.groupId && groups.has(e.groupId))).map((e) => e.id);
}

function cloneWithNewIds(els: Element[], offset: number): Element[] {
  const groupMap = new Map<string, string>();
  return els.map((e) => {
    let groupId = e.groupId;
    if (groupId) {
      if (!groupMap.has(groupId)) groupMap.set(groupId, uid());
      groupId = groupMap.get(groupId)!;
    }
    const copy = { ...structuredClone(e), id: uid(), groupId, x: e.x + offset, y: e.y + offset };
    // The shape kept inside a mask comes back out on release, so it needs its own id too.
    if (copy.type === "image" && copy.mask) copy.mask.shape.id = uid();
    return copy;
  });
}

export const useEditor = create<EditorState>((set, get) => ({
  design: null,
  pageId: "",
  selected: [],
  editingTextId: null,
  past: [],
  future: [],
  lastCommit: { at: 0 },

  load: (d) =>
    set({
      design: { ...d, pages: d.pages.map((p) => ({ ...p, elements: p.elements.map(normalize) })) },
      pageId: d.pages[0].id,
      selected: [],
      editingTextId: null,
      past: [],
      future: [],
    }),

  mutate: (fn, opts = {}) => {
    const { design, past, lastCommit } = get();
    if (!design) return;
    const next = structuredClone(design);
    fn(next);
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
    const prev = past[past.length - 1];
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
    const next = future[0];
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

  select: (ids, additive) => {
    const page = currentPage(get());
    const base = additive ? [...new Set([...get().selected, ...ids])] : ids;
    set({ selected: withGroups(page, base) });
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
      const originals = page.elements.filter((e) => ids.includes(e.id) && !e.locked);
      const copies = new Map(cloneWithNewIds(originals, 0).map((c, i) => [originals[i].id, c]));
      page.elements = page.elements.flatMap((e) => (copies.has(e.id) ? [copies.get(e.id)!, e] : [e]));
    }),

  remove: (ids) => {
    get().mutate((d) => {
      const page = d.pages.find((p) => p.id === get().pageId);
      if (page) page.elements = page.elements.filter((e) => !ids.includes(e.id) || e.locked);
    });
    set({ selected: [] });
  },

  duplicate: (ids) => {
    const page = currentPage(get());
    if (!page) return;
    get().paste(page.elements.filter((e) => ids.includes(e.id)));
  },

  paste: (els) => {
    if (!els.length) return;
    const copies = cloneWithNewIds(els, 20);
    get().mutate((d) => {
      d.pages.find((p) => p.id === get().pageId)?.elements.push(...copies.map((c) => ({ ...c, locked: false })));
    });
    set({ selected: copies.map((c) => c.id) });
  },

  reorder: (ids, dir) =>
    get().mutate((d) => {
      const page = d.pages.find((p) => p.id === get().pageId);
      if (!page) return;
      const moving = page.elements.filter((e) => ids.includes(e.id));
      const rest = page.elements.filter((e) => !ids.includes(e.id));
      if (dir === "top") page.elements = [...rest, ...moving];
      else if (dir === "bottom") page.elements = [...moving, ...rest];
      else {
        const els = page.elements;
        const idxs = els.map((e, i) => (ids.includes(e.id) ? i : -1)).filter((i) => i >= 0);
        if (dir === "up") {
          for (const i of idxs.reverse()) {
            if (i < els.length - 1 && !ids.includes(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]];
          }
        } else {
          for (const i of idxs) {
            if (i > 0 && !ids.includes(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
          }
        }
      }
    }),

  moveTo: (id, index) =>
    get().mutate((d) => {
      const page = d.pages.find((p) => p.id === get().pageId);
      if (!page) return;
      const from = page.elements.findIndex((e) => e.id === id);
      if (from < 0) return;
      const [el] = page.elements.splice(from, 1);
      page.elements.splice(Math.max(0, Math.min(index, page.elements.length)), 0, el);
    }),

  group: (ids) => {
    if (ids.length < 2) return;
    const gid = uid();
    get().update(ids, { groupId: gid });
  },

  ungroup: (ids) => get().update(ids, { groupId: null }),

  clipToShape: (imageId, shapeId) => {
    let done = false;
    get().mutate((d) => {
      const page = d.pages.find((p) => p.id === get().pageId);
      const img = page?.elements.find((e) => e.id === imageId);
      const shape = page?.elements.find((e) => e.id === shapeId);
      if (!page || img?.type !== "image" || img.mask || shape?.type !== "shape" || img.locked || shape.locked) return;
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
      if (!page || el?.type !== "image" || el.locked) return;
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
    const page = newPage();
    get().mutate((d) => {
      const i = d.pages.findIndex((p) => p.id === get().pageId);
      d.pages.splice(i + 1, 0, page);
    });
    get().setPage(page.id);
  },

  duplicatePage: (id) => {
    const src = get().design?.pages.find((p) => p.id === id);
    if (!src) return;
    const copy: Page = { id: uid(), background: src.background, elements: cloneWithNewIds(src.elements, 0) };
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
}));
