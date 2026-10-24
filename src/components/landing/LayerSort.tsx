"use client";

import { Image as ImageIcon, Square, Star, Type } from "lucide-react";
import { memo, useEffect, useState } from "react";

const ROWS = [
  { id: "heading", label: "SUNDAY MARKET", icon: Type },
  { id: "star", label: "Star", icon: Star },
  { id: "photo", label: "Honey jar photo", icon: ImageIcon },
  { id: "badge", label: "Rounded badge", icon: Square },
];

const ROW_H = 44;

/** A tiny layers panel that keeps reordering itself, like someone arranging a design. */
function LayerSortImpl() {
  const [order, setOrder] = useState(ROWS.map((r) => r.id));

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      setOrder((o) => {
        // Bring a different layer to the front each tick.
        const next = [...o];
        const [moved] = next.splice(next.length - 1, 1);
        next.unshift(moved);
        return next;
      });
    }, 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="relative w-full max-w-[280px]" style={{ height: ROWS.length * ROW_H }} aria-hidden>
      {ROWS.map(({ id, label, icon: Icon }) => {
        const i = order.indexOf(id);
        return (
          <div
            key={id}
            className="absolute inset-x-0 flex h-[38px] items-center gap-3 rounded-[12px] bg-surface px-3 text-sm text-ink-800 shadow-[var(--shadow-hairline)] transition-[transform,box-shadow] duration-700 ease-[var(--ease-spring)]"
            style={{
              transform: `translateY(${i * ROW_H}px)`,
              boxShadow: i === 0 ? "inset 0 0 0 1.5px var(--color-accent-500)" : undefined,
            }}
          >
            <Icon size={15} className={i === 0 ? "text-accent-500" : "text-ink-400"} />
            <span className="truncate">{label}</span>
            <span className="ml-auto font-mono text-[11px] text-ink-400">{ROWS.length - i}</span>
          </div>
        );
      })}
    </div>
  );
}

export const LayerSort = memo(LayerSortImpl);
