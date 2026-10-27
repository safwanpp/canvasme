"use client";

import { Info, X } from "lucide-react";
import { useMemo } from "react";
import { closeNotes } from "@/lib/importers/job";
import type { ImportIssueKind, ImportReportItem } from "@/lib/model";
import { useEditor } from "@/store/editor";

const GROUPS: { kind: ImportIssueKind; title: string; hint: string }[] = [
  { kind: "baked", title: "Baked into pixels", hint: "Drawn into the layer's image with our own approximation, so no longer editable." },
  { kind: "approximated", title: "Simplified", hint: "Kept, but some settings have no equivalent here." },
  { kind: "dropped", title: "Left out", hint: "Couldn't be kept. The original file still has them." },
  { kind: "info", title: "Notes", hint: "" },
];

/** What the import that made this design simplified, per layer. Clicking an item selects its layer. */
export function ImportNotes() {
  const report = useEditor((s) => s.design?.importReport);
  const pages = useEditor((s) => s.design?.pages);
  // Element id → its page id, rebuilt only when the pages change (not per item per render).
  const pageOfId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pages ?? []) for (const e of p.elements) m.set(e.id, p.id);
    return m;
  }, [pages]);
  if (!report) return null;
  const st = useEditor.getState();
  const pageOf = (id: string | undefined) => (id ? pageOfId.get(id) : undefined);
  const select = (item: ImportReportItem) => {
    const pageId = pageOf(item.elementId);
    if (!pageId || !item.elementId) return;
    if (pageId !== st.pageId) st.setPage(pageId);
    st.select([item.elementId]);
  };
  return (
    <section aria-labelledby="import-notes-title" className="mt-4 rounded-lg border border-ink-200 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Info size={16} className="mt-0.5 shrink-0 text-accent-500" />
        <div className="min-w-0 flex-1">
          <h3 id="import-notes-title" className="font-semibold text-ink-900">
            Import notes
          </h3>
          <p className="truncate text-xs text-ink-500">{report.fileName}</p>
        </div>
        <button
          title="Close"
          aria-label="Close import notes"
          onClick={closeNotes}
          className="-mr-1 -mt-1 rounded-md p-1 hover:bg-ink-100"
        >
          <X size={14} />
        </button>
      </div>
      {report.notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-600">
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {GROUPS.map((g) => {
        const list = report.items.filter((i) => i.kind === g.kind);
        if (!list.length) return null;
        return (
          <div key={g.kind} className="mt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {g.title} ({list.length})
            </h4>
            {g.hint && <p className="text-[11px] text-ink-400">{g.hint}</p>}
            <ul className="mt-1 space-y-1">
              {list.map((item, i) => (
                <li key={`${item.elementId ?? item.layerName}-${i}`}>
                  <button
                    disabled={!pageOf(item.elementId)}
                    onClick={() => select(item)}
                    className="w-full rounded-md px-2 py-1 text-left hover:bg-ink-50 disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className="block truncate text-xs font-medium text-ink-800">{item.layerName}</span>
                    <span className="block text-xs text-ink-500">{item.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <button
        onClick={() => {
          st.mutate((d) => {
            delete d.importReport;
          });
          closeNotes();
        }}
        className="mt-3 w-full rounded-full py-1.5 text-xs text-ink-600 shadow-[var(--shadow-hairline)] hover:bg-ink-50"
      >
        Dismiss all
      </button>
    </section>
  );
}
