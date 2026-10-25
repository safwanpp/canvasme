"use client";

import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Baseline,
  Blend,
  Bold,
  Copy,
  Group as GroupIcon,
  Italic,
  Layers,
  Lock,
  Minus,
  MoveRight,
  Plus,
  Trash2,
  Underline,
  Ungroup,
  Unlock,
} from "lucide-react";
import { ensureFont } from "@/lib/fonts";
import type { Element } from "@/lib/model";
import { currentPage, useEditor } from "@/store/editor";
import { ColorInput, Divider, IconButton, Popover, Slider } from "../ui";
import { FontPicker } from "./FontPicker";

type AlignTarget = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

export function ContextToolbar() {
  const page = useEditor(currentPage);
  const selected = useEditor((s) => s.selected);
  const design = useEditor((s) => s.design);
  const st = useEditor.getState();
  if (!page || !design) return <Bar>{null}</Bar>;

  const els = page.elements.filter((e) => selected.includes(e.id));
  const ids = els.map((e) => e.id);
  const upd = (patch: Partial<Element>, key?: string) =>
    st.update(ids, patch, key ? { coalesce: `${key}:${ids.join()}` } : undefined);

  if (!els.length) {
    return (
      <Bar>
        <span className="pl-1 text-xs text-ink-500">Background</span>
        <ColorInput
          title="Page background"
          value={page.background}
          onChange={(v) =>
            st.mutate(
              (d) => {
                const p = d.pages.find((pp) => pp.id === page.id);
                if (p) p.background = v;
              },
              { coalesce: `bg:${page.id}` },
            )
          }
        />
        <Divider />
        <span className="font-mono text-xs text-ink-500">
          {design.width} × {design.height} px
        </span>
      </Bar>
    );
  }

  const first = els[0];
  const allType = (t: Element["type"]) => els.every((e) => e.type === t);
  const locked = els.every((e) => e.locked);
  const grouped = els.some((e) => e.groupId);
  const sameGroup = grouped && els.every((e) => e.groupId && e.groupId === first.groupId);

  // Align the selection's bounding box to the page, keeping relative positions.
  const alignToPage = (where: AlignTarget) => {
    const x0 = Math.min(...els.map((e) => e.x));
    const y0 = Math.min(...els.map((e) => e.y));
    const x1 = Math.max(...els.map((e) => e.x + e.width));
    const y1 = Math.max(...els.map((e) => e.y + e.height));
    let dx = 0;
    let dy = 0;
    if (where === "left") dx = -x0;
    if (where === "hcenter") dx = (design.width - (x1 - x0)) / 2 - x0;
    if (where === "right") dx = design.width - x1;
    if (where === "top") dy = -y0;
    if (where === "vcenter") dy = (design.height - (y1 - y0)) / 2 - y0;
    if (where === "bottom") dy = design.height - y1;
    st.update(ids, (e) => ({ x: e.x + dx, y: e.y + dy }));
  };

  const bumpFont = (delta: number) =>
    st.update(ids, (e) => (e.type === "text" ? { fontSize: Math.max(1, e.fontSize + delta) } : {}), { coalesce: "fs" });

  return (
    <Bar>
      {allType("text") && first.type === "text" && (
        <>
          <FontPicker
            value={first.fontFamily}
            onChange={(family) => {
              void ensureFont(family);
              upd({ fontFamily: family });
            }}
          />
          <div className="flex shrink-0 items-center rounded-md border border-ink-200">
            <IconButton title="Decrease font size" onClick={() => bumpFont(-1)}>
              <Minus size={14} />
            </IconButton>
            <input
              aria-label="Font size"
              type="number"
              min={1}
              value={Math.round(first.fontSize)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) upd({ fontSize: v }, "fs");
              }}
              className="h-8 w-12 bg-transparent text-center text-sm tabular-nums outline-none"
            />
            <IconButton title="Increase font size" onClick={() => bumpFont(1)}>
              <Plus size={14} />
            </IconButton>
          </div>
          <ColorInput title="Text color" value={first.fill} onChange={(v) => upd({ fill: v }, "fill")} />
          <IconButton title="Bold" active={first.bold} onClick={() => upd({ bold: !first.bold })}>
            <Bold size={16} />
          </IconButton>
          <IconButton title="Italic" active={first.italic} onClick={() => upd({ italic: !first.italic })}>
            <Italic size={16} />
          </IconButton>
          <IconButton title="Underline" active={first.underline} onClick={() => upd({ underline: !first.underline })}>
            <Underline size={16} />
          </IconButton>
          <IconButton
            title={`Alignment: ${first.align}`}
            onClick={() => upd({ align: ({ left: "center", center: "right", right: "left" } as const)[first.align] })}
          >
            {first.align === "left" ? (
              <AlignLeft size={16} />
            ) : first.align === "center" ? (
              <AlignCenter size={16} />
            ) : (
              <AlignRight size={16} />
            )}
          </IconButton>
          <Popover title="Spacing" trigger={<Baseline size={16} />}>
            <div className="w-56">
              <Slider
                label="Letter spacing"
                value={first.letterSpacing}
                min={-10}
                max={50}
                step={0.5}
                format={(v) => v.toFixed(1)}
                onChange={(v) => upd({ letterSpacing: v }, "ls")}
              />
              <Slider
                label="Line height"
                value={first.lineHeight}
                min={0.5}
                max={3}
                step={0.05}
                format={(v) => v.toFixed(2)}
                onChange={(v) => upd({ lineHeight: v }, "lh")}
              />
            </div>
          </Popover>
          <Divider />
        </>
      )}

      {allType("shape") && first.type === "shape" && (
        <>
          <ColorInput title="Fill color" value={first.fill} onChange={(v) => upd({ fill: v }, "fill")} />
          <Popover
            title="Border"
            trigger={
              <span
                className="h-4 w-4 rounded-sm border-2"
                style={{ borderColor: first.strokeWidth ? first.stroke : "#94a3b8" }}
              />
            }
          >
            <div className="w-56">
              <div className="mb-1 flex items-center justify-between text-xs text-ink-600">
                Border color
                <ColorInput title="Border color" value={first.stroke} onChange={(v) => upd({ stroke: v }, "stroke")} />
              </div>
              <Slider label="Border weight" value={first.strokeWidth} min={0} max={100} onChange={(v) => upd({ strokeWidth: v }, "sw")} />
              {first.shape === "rect" && (
                <Slider
                  label="Corner rounding"
                  value={first.cornerRadius}
                  min={0}
                  max={Math.min(first.width, first.height) / 2}
                  onChange={(v) => upd({ cornerRadius: v }, "cr")}
                />
              )}
            </div>
          </Popover>
          <Divider />
        </>
      )}

      {allType("line") && first.type === "line" && (
        <>
          <ColorInput title="Line color" value={first.stroke} onChange={(v) => upd({ stroke: v }, "stroke")} />
          <Popover title="Line style" trigger={<Minus size={16} />}>
            <div className="w-56">
              <Slider label="Line weight" value={first.strokeWidth} min={1} max={100} onChange={(v) => upd({ strokeWidth: v }, "sw")} />
              <label className="mt-2 flex items-center gap-2 text-xs text-ink-700">
                <input type="checkbox" checked={first.dashed} onChange={(e) => upd({ dashed: e.target.checked })} /> Dashed
              </label>
            </div>
          </Popover>
          <IconButton title="Arrow end" active={first.arrowEnd} onClick={() => upd({ arrowEnd: !first.arrowEnd })}>
            <MoveRight size={16} />
          </IconButton>
          <Divider />
        </>
      )}

      {allType("path") && first.type === "path" && (
        <>
          <ColorInput title="Drawing color" value={first.stroke} onChange={(v) => upd({ stroke: v }, "stroke")} />
          <Popover title="Thickness" trigger={<Minus size={16} />}>
            <div className="w-56">
              <Slider label="Thickness" value={first.strokeWidth} min={1} max={100} onChange={(v) => upd({ strokeWidth: v }, "sw")} />
            </div>
          </Popover>
          <Divider />
        </>
      )}

      {allType("image") && first.type === "image" && (
        <>
          <Popover title="Corner rounding" trigger={<span className="h-4 w-4 rounded-md border-2 border-ink-500" />}>
            <div className="w-56">
              <Slider
                label="Corner rounding"
                value={first.cornerRadius}
                min={0}
                max={Math.min(first.width, first.height) / 2}
                onChange={(v) => upd({ cornerRadius: v }, "cr")}
              />
            </div>
          </Popover>
          <Divider />
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
        <Popover title="Transparency" align="right" trigger={<Blend size={16} />}>
          <div className="w-56">
            <Slider
              label="Transparency"
              value={Math.round(first.opacity * 100)}
              min={0}
              max={100}
              format={(v) => `${v}%`}
              onChange={(v) => upd({ opacity: v / 100 }, "op")}
            />
          </div>
        </Popover>
        <Popover
          title="Position"
          align="right"
          trigger={
            <>
              <Layers size={16} />
              <span className="text-xs">Position</span>
            </>
          }
        >
          <div className="w-60 text-xs text-ink-600">
            <p className="mb-1 font-medium text-ink-900">Layer</p>
            <div className="grid grid-cols-2 gap-1">
              <Row icon={<ArrowUp size={14} />} label="Forward" onClick={() => st.reorder(ids, "up")} />
              <Row icon={<ArrowDown size={14} />} label="Backward" onClick={() => st.reorder(ids, "down")} />
              <Row icon={<ArrowUpToLine size={14} />} label="To front" onClick={() => st.reorder(ids, "top")} />
              <Row icon={<ArrowDownToLine size={14} />} label="To back" onClick={() => st.reorder(ids, "bottom")} />
            </div>
            <p className="mb-1 mt-3 font-medium text-ink-900">Align to page</p>
            <div className="grid grid-cols-2 gap-1">
              <Row icon={<AlignStartVertical size={14} />} label="Left" onClick={() => alignToPage("left")} />
              <Row icon={<AlignStartHorizontal size={14} />} label="Top" onClick={() => alignToPage("top")} />
              <Row icon={<AlignCenterVertical size={14} />} label="Center" onClick={() => alignToPage("hcenter")} />
              <Row icon={<AlignCenterHorizontal size={14} />} label="Middle" onClick={() => alignToPage("vcenter")} />
              <Row icon={<AlignEndVertical size={14} />} label="Right" onClick={() => alignToPage("right")} />
              <Row icon={<AlignEndHorizontal size={14} />} label="Bottom" onClick={() => alignToPage("bottom")} />
            </div>
          </div>
        </Popover>
        {els.length > 1 && !sameGroup && (
          <IconButton title="Group (Ctrl+G)" onClick={() => st.group(ids)}>
            <GroupIcon size={16} />
          </IconButton>
        )}
        {grouped && (
          <IconButton title="Ungroup (Ctrl+Shift+G)" onClick={() => st.ungroup(ids)}>
            <Ungroup size={16} />
          </IconButton>
        )}
        <IconButton title={locked ? "Unlock" : "Lock"} active={locked} onClick={() => upd({ locked: !locked })}>
          {locked ? <Lock size={16} /> : <Unlock size={16} />}
        </IconButton>
        <IconButton title="Duplicate (Ctrl+D or Alt+C)" onClick={() => st.duplicate(ids)}>
          <Copy size={16} />
        </IconButton>
        <IconButton title="Delete" disabled={locked} onClick={() => st.remove(ids)}>
          <Trash2 size={16} />
        </IconButton>
      </div>
    </Bar>
  );
}

function Bar({ children }: { children: React.ReactNode }) {
  return <div className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-ink-200 bg-surface px-2 [scrollbar-width:none] md:px-3 [&::-webkit-scrollbar]:hidden">
      {children}
    </div>;
}

function Row({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-ink-100">
      {icon}
      {label}
    </button>
  );
}
