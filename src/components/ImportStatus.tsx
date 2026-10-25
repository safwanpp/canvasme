"use client";

import { Info, Loader2, X } from "lucide-react";
import { setReport, useImportJob } from "@/lib/importers/job";

/** Progress, the .ai/.pdf import choice, and (in the editor) what an import left out. */
export function ImportStatus({ designId }: { designId?: string }) {
  const progress = useImportJob((s) => s.progress);
  const ask = useImportJob((s) => s.ask);
  const report = useImportJob((s) => s.report);

  return (
    <>
      {progress && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 left-1/2 z-[60] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2 rounded-lg bg-ink-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          <Loader2 size={14} className="shrink-0 animate-spin" />
          <span className="truncate">{progress.label}</span>
          {progress.detail && <span className="shrink-0 text-white/60">{progress.detail}</span>}
        </div>
      )}

      {ask && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/30 px-4" onClick={() => ask.answer(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pdf-mode-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && ask.answer(null)}
            className="w-full max-w-sm rounded-[var(--radius-core)] bg-surface p-5 text-ink-900 shadow-xl"
          >
            <h2 id="pdf-mode-title" className="font-semibold">
              How should this file come in?
            </h2>
            <p className="mt-1 truncate text-sm text-ink-500">{ask.fileName}</p>
            <div className="mt-4 space-y-2">
              <button
                autoFocus
                onClick={() => ask.answer("image")}
                className="block w-full rounded-[var(--radius-input)] bg-accent-500 px-4 py-3 text-left text-white shadow-[var(--shadow-cta)] hover:bg-accent-600"
              >
                <span className="block text-sm font-semibold">Import as image</span>
                <span className="block text-xs text-white/80">Looks exactly like the original. Each page or artboard is one picture.</span>
              </button>
              <button
                onClick={() => ask.answer("text")}
                className="block w-full rounded-[var(--radius-input)] px-4 py-3 text-left shadow-[var(--shadow-hairline)] hover:bg-ink-50"
              >
                <span className="block text-sm font-semibold">Image with editable text (beta)</span>
                <span className="block text-xs text-ink-500">
                  Straight text lines become text boxes on top. Fonts and spacing may differ.
                </span>
              </button>
            </div>
            <button onClick={() => ask.answer(null)} className="mt-3 w-full rounded-full py-2 text-sm text-ink-600 hover:bg-ink-100">
              Cancel
            </button>
          </div>
        </div>
      )}

      {designId && report?.designId === designId && (
        <div
          role="status"
          className="fixed bottom-24 right-4 z-50 w-[min(380px,calc(100vw-32px))] rounded-[var(--radius-core)] bg-surface p-4 text-sm text-ink-700 shadow-xl"
        >
          <div className="flex items-start gap-2">
            <Info size={16} className="mt-0.5 shrink-0 text-accent-500" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink-900">{report!.title}</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
                {report!.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
            <button title="Dismiss" aria-label="Dismiss" onClick={() => setReport(null)} className="-mr-1 -mt-1 rounded-md p-1 hover:bg-ink-100">
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
