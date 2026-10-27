"use client";

import { pageRatio } from "@/lib/model";
import { ChevronLeft, ChevronRight, Copy, Maximize, Plus, Trash2 } from "lucide-react";
import { useEditor } from "@/store/editor";
import { MAX_ZOOM, MIN_ZOOM, useView } from "@/store/view";
import { cx, IconButton } from "../ui";

export function BottomBar() {
  const design = useEditor((s) => s.design);
  const pageId = useEditor((s) => s.pageId);
  const scale = useView((s) => s.scale);
  const st = useEditor.getState();
  if (!design) return null;
  const index = design.pages.findIndex((p) => p.id === pageId);

  return (
    <footer className="hidden h-20 shrink-0 items-center gap-3 border-t border-ink-200 bg-surface px-3 md:flex">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-2">
        {design.pages.map((p, i) => (
          <button
            key={p.id}
            title={`Page ${i + 1}`}
            onClick={() => st.setPage(p.id)}
            className={cx(
              "relative h-12 shrink-0 rounded-md border-2 text-xs font-medium text-ink-500 transition-colors",
              p.id === pageId ? "border-accent-500" : "border-ink-200 hover:border-ink-300",
            )}
            style={{ aspectRatio: pageRatio(design, p), backgroundColor: p.background, maxWidth: 96 }}
          >
            <span className="absolute bottom-0.5 left-1 rounded bg-white/80 px-1">{i + 1}</span>
          </button>
        ))}
        <IconButton title="Add page" onClick={st.addPage} className="h-12 w-12 border-2 border-dashed border-ink-200">
          <Plus size={18} />
        </IconButton>
      </div>

      <div className="flex items-center gap-0.5 border-l border-ink-100 pl-3">
        <span className="mr-1 font-mono text-xs text-ink-500">
          Page {index + 1} / {design.pages.length}
        </span>
        <IconButton title="Move page left" disabled={index === 0} onClick={() => st.movePage(pageId, -1)}>
          <ChevronLeft size={16} />
        </IconButton>
        <IconButton
          title="Move page right"
          disabled={index === design.pages.length - 1}
          onClick={() => st.movePage(pageId, 1)}
        >
          <ChevronRight size={16} />
        </IconButton>
        <IconButton title="Duplicate page" onClick={() => st.duplicatePage(pageId)}>
          <Copy size={16} />
        </IconButton>
        <IconButton title="Delete page" disabled={design.pages.length <= 1} onClick={() => st.deletePage(pageId)}>
          <Trash2 size={16} />
        </IconButton>
      </div>

      <div className="flex items-center gap-2 border-l border-ink-100 pl-3">
        <input
          type="range"
          aria-label="Zoom"
          min={Math.log(MIN_ZOOM)}
          max={Math.log(MAX_ZOOM)}
          step={0.01}
          value={Math.log(scale)}
          onChange={(e) => useView.getState().zoomTo(Math.exp(Number(e.target.value)))}
          className="w-28 accent-[var(--color-accent-500)]"
        />
        <span className="w-12 text-right text-xs tabular-nums text-ink-600">{Math.round(scale * 100)}%</span>
        <IconButton title="Fit to screen (Ctrl+0)" onClick={() => useView.getState().requestFit()}>
          <Maximize size={16} />
        </IconButton>
      </div>
    </footer>
  );
}
