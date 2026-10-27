"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";
import type { ColorStop } from "@/lib/effects";
import { addStop, moveStop, removeStop, stopToAdd } from "@/lib/effectEdit";

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/**
 * Whether the editor's window-level shortcuts should leave a keydown alone: a control already
 * handled it, it came from inside a popover or dialog, or it is a key the focused control uses
 * (any key on a slider or option; Space and Enter on a button or switch).
 */
export function skipsShortcuts(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return true;
  const t = e.target;
  if (!(t instanceof Element)) return false;
  if (t.closest('[role="dialog"], [data-popover]')) return true;
  const role = t.getAttribute("role") ?? (t.tagName === "BUTTON" ? "button" : "");
  if (role === "slider" || role === "option" || role === "listbox") return true;
  if ((role === "button" || role === "switch") && (e.key === " " || e.key === "Enter")) return true;
  return false;
}

export function cx(...c: (string | false | null | undefined)[]) {
  return twMerge(c.filter(Boolean).join(" "));
}

export function IconButton({
  title,
  onClick,
  active,
  disabled,
  children,
  className,
}: {
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-sm text-ink-700 transition-colors md:h-8 md:min-w-8",
        "hover:bg-ink-100 disabled:pointer-events-none disabled:opacity-35",
        active && "bg-accent-50 text-accent-600",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Button that toggles a floating panel; closes on outside click or Escape. */
export function Popover({
  trigger,
  title,
  children,
  align = "left",
  side = "bottom",
  triggerClassName,
}: {
  trigger: ReactNode;
  title: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  side?: "bottom" | "top";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: "hidden" });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // Close on real resizes only; a phone keyboard opening changes just the height.
    const width = window.innerWidth;
    const onResize = () => window.innerWidth !== width && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // Fixed positioning keeps the panel visible inside scrolling toolbars;
  // clamp it to the viewport so it never runs off a phone screen.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = ref.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!trigger || !panel) return;
    const gap = 8;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = align === "left" ? trigger.left : trigger.right - panel.width;
    left = Math.max(margin, Math.min(left, vw - panel.width - margin));
    const below = trigger.bottom + gap;
    const above = trigger.top - gap - panel.height;
    const top = side === "bottom" ? (below + panel.height > vh && above > 0 ? above : below) : above > 0 ? above : below;
    setPos({ left, top: Math.max(margin, top), maxHeight: vh - 2 * margin, overflowY: "auto" });
  }, [open, align, side]);

  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      <IconButton
        title={title}
        active={open}
        onClick={() => {
          setPos({ visibility: "hidden" });
          setOpen((o) => !o);
        }}
        className={triggerClassName}
      >
        {trigger}
      </IconButton>
      {/* Portal to <body>: a parent with backdrop-filter or z-index would otherwise trap the
          fixed panel beneath later content (the editor and dashboard headers do this). */}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={title}
            data-popover=""
            style={pos}
            className="fixed z-50 min-w-48 max-w-[calc(100vw-16px)] rounded-[var(--radius-input)] bg-surface p-3 shadow-[var(--shadow-hairline),var(--shadow-soft)]"
          >
            {typeof children === "function" ? children(close) : children}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function ColorInput({
  value,
  onChange,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  title: string;
}) {
  return (
    <label
      title={title}
      className="relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-ink-100"
    >
      <span className="h-5 w-5 rounded-full border border-ink-300 shadow-inner" style={{ background: value }} />
      <input
        type="color"
        aria-label={title}
        value={value.length === 7 ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v) => String(Math.round(v)),
  mixed,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  /** The selection disagrees; show "Mixed" until the first edit. */
  mixed?: boolean;
}) {
  return (
    <label className="block py-1 text-xs text-ink-600">
      <span className="flex justify-between">
        {label}
        <span className={cx("tabular-nums", mixed ? "text-ink-400" : "text-ink-900")}>{mixed ? "Mixed" : format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--color-accent-500)]"
      />
    </label>
  );
}

export const Divider = () => <span className="mx-1 h-6 w-px bg-ink-200" />;

export type SelectOption<T extends string> = { value: T; label: string };

/** Labelled native select; `groups` render as <optgroup>s. */
export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  groups,
  mixed,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options?: SelectOption<T>[];
  groups?: { label: string; options: SelectOption<T>[] }[];
  mixed?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-1 text-xs text-ink-600">
      {label}
      <select
        value={mixed ? "" : value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-7 min-w-0 max-w-[60%] rounded-md border border-ink-200 bg-surface px-1.5 text-xs text-ink-900 hover:border-ink-300"
      >
        {mixed && (
          <option value="" disabled>
            Mixed
          </option>
        )}
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {groups?.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/** On/off switch. */
export function Toggle({
  label,
  checked,
  onChange,
  hideLabel,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hideLabel?: boolean;
}) {
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hideLabel ? label : undefined}
      title={hideLabel ? label : undefined}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-150",
        checked ? "bg-accent-500" : "bg-ink-300",
      )}
    >
      <span
        className={cx(
          "h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-150",
          checked ? "translate-x-3.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
  if (hideLabel) return sw;
  return (
    <label className="flex items-center justify-between gap-2 py-1 text-xs text-ink-600">
      {label}
      {sw}
    </label>
  );
}

/**
 * Gradient colour stops: click the bar (or "Add stop") to add a stop, drag a handle (or use the
 * arrow keys) to move it, Delete to remove it. The selected stop's colour is edited below.
 */
export function GradientInput({
  stops,
  onChange,
  label = "Gradient",
}: {
  stops: ColorStop[];
  onChange: (stops: ColorStop[]) => void;
  label?: string;
}) {
  const [sel, setSel] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number } | null>(null);
  // Handles are keyed by position, so after a keyboard edit re-sorts the stops, focus moves to
  // the handle now showing the edited stop.
  const handleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusTo = useRef<number | null>(null);
  useEffect(() => {
    if (focusTo.current === null) return;
    handleRefs.current[focusTo.current]?.focus();
    focusTo.current = null;
  });
  const cur = Math.min(sel, stops.length - 1);
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const css = `linear-gradient(to right, ${sorted.map((s) => `${s.color} ${s.offset * 100}%`).join(", ")})`;
  const offsetAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return r.width ? (clientX - r.left) / r.width : 0;
  };
  // Edits re-sort the list; the edited stop is the one new object in it.
  const fresh = (next: ColorStop[]) => next.findIndex((s) => !stops.includes(s));
  const add = (offset: number) => {
    const next = addStop(stops, offset);
    if (next === stops) return;
    onChange(next);
    setSel(Math.max(0, fresh(next)));
  };
  const move = (index: number, offset: number) => {
    const next = moveStop(stops, index, offset);
    const ni = Math.max(0, fresh(next));
    onChange(next);
    setSel(ni);
    return ni;
  };
  return (
    <div className="py-1 text-xs text-ink-600">
      <span className="mb-1 block">{label}</span>
      <div className="relative mx-2">
        <div
          ref={barRef}
          role="presentation"
          className="h-5 cursor-copy rounded-md shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
          style={{ background: css }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) add(offsetAt(e.clientX));
          }}
        />
        {stops.map((s, i) => (
          <button
            key={i}
            ref={(el) => {
              handleRefs.current[i] = el;
            }}
            type="button"
            aria-label={`Stop ${i + 1} at ${Math.round(s.offset * 100)}%`}
            aria-pressed={i === cur}
            className={cx(
              "absolute top-[-3px] h-[26px] w-3 -translate-x-1/2 cursor-ew-resize touch-none rounded-[4px] border-2 shadow-sm",
              i === cur ? "border-accent-500" : "border-white",
            )}
            style={{ left: `${s.offset * 100}%`, background: s.color }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setSel(i);
              drag.current = { index: i };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              d.index = move(d.index, offsetAt(e.clientX));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.1 : 0.01;
              const arrow = e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown";
              const del = e.key === "Delete" || e.key === "Backspace";
              // These keys belong to the handle: keep them from the editor's shortcuts (which
              // would delete or nudge the selected elements). Escape still bubbles to close the popover.
              if (arrow || del) {
                e.preventDefault();
                e.stopPropagation();
              }
              if (arrow) {
                const ni = move(i, s.offset + (e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : step));
                if (ni !== i) focusTo.current = ni;
              } else if (del && stops.length > 2) {
                onChange(removeStop(stops, i));
                setSel(Math.max(0, i - 1));
                focusTo.current = Math.max(0, i - 1);
              }
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="tabular-nums">
          Stop {cur + 1} · {Math.round((stops[cur]?.offset ?? 0) * 100)}%
        </span>
        <span className="flex items-center gap-0.5">
          <ColorInput
            title={`Stop ${cur + 1} color`}
            value={stops[cur]?.color ?? "#000000"}
            onChange={(v) => onChange(stops.map((s, i) => (i === cur ? { ...s, color: v } : s)))}
          />
          <button
            type="button"
            aria-label="Add stop"
            title="Add stop"
            disabled={stops.length >= 32}
            onClick={() => add(stopToAdd(stops))}
            className="rounded-md px-1.5 py-1 text-ink-600 hover:bg-ink-100 disabled:opacity-35"
          >
            Add
          </button>
          <button
            type="button"
            disabled={stops.length <= 2}
            onClick={() => {
              onChange(removeStop(stops, cur));
              setSel(Math.max(0, cur - 1));
            }}
            className="rounded-md px-1.5 py-1 text-ink-600 hover:bg-ink-100 disabled:opacity-35"
          >
            Remove
          </button>
        </span>
      </div>
    </div>
  );
}
