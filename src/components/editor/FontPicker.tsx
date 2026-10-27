"use client";

import { Check, ChevronDown, Loader2, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addFontFiles,
  FONT_ACCEPT,
  refreshUploadedFonts,
  removeUploadedFont,
  useUploadedFonts,
} from "@/lib/customFonts";
import { ensureFont, type Font, FONTS } from "@/lib/fonts";
import { textFamilies } from "@/lib/richText";
import { useEditor } from "@/store/editor";
import { cx, Popover } from "../ui";

const RECENT_KEY = "canvasme:recent-fonts";
const RECENT_MAX = 6;
const ML_SAMPLE = "മലയാളം അക്ഷരങ്ങൾ";

type Filter = "all" | "latin" | "malayalam";
type Section = { title: string; fonts: Font[] };

const UPLOADED = "Uploaded fonts";

const byFamily = new Map(FONTS.map((f) => [f.family, f]));

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((f) => typeof f === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(family: string) {
  try {
    const next = [family, ...readRecent().filter((f) => f !== family)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode or blocked storage: the list just won't remember.
  }
}

/** Font dropdown for the text toolbar: search, script filter, document and recent fonts, live previews. */
export function FontPicker({ value, mixed, onChange }: { value: string; mixed?: boolean; onChange: (family: string) => void }) {
  return (
    <Popover
      title="Font"
      triggerClassName="h-9 w-36 justify-between border border-ink-200 px-2 md:h-8 md:w-44"
      trigger={
        <>
          <span className="truncate" style={{ fontFamily: `"${value}", system-ui` }}>
            {mixed ? "Mixed" : value}
          </span>
          <ChevronDown size={14} className="shrink-0 text-ink-400" />
        </>
      }
    >
      {(close) => (
        <FontList
          value={value}
          onPick={(family) => {
            pushRecent(family);
            onChange(family);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function FontList({ value, onPick }: { value: string; onPick: (family: string) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(() =>
    byFamily.get(value)?.script === "malayalam" ? "malayalam" : "all",
  );
  const [active, setActive] = useState(-1);
  const [recent] = useState(readRecent);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const design = useEditor((s) => s.design);
  const { fonts: uploadedMeta, loaded } = useUploadedFonts();
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loaded) void refreshUploadedFonts();
  }, [loaded]);

  const uploaded = useMemo<Font[]>(
    () => uploadedMeta.map((f) => ({ family: f.family, uploadedId: f.id })),
    [uploadedMeta],
  );
  const all = useMemo(() => [...uploaded, ...FONTS], [uploaded]);

  const docFonts = useMemo(() => {
    const used = new Set(
      design?.pages.flatMap((p) => p.elements.flatMap((e) => (e.type === "text" ? textFamilies(e) : []))),
    );
    return all.filter((f) => used.has(f.family));
  }, [design, all]);

  const sections = useMemo<Section[]>(() => {
    // Uploaded fonts can be any script, so they show under every filter.
    const inFilter = (f: Font) =>
      !!f.uploadedId || filter === "all" || (filter === "malayalam" ? f.script === "malayalam" : !f.script);
    const q = query.trim().toLowerCase();
    if (q) {
      const hits = all.filter(
        (f) => inFilter(f) && (f.family.toLowerCase().includes(q) || (f.script && "malayalam മലയാളം".includes(q))),
      );
      return [{ title: hits.length ? "Results" : "", fonts: hits }];
    }
    const out: Section[] = [];
    const doc = docFonts.filter(inFilter);
    const lookup = new Map(all.map((f) => [f.family, f]));
    const rec = recent.flatMap((f) => (lookup.has(f) ? [lookup.get(f)!] : [])).filter(inFilter);
    if (uploaded.length) out.push({ title: UPLOADED, fonts: uploaded });
    if (doc.length) out.push({ title: "Document fonts", fonts: doc });
    if (rec.length) out.push({ title: "Recently used", fonts: rec });
    if (filter !== "malayalam") out.push({ title: "Latin", fonts: FONTS.filter((f) => !f.script) });
    if (filter !== "latin")
      out.push({ title: "Malayalam · മലയാളം", fonts: FONTS.filter((f) => f.script === "malayalam") });
    return out;
  }, [query, filter, docFonts, recent, all, uploaded]);

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setUploadNote(null);
    try {
      const { added, warning } = await addFontFiles(files);
      setUploadNote(warning ?? (added.length ? `Added ${added.join(", ")}` : null));
      // One font uploaded: use it right away, like picking it from the list.
      if (added.length === 1 && !warning) onPick(added[0]);
    } finally {
      setUploading(false);
    }
  };

  const flat = sections.flatMap((s) => s.fonts);

  // Focus search on desktop (on a phone it would throw the keyboard over the list). Wait a frame:
  // the popover mounts hidden until it is positioned, and hidden inputs can't take focus.
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(flat.length - 1, i + step)));
    } else if (e.key === "Enter") {
      const pick = flat[active < 0 ? 0 : active];
      if (pick) onPick(pick.family);
    }
  };

  let index = 0;
  return (
    <div className="flex h-[min(460px,70dvh)] w-72 flex-col" onKeyDown={onKeyDown}>
      <label className="flex items-center gap-2 rounded-full bg-ink-50 px-3 shadow-[var(--shadow-hairline)] focus-within:ring-2 focus-within:ring-accent-400">
        <Search size={15} className="shrink-0 text-ink-400" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(-1);
          }}
          placeholder="Search fonts"
          aria-label="Search fonts"
          className="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-400"
        />
      </label>
      <div role="radiogroup" aria-label="Script" className="mt-2 flex gap-1">
        {(
          [
            ["all", "All"],
            ["latin", "Latin"],
            ["malayalam", "മലയാളം"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="radio"
            aria-checked={filter === id}
            onClick={() => {
              setFilter(id);
              setActive(-1);
            }}
            className={cx(
              "rounded-full px-3 py-1 text-xs font-medium text-ink-600 shadow-[var(--shadow-hairline)] hover:bg-ink-100",
              filter === id && "bg-accent-500 text-white shadow-none hover:bg-accent-500",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="mt-2 flex items-center justify-center gap-2 rounded-[var(--radius-input)] border border-dashed border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:border-accent-400 hover:bg-accent-50 hover:text-accent-600 disabled:opacity-60"
      >
        {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
        {uploading ? "Adding font…" : "Upload a font"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={FONT_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          void onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <p className="mt-1 text-[11px] leading-snug text-ink-400">
        {uploadNote ?? "TTF, OTF, WOFF or WOFF2. Stays in this browser. Only upload fonts you're licensed to use."}
      </p>
      <div ref={listRef} role="listbox" aria-label="Fonts" className="-mx-1 mt-2 min-h-0 flex-1 overflow-y-auto px-1">
        {!flat.length && <p className="mt-8 text-center text-sm text-ink-400">No fonts match “{query}”</p>}
        {sections.map((s) => (
          <div key={s.title}>
            {s.title && (
              <p className="sticky top-0 z-10 bg-surface pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                {s.title}
              </p>
            )}
            {s.fonts.map((f) => {
              const i = index++;
              return (
                <FontRow
                  key={`${s.title}-${f.family}`}
                  font={f}
                  index={i}
                  selected={f.family === value}
                  active={i === active}
                  root={listRef}
                  onPick={onPick}
                  removable={s.title === UPLOADED}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function FontRow({
  font,
  index,
  selected,
  active,
  root,
  onPick,
  removable,
}: {
  font: Font;
  index: number;
  selected: boolean;
  active: boolean;
  root: React.RefObject<HTMLDivElement | null>;
  onPick: (family: string) => void;
  /** Show the remove button (only in the Uploaded fonts section). */
  removable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Load each font only once its row scrolls into view, so opening the list stays light.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        void ensureFont(font.family).then(() => alive && setReady(true));
      },
      { root: root.current, rootMargin: "120px" },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [font.family, root]);

  const face = ready ? `"${font.family}", system-ui` : "system-ui";
  return (
    <div
      ref={ref}
      data-index={index}
      className={cx("group flex items-center rounded-[var(--radius-input)] hover:bg-ink-100", active && "bg-ink-100")}
    >
      <button
        role="option"
        aria-selected={selected}
        onClick={() => onPick(font.family)}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span
            className={cx(
              "block truncate text-[17px] leading-snug text-ink-900 transition-opacity",
              !ready && "opacity-50",
            )}
            style={{ fontFamily: face }}
          >
            {font.family}
          </span>
          {font.script === "malayalam" && (
            <span className="block truncate text-sm leading-snug text-ink-500" style={{ fontFamily: face }}>
              {ML_SAMPLE}
            </span>
          )}
        </span>
        {selected && <Check size={16} className="shrink-0 text-accent-500" />}
      </button>
      {removable && font.uploadedId && (
        <button
          type="button"
          title={confirming ? "Click again to remove this font" : "Remove uploaded font"}
          aria-label={`Remove ${font.family}`}
          onClick={() => (confirming ? void removeUploadedFont(font.uploadedId!) : setConfirming(true))}
          onMouseLeave={() => setConfirming(false)}
          className={cx(
            "mr-1 flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-ink-400 hover:bg-ink-200 hover:text-ink-700 md:opacity-0 md:group-hover:opacity-100",
            confirming && "bg-[#B23A30] text-white opacity-100 hover:bg-[#B23A30] hover:text-white md:opacity-100",
          )}
        >
          <Trash2 size={14} />
          {confirming && "Remove"}
        </button>
      )}
    </div>
  );
}
