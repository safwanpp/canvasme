"use client";

import { create } from "zustand";

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;

type SaveStatus = "saved" | "saving" | "error";

type ViewState = {
  scale: number;
  x: number;
  y: number;
  container: { width: number; height: number };
  fitTick: number;
  spaceDown: boolean;
  saveStatus: SaveStatus;
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
