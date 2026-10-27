"use client";

import {
  Brush,
  Circle,
  Eraser,
  Hexagon,
  Highlighter,
  MousePointer2,
  Pen,
  Pencil,
  Shapes,
  Slash,
  Square,
  Star,
  StickyNote,
  Triangle,
  Type,
  X,
} from "lucide-react";
import type { ShapeKind } from "@/lib/model";
import { useEditor } from "@/store/editor";
import { type PenKind, type Tool, useView } from "@/store/view";
import { ColorInput, cx, Slider } from "../ui";

const TOOLS: { id: Tool; label: string; key?: string; icon: React.ReactNode }[] = [
  { id: "select", label: "Select", key: "V", icon: <MousePointer2 size={20} /> },
  { id: "draw", label: "Draw", key: "P", icon: <Pencil size={20} /> },
  { id: "shape", label: "Shape", key: "R", icon: <Shapes size={20} /> },
  { id: "line", label: "Line", key: "L", icon: <Slash size={20} /> },
  { id: "sticky", label: "Sticky note", icon: <StickyNote size={20} /> },
  { id: "text", label: "Text", icon: <Type size={20} /> },
];

const PENS: { id: PenKind; label: string; size: number; icon: React.ReactNode }[] = [
  { id: "pen", label: "Pen", size: 4, icon: <Pen size={18} /> },
  { id: "marker", label: "Marker", size: 10, icon: <Brush size={18} /> },
  { id: "highlighter", label: "Highlighter", size: 24, icon: <Highlighter size={18} /> },
];

const SHAPES: { id: ShapeKind; label: string; icon: React.ReactNode }[] = [
  { id: "rect", label: "Square", icon: <Square size={18} /> },
  { id: "ellipse", label: "Circle", icon: <Circle size={18} /> },
  { id: "triangle", label: "Triangle", icon: <Triangle size={18} /> },
  { id: "star", label: "Star", icon: <Star size={18} /> },
  { id: "hexagon", label: "Hexagon", icon: <Hexagon size={18} /> },
];

const SWATCHES = ["#111827", "#ffffff", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6"];

/** Switch tools; anything but Select clears the selection so handles don't sit under the pen. */
export function setTool(tool: Tool) {
  useView.getState().set({ tool });
  if (tool !== "select") useEditor.getState().select([]);
}

const toolButton = (active: boolean) =>
  cx(
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-ink-700 transition-colors hover:bg-ink-100 active:scale-[0.96]",
    active && "bg-accent-50 text-accent-600 hover:bg-accent-50",
  );

/**
 * Floating tool strip beside the rail (desktop) or above the tab bar (phone),
 * with a flyout for the Draw and Shape options.
 */
export function ToolStrip({ mobile, onClose }: { mobile: boolean; onClose: () => void }) {
  const tool = useView((s) => s.tool);
  const pen = useView((s) => s.pen);
  const shapeKind = useView((s) => s.shapeKind);
  const set = useView((s) => s.set);
  const drawing = tool === "draw" || tool === "eraser";

  const card = "rounded-[var(--radius-core)] bg-surface p-1.5 shadow-[var(--shadow-hairline),var(--shadow-soft)]";

  return (
    <div
      className={cx(
        "absolute z-40 flex gap-2",
        mobile
          ? "bottom-full left-1/2 mb-3 -translate-x-1/2 flex-col-reverse items-center"
          : "left-full top-1/2 ml-3 -translate-y-1/2 items-center",
      )}
    >
      <div className={cx("flex items-center gap-2", mobile ? "flex-row" : "flex-col")}>
        {!mobile && (
          <button
            title="Close tools"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-600 shadow-[var(--shadow-hairline),var(--shadow-soft)] hover:text-ink-900"
          >
            <X size={18} />
          </button>
        )}
        <div role="toolbar" aria-label="Tools" className={cx(card, "flex gap-1", mobile ? "flex-row" : "flex-col")}>
          {TOOLS.map((t) => {
            const active = t.id === "draw" ? drawing : tool === t.id;
            return (
              <button
                key={t.id}
                title={t.key ? `${t.label} (${t.key})` : t.label}
                aria-label={t.label}
                aria-pressed={active}
                onClick={() => setTool(t.id === "draw" && tool === "eraser" ? "eraser" : t.id)}
                className={toolButton(active)}
              >
                {t.icon}
              </button>
            );
          })}
        </div>
      </div>

      {drawing && (
        <div className={cx(card, "w-60 p-3")}>
          <div className="flex gap-1">
            {PENS.map((p) => (
              <button
                key={p.id}
                title={p.label}
                aria-pressed={tool === "draw" && pen.kind === p.id}
                onClick={() => {
                  set({ pen: { ...pen, kind: p.id, size: pen.kind === p.id ? pen.size : p.size } });
                  setTool("draw");
                }}
                className={cx(toolButton(tool === "draw" && pen.kind === p.id), "h-10 flex-1")}
              >
                {p.icon}
              </button>
            ))}
            <button
              title="Eraser (E)"
              aria-pressed={tool === "eraser"}
              onClick={() => setTool("eraser")}
              className={cx(toolButton(tool === "eraser"), "h-10 flex-1")}
            >
              <Eraser size={18} />
            </button>
          </div>
          {tool === "eraser" ? (
            <p className="mt-3 text-xs leading-relaxed text-ink-500">Drag over a drawing to erase it.</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    title={c}
                    aria-label={`Color ${c}`}
                    onClick={() => set({ pen: { ...pen, color: c } })}
                    className={cx(
                      "h-6 w-6 rounded-full shadow-[inset_0_0_0_1px_rgba(14,21,48,0.15)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)]",
                      pen.color.toLowerCase() === c && "ring-2 ring-accent-500 ring-offset-2 ring-offset-surface",
                    )}
                    style={{ background: c }}
                  />
                ))}
                <ColorInput title="Custom color" value={pen.color} onChange={(c) => set({ pen: { ...pen, color: c } })} />
              </div>
              <div className="mt-2">
                <Slider label="Size" value={pen.size} min={1} max={60} onChange={(size) => set({ pen: { ...pen, size } })} />
              </div>
            </>
          )}
        </div>
      )}

      {tool === "shape" && (
        <div className={cx(card, "p-2")}>
          <div className="flex gap-1">
            {SHAPES.map((s) => (
              <button
                key={s.id}
                title={s.label}
                aria-pressed={shapeKind === s.id}
                onClick={() => set({ shapeKind: s.id })}
                className={cx(toolButton(shapeKind === s.id), "h-10 w-10")}
              >
                {s.icon}
              </button>
            ))}
          </div>
          <p className="mt-1.5 px-1 text-xs text-ink-500">Drag on the page to draw it.</p>
        </div>
      )}
    </div>
  );
}
