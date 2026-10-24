"use client";

import { Check, CloudOff, Download, FolderOpen, Home, Loader2, Redo2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { exportImages, exportPdf } from "@/lib/export";
import { downloadBlob, exportWorkfile, importWorkfile, safeFilename, WORKFILE_EXT } from "@/lib/workfile";
import { useEditor } from "@/store/editor";
import { useView } from "@/store/view";
import { IconButton, Popover } from "../ui";

const DARK = "text-white hover:bg-white/10";

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
    <header className="flex h-14 shrink-0 items-center gap-2 bg-ink-900 px-3 text-white">
      <Link href="/app" title="All designs" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/10">
        <Home size={16} />
        <span className="text-sm font-semibold tracking-tight">canvas.me</span>
      </Link>
      <span className="mx-1 h-6 w-px bg-white/15" />
      <IconButton title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={st.undo} className={DARK}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={st.redo} className={DARK}>
        <Redo2 size={16} />
      </IconButton>
      <span className="flex items-center gap-1 text-xs text-white/60" aria-live="polite">
        {saveStatus === "saving" && (
          <>
            <Loader2 size={12} className="animate-spin" /> Saving…
          </>
        )}
        {saveStatus === "saved" && (
          <>
            <Check size={12} /> Saved in this browser
          </>
        )}
        {saveStatus === "error" && (
          <>
            <CloudOff size={12} /> Not saved. Download a work file
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
        className="mx-auto w-64 rounded-md bg-transparent px-2 py-1 text-center text-sm outline-none hover:bg-white/10 focus:bg-white/10"
      />

      <button
        onClick={() => fileInput.current?.click()}
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm hover:bg-white/10"
      >
        <FolderOpen size={16} /> Open file
      </button>
      <input
        ref={fileInput}
        type="file"
        accept={WORKFILE_EXT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f)
            run(async () => {
              const d = await importWorkfile(f);
              router.push(`/app/edit?id=${d.id}`);
            });
        }}
      />

      <Popover
        title="Download"
        align="right"
        triggerClassName="bg-accent-500 px-3 text-white hover:bg-accent-600"
        trigger={
          <>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            <span className="font-medium">Download</span>
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
              <MenuItem label="PDF: all pages" hint="For print and sharing" onClick={item(() => exportPdf(design()))} />
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
