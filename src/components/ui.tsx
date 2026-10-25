"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";

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
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="block py-1 text-xs text-ink-600">
      <span className="flex justify-between">
        {label}
        <span className="tabular-nums text-ink-900">{format(value)}</span>
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
