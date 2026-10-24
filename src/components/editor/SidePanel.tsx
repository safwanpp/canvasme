"use client";

import {
  ChevronLeft,
  Circle,
  Eye,
  EyeOff,
  Hexagon,
  Image as ImageIcon,
  Layers,
  Lock,
  Shapes,
  Square,
  Star,
  Triangle,
  Type,
  Unlock,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadAssetImage } from "@/lib/images";
import type { Element } from "@/lib/model";
import { currentPage, useEditor } from "@/store/editor";
import { cx } from "../ui";
import { ASSET_DRAG_TYPE, addImageFiles, insertAsset, insertLine, insertShape, insertText } from "./actions";

type Tab = "text" | "elements" | "uploads" | "layers";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "text", label: "Text", icon: <Type size={20} /> },
  { id: "elements", label: "Elements", icon: <Shapes size={20} /> },
  { id: "uploads", label: "Uploads", icon: <Upload size={20} /> },
  { id: "layers", label: "Layers", icon: <Layers size={20} /> },
];

export function SidePanel({ onNotice }: { onNotice: (msg: string) => void }) {
  const [tab, setTab] = useState<Tab | null>("text");
  return (
    <aside className="flex h-full shrink-0 border-r border-ink-200 bg-white" aria-label="Side panel">
      <nav className="flex w-[72px] flex-col items-center gap-1 border-r border-ink-100 py-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(tab === t.id ? null : t.id)}
            className={cx(
              "flex w-16 flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium text-ink-600 transition-colors hover:bg-ink-100",
              tab === t.id && "bg-accent-50 text-accent-600",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>
      {tab && (
        <div className="relative flex w-72 flex-col overflow-y-auto p-4">
          <button
            title="Collapse panel"
            onClick={() => setTab(null)}
            className="absolute right-2 top-3 rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          >
            <ChevronLeft size={16} />
          </button>
          {tab === "text" && <TextTab />}
          {tab === "elements" && <ElementsTab />}
          {tab === "uploads" && <UploadsTab onNotice={onNotice} />}
          {tab === "layers" && <LayersTab />}
        </div>
      )}
    </aside>
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
        className="mb-2 w-full rounded-lg bg-accent-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-accent-600"
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
        "w-full rounded-lg border border-ink-200 px-3 py-3 text-left text-ink-900 hover:border-ink-300 hover:bg-ink-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

function ElementsTab() {
  const tile =
    "flex aspect-square items-center justify-center rounded-lg bg-ink-50 text-ink-500 hover:bg-ink-100 hover:text-ink-800";
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
      className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-ink-50 hover:ring-2 hover:ring-accent-400"
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
        className="mb-2 w-full rounded-lg bg-accent-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-accent-600"
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
              className={cx("rounded p-1 text-ink-500 hover:bg-ink-100", !el.locked && "opacity-0 group-hover:opacity-100")}
            >
              {el.locked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
            <button
              title={el.hidden ? "Show" : "Hide"}
              onClick={(e) => {
                e.stopPropagation();
                st.update([el.id], { hidden: !el.hidden });
              }}
              className={cx("rounded p-1 text-ink-500 hover:bg-ink-100", !el.hidden && "opacity-0 group-hover:opacity-100")}
            >
              {el.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
