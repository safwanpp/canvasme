"use client";

import { create } from "zustand";
import type { BgProgress } from "@/lib/bgRemove";
import type { ShapeKind } from "@/lib/model";

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;

type SaveStatus = "saved" | "saving" | "error";

/** Canvas tools from the Tools strip. Everything but "select" turns pointer input into drawing or placing. */
export type Tool = "select" | "draw" | "eraser" | "shape" | "line" | "sticky" | "text";
export type PenKind = "pen" | "marker" | "highlighter";
export type Pen = { kind: PenKind; color: string; size: number };
/** Erase-mode brush. `size` is in screen pixels, `softness` 0..1 feathers the edge. */
export type EraseBrush = { size: number; softness: number; restore: boolean };
/** Background removal in progress (or failed) for one image element. */
export type BgJob = { elId: string; progress: BgProgress | null; error?: string };

type ViewState = {
  scale: number;
  x: number;
  y: number;
  container: { width: number; height: number };
  fitTick: number;
  spaceDown: boolean;
  saveStatus: SaveStatus;
  tool: Tool;
  pen: Pen;
  shapeKind: ShapeKind;
  bgJob: BgJob | null;
  /** Masked image whose picture is being moved or scaled inside its mask (double-click). */
  maskEditId: string | null;
  /** Image being cropped (double-click, or Crop in the toolbar). */
  cropEditId: string | null;
  /** Image being erased (Erase in the toolbar). */
  eraseEditId: string | null;
  eraseBrush: EraseBrush;
  set: (p: Partial<Omit<ViewState, "set" | "zoomAt" | "zoomTo" | "requestFit">>) => void;
  /** Zoom keeping the given screen point fixed. */
  zoomAt: (scale: number, px: number, py: number) => void;
  /** Zoom around the viewport centre. */
  zoomTo: (scale: number) => void;
  requestFit: () => void;
};

const clamp = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));

export const useView = create<ViewState>((set, get) => ({
  scale: 1,
  x: 0,
  y: 0,
  container: { width: 0, height: 0 },
  fitTick: 0,
  spaceDown: false,
  saveStatus: "saved",
  tool: "select",
  pen: { kind: "pen", color: "#111827", size: 6 },
  shapeKind: "rect",
  bgJob: null,
  maskEditId: null,
  cropEditId: null,
  eraseEditId: null,
  eraseBrush: { size: 40, softness: 0.3, restore: false },
  set: (p) => set(p),
  zoomAt: (next, px, py) => {
    const { scale, x, y } = get();
    const s = clamp(next);
    set({ scale: s, x: px - ((px - x) * s) / scale, y: py - ((py - y) * s) / scale });
  },
  zoomTo: (next) => {
    const { container } = get();
    get().zoomAt(next, container.width / 2, container.height / 2);
  },
  requestFit: () => set((s) => ({ fitTick: s.fitTick + 1 })),
}));
