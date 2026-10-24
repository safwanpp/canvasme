"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

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
        "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-sm text-ink-700 transition-colors",
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
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      <IconButton title={title} active={open} onClick={() => setOpen((o) => !o)} className={triggerClassName}>
        {trigger}
      </IconButton>
      {open && (
        <div
          className={cx(
            "absolute z-50 min-w-48 rounded-xl border border-ink-200 bg-white p-3 shadow-xl",
            side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
            align === "left" ? "left-0" : "right-0",
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
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
