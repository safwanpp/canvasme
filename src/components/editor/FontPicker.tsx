"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ensureFont, type Font, FONTS } from "@/lib/fonts";
import { useEditor } from "@/store/editor";
import { cx, Popover } from "../ui";

const RECENT_KEY = "canvasme:recent-fonts";
const RECENT_MAX = 6;
const ML_SAMPLE = "മലയാളം അക്ഷരങ്ങൾ";

type Filter = "all" | "latin" | "malayalam";
type Section = { title: string; fonts: Font[] };

const byFamily = new Map(FONTS.map((f) => [f.family, f]));

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((f) => byFamily.has(f)) : [];
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
export function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  return (
    <Popover
      title="Font"
      triggerClassName="h-9 w-36 justify-between border border-ink-200 px-2 md:h-8 md:w-44"
      trigger={
        <>
          <span className="truncate" style={{ fontFamily: `"${value}", system-ui` }}>
            {value}
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
  const [filter, setFilter] = useState<Filter>(() => (byFamily.get(value)?.script === "malayalam" ? "malayalam" : "all"));
  const [active, setActive] = useState(-1);
  const [recent] = useState(readRecent);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const design = useEditor((s) => s.design);

  const docFonts = useMemo(() => {
    const used = new Set(design?.pages.flatMap((p) => p.elements.flatMap((e) => (e.type === "text" ? [e.fontFamily] : []))));
    return FONTS.filter((f) => used.has(f.family));
  }, [design]);

  const sections = useMemo<Section[]>(() => {
    const inFilter = (f: Font) =>
      filter === "all" || (filter === "malayalam" ? f.script === "malayalam" : !f.script);
    const q = query.trim().toLowerCase();
    if (q) {
      const hits = FONTS.filter(
        (f) => inFilter(f) && (f.family.toLowerCase().includes(q) || (f.script && "malayalam മലയാളം".includes(q))),
      );
      return [{ title: hits.length ? "Results" : "", fonts: hits }];
    }
    const out: Section[] = [];
    const doc = docFonts.filter(inFilter);
    const rec = recent.map((f) => byFamily.get(f)!).filter(inFilter);
    if (doc.length) out.push({ title: "Document fonts", fonts: doc });
    if (rec.length) out.push({ title: "Recently used", fonts: rec });
    if (filter !== "malayalam") out.push({ title: "Latin", fonts: FONTS.filter((f) => !f.script) });
    if (filter !== "latin") out.push({ title: "Malayalam · മലയാളം", fonts: FONTS.filter((f) => f.script === "malayalam") });
    return out;
  }, [query, filter, docFonts, recent]);

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
}: {
  font: Font;
  index: number;
  selected: boolean;
  active: boolean;
  root: React.RefObject<HTMLDivElement | null>;
  onPick: (family: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);

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
    <button
      ref={ref}
      role="option"
      aria-selected={selected}
      data-index={index}
      onClick={() => onPick(font.family)}
      className={cx(
        "flex w-full items-center gap-2 rounded-[var(--radius-input)] px-2 py-1.5 text-left hover:bg-ink-100",
        active && "bg-ink-100",
      )}
    >
      <span className="min-w-0 flex-1">
        <span
          className={cx("block truncate text-[17px] leading-snug text-ink-900 transition-opacity", !ready && "opacity-50")}
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
  );
}
