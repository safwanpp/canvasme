"use client";

import { Copy, Download, FolderOpen, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { InstallButton, useLaunchedFiles } from "@/components/Pwa";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Popover } from "@/components/ui";
import { type Design, newDesign, SIZE_PRESETS, uid } from "@/lib/model";
import {
  deleteDesign,
  listDesigns,
  loadPrefs,
  loadThumb,
  requestPersistence,
  saveDesign,
  savePrefs,
  saveThumb,
} from "@/lib/storage";
import { ImportStatus } from "@/components/ImportStatus";
import { canOpen, OPEN_ACCEPT, openDesignFile } from "@/lib/importers";
import { downloadBlob, exportWorkfile, safeFilename, WORKFILE_EXT } from "@/lib/workfile";

function useThumb(id: string, version: number) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let url: string | undefined;
    let alive = true;
    loadThumb(id).then((b) => {
      if (!alive || !b) return;
      url = URL.createObjectURL(b);
      setSrc(url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, version]);
  return src;
}

export default function Dashboard() {
  const router = useRouter();
  const [designs, setDesigns] = useState<Design[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showBackupTip, setShowBackupTip] = useState(false);
  const [custom, setCustom] = useState({ width: 1200, height: 800 });
  const fileInput = useRef<HTMLInputElement>(null);
  const creatingFromLink = useRef(false);

  const refresh = useCallback(() => listDesigns().then(setDesigns), []);

  const create = useCallback(
    async (name: string, width: number, height: number, replace = false) => {
      const d = newDesign(name, width, height);
      await saveDesign(d);
      if (replace) router.replace(`/app/edit?id=${d.id}`);
      else router.push(`/app/edit?id=${d.id}`);
    },
    [router],
  );

  useEffect(() => {
    requestPersistence();
    // Landing-page size links: /app?size=1080x1080&name=Instagram%20post
    const params = new URLSearchParams(window.location.search);
    const size = params.get("size")?.match(/^(\d{2,4})x(\d{2,4})$/);
    if (size && !creatingFromLink.current) {
      creatingFromLink.current = true;
      const [w, h] = [Number(size[1]), Number(size[2])];
      if (w >= 16 && h >= 16 && w <= 8000 && h <= 8000) {
        create((params.get("name") || "Untitled design").slice(0, 80), w, h, true);
        return;
      }
    }
    refresh();
    setShowBackupTip(!loadPrefs().backupReminderDismissed);
  }, [refresh, create]);

  const openFile = async (file: File) => {
    setError(null);
    if (!canOpen(file)) {
      setError(`Choose a ${WORKFILE_EXT} work file, or a .psd, .ai or .pdf file.`);
      return;
    }
    try {
      const d = await openDesignFile(file);
      if (d) router.push(`/app/edit?id=${d.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useLaunchedFiles((file) => openFile(file));

  const duplicate = async (d: Design) => {
    const now = Date.now();
    const copy: Design = { ...structuredClone(d), id: uid(), name: `${d.name} (copy)`, createdAt: now, updatedAt: now };
    await saveDesign(copy);
    const thumb = await loadThumb(d.id);
    if (thumb) await saveThumb(copy.id, thumb);
    refresh();
  };

  const remove = async (d: Design) => {
    await deleteDesign(d.id);
    refresh();
  };

  return (
    <div
      className="min-h-dvh bg-ink-50"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) openFile(f);
      }}
    >
      <header className="flex h-14 items-center justify-between border-b border-ink-200 bg-surface/80 px-4 backdrop-blur-xl sm:px-6">
        <Link href="/" aria-label="canvas.me home" className="text-[15px]">
          <Logo id="dash" />
        </Link>
        <div className="flex items-center gap-2">
          <InstallButton variant="icon" className="sm:hidden" />
          <InstallButton className="hidden sm:flex" />
          <button
          onClick={() => fileInput.current?.click()}
          className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-[var(--shadow-hairline)] hover:bg-ink-100"
        >
          <FolderOpen size={16} /> Open file
        </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={OPEN_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) openFile(f);
          }}
        />
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {error && (
          <p role="alert" className="mb-4 rounded-[var(--radius-input)] bg-accent-50 px-4 py-3 text-sm text-accent-700">
            {error}
          </p>
        )}
        {showBackupTip && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-[var(--radius-input)] bg-surface px-4 py-3 shadow-[var(--shadow-hairline)] text-sm text-ink-600">
            <p>
              Your designs are saved in this browser only. Clearing site data deletes them, so download a{" "}
              <strong className="text-ink-900">.canvasme work file</strong> to back up anything important.
            </p>
            <button
              onClick={() => {
                savePrefs({ ...loadPrefs(), backupReminderDismissed: true });
                setShowBackupTip(false);
              }}
              className="shrink-0 text-ink-500 hover:text-ink-900"
            >
              Got it
            </button>
          </div>
        )}

        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Create a design</h1>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SIZE_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => create(p.label, p.width, p.height)}
              className="group flex flex-col items-center gap-3 rounded-[var(--radius-core)] bg-surface p-4 shadow-[var(--shadow-hairline)] text-left hover:border-accent-300 hover:shadow-sm"
            >
              <span className="flex h-16 w-full items-center justify-center">
                <span
                  className="rounded-sm border-2 border-ink-300 bg-ink-50 group-hover:border-accent-400"
                  style={{
                    width: p.width >= p.height ? 64 : (64 * p.width) / p.height,
                    height: p.height >= p.width ? 64 : (64 * p.height) / p.width,
                  }}
                />
              </span>
              <span className="w-full">
                <span className="block text-sm font-medium">{p.label}</span>
                <span className="block font-mono text-xs text-ink-500">
                  {p.width} × {p.height} px
                </span>
              </span>
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const w = Math.round(custom.width);
              const h = Math.round(custom.height);
              if (w >= 16 && h >= 16 && w <= 8000 && h <= 8000) create("Custom design", w, h);
              else setError("Custom size must be between 16 and 8000 px.");
            }}
            className="col-span-2 flex flex-col justify-between gap-2 rounded-[var(--radius-core)] border border-dashed border-ink-300 bg-surface p-4 sm:col-span-1"
          >
            <span className="text-sm font-medium">Custom size</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-500">
              <input
                aria-label="Width"
                type="number"
                value={custom.width}
                onChange={(e) => setCustom({ ...custom, width: Number(e.target.value) })}
                className="w-full min-w-0 rounded-[10px] border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
              />
              ×
              <input
                aria-label="Height"
                type="number"
                value={custom.height}
                onChange={(e) => setCustom({ ...custom, height: Number(e.target.value) })}
                className="w-full min-w-0 rounded-[10px] border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
              />
              px
            </span>
            <button
              type="submit"
              className="flex items-center justify-center gap-1 rounded-full bg-accent-500 shadow-[var(--shadow-cta)] py-1.5 text-sm font-semibold text-white hover:bg-accent-600"
            >
              <Plus size={14} /> Create
            </button>
          </form>
        </div>

        <h2 className="mt-12 text-2xl font-semibold tracking-[-0.03em]">Your designs</h2>
        {designs === null ? (
          <p className="mt-6 text-sm text-ink-500">Loading…</p>
        ) : designs.length === 0 ? (
          <div className="mt-6 rounded-[var(--radius-core)] border border-dashed border-ink-300 bg-surface px-6 py-12 text-center">
            <p className="font-medium">No designs yet</p>
            <p className="mt-1 text-sm text-ink-500">Pick a size above, or drop a .canvasme, .psd, .ai or .pdf file anywhere on this page.</p>
          </div>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {designs.map((d) => (
              <DesignCard key={d.id} design={d} onDuplicate={() => duplicate(d)} onDelete={() => remove(d)} />
            ))}
          </ul>
        )}
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-accent-500/10 ring-4 ring-inset ring-accent-400">
          <p className="rounded-xl bg-white px-6 py-4 font-medium shadow-lg">Drop a .canvasme, .psd, .ai or .pdf file to open it</p>
        </div>
      )}
      <ImportStatus />
    </div>
  );
}

function DesignCard({ design, onDuplicate, onDelete }: { design: Design; onDuplicate: () => void; onDelete: () => void }) {
  const src = useThumb(design.id, design.updatedAt);
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="group relative">
      <Link href={`/app/edit?id=${design.id}`} className="block">
        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[var(--radius-core)] bg-ink-100 shadow-[var(--shadow-hairline)] group-hover:border-accent-300">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="max-h-full max-w-full object-contain shadow-sm" />
          ) : (
            <span className="text-xs text-ink-400">No preview</span>
          )}
        </div>
        <p className="mt-2 truncate text-sm font-medium">{design.name}</p>
        <p className="font-mono text-xs text-ink-500">
          {design.width} × {design.height} · {design.pages.length} page{design.pages.length > 1 ? "s" : ""} · edited{" "}
          {new Date(design.updatedAt).toLocaleDateString()}
        </p>
      </Link>
      <div className="absolute right-2 top-2 rounded-full bg-surface shadow-[var(--shadow-hairline)] focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100">
        <Popover title="More" align="right" trigger={<MoreHorizontal size={16} />}>
          <div className="w-52 text-sm">
            <button
              onClick={async () => downloadBlob(await exportWorkfile(design), `${safeFilename(design.name)}${WORKFILE_EXT}`)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-ink-50"
            >
              <Download size={14} /> Download work file
            </button>
            <button onClick={onDuplicate} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-ink-50">
              <Copy size={14} /> Make a copy
            </button>
            <button
              onClick={() => (confirm ? onDelete() : setConfirm(true))}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-accent-700 hover:bg-accent-50"
            >
              <Trash2 size={14} /> {confirm ? "Click again to delete forever" : "Delete"}
            </button>
          </div>
        </Popover>
      </div>
    </li>
  );
}
