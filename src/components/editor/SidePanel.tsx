"use client";

import {
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Files,
  Hexagon,
  Image as ImageIcon,
  Layers,
  Lock,
  Maximize,
  Plus,
  Shapes,
  Square,
  Star,
  Trash2,
  Triangle,
  Type,
  Unlock,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadAssetImage } from "@/lib/images";
import type { Element } from "@/lib/model";
import { currentPage, useEditor } from "@/store/editor";
import { useView } from "@/store/view";
import { cx, useMediaQuery } from "../ui";
import { ASSET_DRAG_TYPE, addImageFiles, insertAsset, insertLine, insertShape, insertText } from "./actions";

type Tab = "text" | "elements" | "uploads" | "layers" | "pages";

const TABS: { id: Tab; label: string; icon: React.ReactNode; mobileOnly?: boolean }[] = [
  { id: "text", label: "Text", icon: <Type size={20} /> },
  { id: "elements", label: "Elements", icon: <Shapes size={20} /> },
  { id: "uploads", label: "Uploads", icon: <Upload size={20} /> },
  { id: "layers", label: "Layers", icon: <Layers size={20} /> },
  { id: "pages", label: "Pages", icon: <Files size={20} />, mobileOnly: true },
];

/**
 * Desktop: icon rail plus a 288px panel on the left.
 * Phone: a bottom tab bar whose panel opens as a sheet over the canvas.
 */
export function SidePanel({ onNotice }: { onNotice: (msg: string) => void }) {
  const mobile = useMediaQuery("(max-width: 767px)");
  const [tab, setTab] = useState<Tab | null>(null);
  const selected = useEditor((s) => s.selected);

  // Desktop starts with the Text panel open; phones start with the canvas clear.
  useEffect(() => {
    setTab((t) => (mobile ? (t === "pages" || t === null ? t : null) : t === "pages" ? "text" : (t ?? "text")));
  }, [mobile]);

  // On a phone, get the sheet out of the way once something is placed on the page.
  const selKey = selected.join();
  useEffect(() => {
    if (mobile && selKey) setTab((t) => (t === "layers" || t === "pages" ? t : null));
  }, [mobile, selKey]);

  const tabs = TABS.filter((t) => mobile || !t.mobileOnly);

  return (
    <aside
      aria-label="Side panel"
      className="relative z-30 order-last flex shrink-0 flex-col-reverse md:order-none border-t border-ink-200 bg-surface md:h-full md:flex-row md:border-r md:border-t-0"
    >
      <nav
        role="tablist"
        className="flex justify-around px-1 pb-[max(env(safe-area-inset-bottom),4px)] pt-1 md:w-[72px] md:flex-col md:justify-start md:gap-1 md:border-r md:border-ink-100 md:px-0 md:py-2"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(tab === t.id ? null : t.id)}
            className={cx(
              "flex min-w-14 flex-col items-center gap-1 rounded-[var(--radius-input)] px-1 py-1.5 text-[11px] font-medium text-ink-600 transition-colors hover:bg-ink-100 md:mx-auto md:w-16 md:py-2",
              tab === t.id && "bg-accent-50 text-accent-600",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>
      {tab && (
        <div
          className={cx(
            "relative flex flex-col overflow-y-auto p-4",
            mobile
              ? "absolute inset-x-0 bottom-full max-h-[55dvh] rounded-t-[var(--radius-core)] bg-surface shadow-[0_-12px_40px_-12px_rgba(30,34,90,0.25),var(--shadow-hairline)]"
              : "w-72",
          )}
        >
          {mobile && <span aria-hidden className="mx-auto -mt-1 mb-3 h-1 w-10 shrink-0 rounded-full bg-ink-200" />}
          <button
            title="Close panel"
            onClick={() => setTab(null)}
            className="absolute right-2 top-3 rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          >
            {mobile ? <X size={18} /> : <ChevronLeft size={16} />}
          </button>
          {tab === "text" && <TextTab />}
          {tab === "elements" && <ElementsTab />}
          {tab === "uploads" && <UploadsTab onNotice={onNotice} />}
          {tab === "layers" && <LayersTab />}
          {tab === "pages" && <PagesTab />}
        </div>
      )}
    </aside>
  );
}

function PagesTab() {
  const design = useEditor((s) => s.design);
  const pageId = useEditor((s) => s.pageId);
  const st = useEditor.getState();
  if (!design) return null;
  const index = design.pages.findIndex((p) => p.id === pageId);
  const ratio = design.width / design.height;
  const action = "flex items-center gap-2 rounded-full px-3 py-2 text-sm text-ink-700 shadow-[var(--shadow-hairline)] disabled:opacity-35";
  return (
    <>
      <Heading>Pages</Heading>
      <div className="grid grid-cols-3 gap-2">
        {design.pages.map((p, i) => (
          <button
            key={p.id}
            onClick={() => st.setPage(p.id)}
            className={cx(
              "relative w-full rounded-md border-2",
              p.id === pageId ? "border-accent-500" : "border-ink-200",
            )}
            style={{ aspectRatio: ratio, background: p.background }}
          >
            <span className="absolute bottom-1 left-1 rounded bg-white/85 px-1 font-mono text-[11px] text-ink-600">
              {i + 1}
            </span>
          </button>
        ))}
        <button
          onClick={st.addPage}
          className="flex w-full items-center justify-center rounded-md border-2 border-dashed border-ink-200 text-ink-500"
          style={{ aspectRatio: ratio }}
          title="Add page"
        >
          <Plus size={20} />
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className={action} disabled={index === 0} onClick={() => st.movePage(pageId, -1)}>
          <ChevronLeft size={15} /> Move left
        </button>
        <button className={action} disabled={index === design.pages.length - 1} onClick={() => st.movePage(pageId, 1)}>
          Move right <ChevronRight size={15} />
        </button>
        <button className={action} onClick={() => st.duplicatePage(pageId)}>
          <Copy size={15} /> Duplicate
        </button>
        <button className={action} disabled={design.pages.length <= 1} onClick={() => st.deletePage(pageId)}>
          <Trash2 size={15} /> Delete
        </button>
        <button className={action} onClick={() => useView.getState().requestFit()}>
          <Maximize size={15} /> Fit to screen
        </button>
      </div>
    </>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold text-ink-900">{children}</h2>;
}

function TextTab() {
  return (
    <>
      <Heading>Text</Heading>
      <button
        onClick={() => insertText("heading")}
        className="mb-2 w-full rounded-full bg-accent-500 shadow-[var(--shadow-cta)] px-3 py-2.5 text-sm font-semibold text-white hover:bg-accent-600"
      >
        Add a text box
      </button>
      <p className="mb-2 mt-4 text-xs font-medium text-ink-500">Default text styles</p>
      <div className="space-y-2">
        <PresetButton onClick={() => insertText("heading")} className="text-2xl font-bold">
          Add a heading
        </PresetButton>
        <PresetButton onClick={() => insertText("subheading")} className="text-lg font-semibold">
          Add a subheading
        </PresetButton>
        <PresetButton onClick={() => insertText("body")} className="text-sm">
          Add a little bit of body text
        </PresetButton>
      </div>
    </>
  );
}

function PresetButton({ children, onClick, className }: { children: React.ReactNode; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "w-full rounded-[var(--radius-input)] px-3 py-3 text-left shadow-[var(--shadow-hairline)] text-ink-900 hover:bg-ink-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

function ElementsTab() {
  const tile =
    "flex aspect-square items-center justify-center rounded-[var(--radius-input)] bg-ink-50 text-ink-500 hover:bg-ink-100 hover:text-ink-800";
  return (
    <>
      <Heading>Shapes</Heading>
      <div className="grid grid-cols-3 gap-2">
        <button title="Square" className={tile} onClick={() => insertShape("rect")}>
          <Square size={36} fill="currentColor" />
        </button>
        <button title="Rounded square" className={tile} onClick={() => insertShape("rect", true)}>
          <span className="h-9 w-9 rounded-lg bg-current" />
        </button>
        <button title="Circle" className={tile} onClick={() => insertShape("ellipse")}>
          <Circle size={36} fill="currentColor" />
        </button>
        <button title="Triangle" className={tile} onClick={() => insertShape("triangle")}>
          <Triangle size={36} fill="currentColor" />
        </button>
        <button title="Star" className={tile} onClick={() => insertShape("star")}>
          <Star size={36} fill="currentColor" />
        </button>
        <button title="Hexagon" className={tile} onClick={() => insertShape("hexagon")}>
          <Hexagon size={36} fill="currentColor" />
        </button>
      </div>
      <h2 className="mb-3 mt-6 text-sm font-semibold text-ink-900">Lines</h2>
      <div className="grid grid-cols-3 gap-2">
        <button title="Line" className={tile} onClick={() => insertLine("solid")}>
          <span className="h-0.5 w-10 bg-current" />
        </button>
        <button title="Dashed line" className={tile} onClick={() => insertLine("dashed")}>
          <span className="w-10 border-t-2 border-dashed border-current" />
        </button>
        <button title="Arrow" className={tile} onClick={() => insertLine("arrow")}>
          <span className="relative h-0.5 w-10 bg-current after:absolute after:-right-0.5 after:-top-[5px] after:border-y-[6px] after:border-l-[8px] after:border-y-transparent after:border-l-current" />
        </button>
      </div>
    </>
  );
}

function AssetThumb({ id, name }: { id: string; name: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    loadAssetImage(id).then((img) => alive && img && setSrc(img.src));
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <button
      title={`Add ${name}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData(ASSET_DRAG_TYPE, id)}
      onClick={() => insertAsset(id)}
      className="flex aspect-square items-center justify-center overflow-hidden rounded-[var(--radius-input)] bg-ink-50 hover:ring-2 hover:ring-accent-400"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : <ImageIcon className="text-ink-300" />}
    </button>
  );
}

function UploadsTab({ onNotice }: { onNotice: (msg: string) => void }) {
  const assets = useEditor((s) => s.design?.assets);
  const input = useRef<HTMLInputElement>(null);
  const entries = Object.entries(assets ?? {});
  return (
    <>
      <Heading>Uploads</Heading>
      <button
        onClick={() => input.current?.click()}
        className="mb-2 w-full rounded-full bg-accent-500 shadow-[var(--shadow-cta)] px-3 py-2.5 text-sm font-semibold text-white hover:bg-accent-600"
      >
        Upload images
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const warning = await addImageFiles([...(e.target.files ?? [])]);
          if (warning) onNotice(warning);
          e.target.value = "";
        }}
      />
      <p className="mb-3 text-xs text-ink-500">Or drop images onto the canvas. Images stay in this browser.</p>
      {entries.length ? (
        <div className="grid grid-cols-2 gap-2">
          {entries.map(([id, meta]) => (
            <AssetThumb key={id} id={id} name={meta.name} />
          ))}
        </div>
      ) : (
        <p className="mt-6 text-center text-sm text-ink-400">No uploads yet</p>
      )}
    </>
  );
}

function label(el: Element) {
  if (el.name) return el.name;
  if (el.type === "text") return el.text.split("\n")[0].slice(0, 40) || "Text";
  if (el.type === "shape") return el.shape[0].toUpperCase() + el.shape.slice(1);
  if (el.type === "line") return el.arrowEnd ? "Arrow" : "Line";
  return "Image";
}

function LayersTab() {
  const page = useEditor(currentPage);
  const selected = useEditor((s) => s.selected);
  const [dragId, setDragId] = useState<string | null>(null);
  if (!page) return null;
  const st = useEditor.getState();
  const n = page.elements.length;
  // Top of list = front-most element.
  const rows = [...page.elements].reverse();
  return (
    <>
      <Heading>Layers</Heading>
      {!rows.length && <p className="mt-6 text-center text-sm text-ink-400">This page is empty</p>}
      <ul className="space-y-1">
        {rows.map((el, i) => (
          <li
            key={el.id}
            draggable
            onDragStart={() => setDragId(el.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragId && dragId !== el.id) st.moveTo(dragId, n - 1 - i);
              setDragId(null);
            }}
            onClick={(e) => st.select([el.id], e.shiftKey)}
            className={cx(
              "group flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-sm",
              selected.includes(el.id) ? "border-accent-400 bg-accent-50" : "border-transparent hover:bg-ink-50",
              el.hidden && "opacity-50",
            )}
          >
            <span className="w-4 text-xs text-ink-400">{n - i}</span>
            <span className="flex-1 truncate text-ink-800">{label(el)}</span>
            {el.groupId && <span className="rounded bg-ink-100 px-1 text-[10px] text-ink-500">group</span>}
            <button
              title={el.locked ? "Unlock" : "Lock"}
              onClick={(e) => {
                e.stopPropagation();
                st.update([el.id], { locked: !el.locked });
              }}
              className={cx("rounded p-1 text-ink-500 hover:bg-ink-100", !el.locked && "md:opacity-0 md:group-hover:opacity-100")}
            >
              {el.locked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
            <button
              title={el.hidden ? "Show" : "Hide"}
              onClick={(e) => {
                e.stopPropagation();
                st.update([el.id], { hidden: !el.hidden });
              }}
              className={cx("rounded p-1 text-ink-500 hover:bg-ink-100", !el.hidden && "md:opacity-0 md:group-hover:opacity-100")}
            >
              {el.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
