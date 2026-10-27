"use client";

import { Check, CloudOff, Download, FolderOpen, Loader2, Redo2, Undo2 } from "lucide-react";
import Link from "next/link";
import { Logo } from "../Logo";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { exportImages, exportPdf } from "@/lib/export";
import { OPEN_ACCEPT, openDesignFile } from "@/lib/importers";
import { downloadBlob, exportWorkfile, safeFilename, WORKFILE_EXT } from "@/lib/workfile";
import { useEditor } from "@/store/editor";
import { useView } from "@/store/view";
import { ThemeToggle } from "../ThemeToggle";
import { IconButton, Popover } from "../ui";

const BAR_BTN = "text-ink-700 hover:bg-ink-100";

export function TopBar({ onNotice }: { onNotice: (msg: string) => void }) {
  const router = useRouter();
  const name = useEditor((s) => s.design?.name ?? "");
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const saveStatus = useView((s) => s.saveStatus);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const st = useEditor.getState();
  const design = () => useEditor.getState().design!;
  const pageId = () => useEditor.getState().pageId;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      onNotice((err as Error).message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-1 border-b border-ink-200 bg-surface/80 px-3 text-ink-900 backdrop-blur-xl">
      <Link href="/app" title="All designs" className="flex shrink-0 items-center gap-2 rounded-full px-2 py-1.5 hover:bg-ink-100 md:px-3">
        <Logo id="top" size={20} className="text-sm" textClassName="hidden md:inline" />
      </Link>
      <span className="mx-1 hidden h-6 w-px bg-ink-200 md:block" />
      <IconButton title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={st.undo} className={BAR_BTN}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={st.redo} className={BAR_BTN}>
        <Redo2 size={16} />
      </IconButton>
      <span className="flex items-center gap-1 font-mono text-xs text-ink-500" aria-live="polite">
        {saveStatus === "saving" && (
          <>
            <Loader2 size={12} className="animate-spin" /> <span className="hidden lg:inline">Saving…</span>
          </>
        )}
        {saveStatus === "saved" && (
          <>
            <Check size={12} /> <span className="hidden lg:inline">Saved in this browser</span>
          </>
        )}
        {saveStatus === "error" && (
          <>
            <CloudOff size={12} className="text-[#B23A30] dark:text-[#f0867c]" /> <span className="hidden lg:inline">Not saved. Download a work file</span>
          </>
        )}
      </span>

      <input
        aria-label="Design title"
        value={name}
        onChange={(e) => st.mutate((d) => void (d.name = e.target.value), { coalesce: "rename" })}
        onBlur={(e) => {
          if (!e.target.value.trim()) st.mutate((d) => void (d.name = "Untitled design"), { history: false });
        }}
        className="mx-1 min-w-0 flex-1 rounded-md bg-transparent md:mx-auto md:w-64 md:flex-none px-2 py-1 text-center text-sm outline-none hover:bg-ink-100 focus:bg-ink-100"
      />

      <button
        onClick={() => fileInput.current?.click()}
        title="Open a .canvasme, .psd, .ai or .pdf file"
        className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-2 text-sm font-medium md:px-4 md:py-1.5 text-ink-800 shadow-[var(--shadow-hairline)] hover:bg-ink-100"
      >
        <FolderOpen size={16} /> <span className="hidden md:inline">Open file</span>
      </button>
      <input
        ref={fileInput}
        type="file"
        accept={OPEN_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f)
            run(async () => {
              const d = await openDesignFile(f);
              if (d) router.push(`/app/edit?id=${d.id}`);
            });
        }}
      />

      <ThemeToggle />

      <Popover
        title="Download"
        align="right"
        triggerClassName="h-9 rounded-full bg-accent-fill px-2.5 md:px-4 text-white shadow-[var(--shadow-cta)] hover:bg-accent-fill-hover"
        trigger={
          <>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            <span className="hidden font-medium md:inline">Download</span>
          </>
        }
      >
        {(close) => {
          const item = (fn: () => Promise<void>) => () => {
            close();
            run(fn);
          };
          return (
            <div className="w-64 text-sm text-ink-800">
              <MenuItem label="PNG: this page" hint="Highest quality image" onClick={item(() => exportImages(design(), "png", [pageId()], 2))} />
              <MenuItem
                label="PNG: all pages"
                hint="Zip with one image per page"
                onClick={item(() => exportImages(design(), "png", design().pages.map((p) => p.id), 2))}
              />
              <MenuItem label="JPG: this page" hint="Smaller file size" onClick={item(() => exportImages(design(), "jpg", [pageId()], 2))} />
              <MenuItem
                label="PDF: all pages"
                hint="For print and sharing. Opens in Illustrator (pages as images)"
                onClick={item(() => exportPdf(design()))}
              />
              <MenuItem
                label="PSD: this page"
                hint="Photoshop file, one layer per element, with editable text and layer styles"
                onClick={item(async () => {
                  const { exportPsd } = await import("@/lib/importers/psdExport");
                  const notes = await exportPsd(design(), pageId(), "current");
                  if (notes.length) onNotice(notes.join(" "));
                })}
              />
              {design().pages.length > 1 && (
                <MenuItem
                  label="PSD: all pages as artboards"
                  hint="One Photoshop file, each page an artboard at its own size"
                  onClick={item(async () => {
                    const { exportPsd } = await import("@/lib/importers/psdExport");
                    const notes = await exportPsd(design(), pageId(), "artboards");
                    if (notes.length) onNotice(notes.join(" "));
                  })}
                />
              )}
              <div className="my-1 h-px bg-ink-100" />
              <MenuItem
                label="Work file (.canvasme)"
                hint="Editable backup. Open it later to keep editing"
                onClick={item(async () =>
                  downloadBlob(await exportWorkfile(design()), `${safeFilename(design().name)}${WORKFILE_EXT}`),
                )}
              />
            </div>
          );
        }}
      </Popover>
    </header>
  );
}

function MenuItem({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-ink-50">
      <span className="block font-medium">{label}</span>
      <span className="block text-xs text-ink-500">{hint}</span>
    </button>
  );
}
