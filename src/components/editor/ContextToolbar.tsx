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
  Check,
  Copy,
  CornerLeftDown,
  Crop,
  Eraser,
  ImageDown,
  Paintbrush,
  RotateCcw,
  Sparkles,
  Group as GroupIcon,
  Italic,
  Layers,
  Lock,
  Minus,
  MoveRight,
  Plus,
  SquaresIntersect,
  SquaresSubtract,
  Trash2,
  Underline,
  Ungroup,
  Loader2,
  Unlock,
  WandSparkles,
} from "lucide-react";
import { ensureFont } from "@/lib/fonts";
import { pageSize, type Element, type TextElement } from "@/lib/model";
import { applyToWholeBox, bumpFontSize, mixedField } from "@/lib/richText";
import { clipIds, coveredElements, releaseClipIds, selectedGroups } from "@/lib/tree";
import { currentPage, lockedIds, useEditor } from "@/store/editor";
import { ColorInput, cx, Divider, IconButton, Popover, Select, Slider } from "../ui";
import type { BlendMode } from "@/lib/effects";
import { commonValue, hasEffects } from "@/lib/effectEdit";
import { downloadPercent, MODEL_SIZE_MB, modelDownloaded } from "@/lib/bgRemove";
import { uncrop } from "@/lib/crop";
import { useView } from "@/store/view";
import { useState } from "react";
import { canRasterize, rasterizeElements, removeImageBackground } from "./actions";
import { BLEND_GROUP_OPTIONS, EffectsPanel } from "./EffectsPanel";
import { finishErase } from "./EraseEditor";
import { FontPicker } from "./FontPicker";
import { VectorControls } from "./VectorControls";
import { AdjustmentIcon, AdjustmentPanel, FiltersIcon, FiltersPanel } from "./AdjustmentPanel";
import { ADJUSTMENT_LABELS } from "@/lib/adjustments";

type AlignTarget = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

export function ContextToolbar() {
  const page = useEditor(currentPage);
  const selected = useEditor((s) => s.selected);
  const design = useEditor((s) => s.design);
  const maskEditId = useView((s) => s.maskEditId);
  const cropEditId = useView((s) => s.cropEditId);
  const eraseEditId = useView((s) => s.eraseEditId);
  // With one group's members selected: edit a group itself (its id) or each member. The choice
  // belongs to the selection's outermost group and starts over when that changes.
  const [scopeState, setScopeState] = useState<{ for: string | null; pick: string }>({ for: null, pick: "" });
  const st = useEditor.getState();
  if (!page || !design) return <Bar>{null}</Bar>;
  const size = pageSize(design, page);

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
          {size.width} × {size.height} px
        </span>
      </Bar>
    );
  }

  const first = els[0];
  const allType = (t: Element["type"]) => els.every((e) => e.type === t);
  const lockedSet = lockedIds(page.elements);
  const locked = els.every((e) => lockedSet.has(e.id));
  const selGroups = selectedGroups(page.elements, ids);
  const outer = selGroups[0] ?? null;
  const outerId = outer?.id ?? null;
  // Another group (or none): start over at its outermost group (state adjusted while rendering).
  if (scopeState.for !== outerId) setScopeState({ for: outerId, pick: outerId ?? "" });
  const pick = scopeState.for === outerId ? scopeState.pick : outerId;
  const setScope = (p: string) => setScopeState({ for: outerId, pick: p });
  const selGroup = selGroups.find((g) => g.id === pick) ?? null;
  // Ungroup when the selection wholly covers a group; Group unless it is exactly one group already.
  // Neither touches a locked group or a locked layer (the store refuses those too).
  const canUngroup = coveredElements(page.elements, ids).some((e) => e.type === "group" && !lockedSet.has(e.id));
  const canGroup = els.filter((e) => !lockedSet.has(e.id)).length > 1 && !outer;
  // Opacity, blend and effects go to the picked group itself in Group scope.
  const groupScope = !!selGroup;
  // A group holding only another group offers each of them, by name.
  const scopeOptions = [
    ...selGroups.map((g) => {
      const name = g.name || "Group";
      const many = selGroups.length > 1;
      return {
        key: g.id,
        label: many ? name : "Group",
        title: `Opacity, blend and effects apply to ${many ? `the group “${name}”` : "the group"} as a whole`,
      };
    }),
    { key: "each", label: "Each layer", title: "Opacity, blend and effects apply to each layer" },
  ];
  const fxEls: Element[] = selGroup ? [selGroup] : els;
  const fxIds = fxEls.map((e) => e.id);
  const fxFirst = fxEls[0];
  const updFx = (patch: Partial<Element>, key?: string) =>
    st.update(fxIds, patch, key ? { coalesce: `${key}:${fxIds.join()}` } : undefined);
  // An image and a shape can be clipped together; a masked image can be released.
  const clipPair =
    els.length === 2 && !els.some((e) => lockedSet.has(e.id))
      ? { image: els.find((e) => e.type === "image" && !e.mask && !e.vectorMask), shape: els.find((e) => e.type === "shape") }
      : null;
  const masked = els.length === 1 && first.type === "image" && first.mask ? first : null;
  // Crop and Erase work on one image without a mask (Adjust does the cropping inside a mask).
  const plain = els.length === 1 && first.type === "image" && !first.mask && !lockedSet.has(first.id) ? first : null;
  const cropping = plain && cropEditId === plain.id ? plain : null;
  const erasing = els.length === 1 && eraseEditId === first.id;
  const fxOn = fxEls.some(hasEffects);
  // Clip to the layer below (Photoshop clipping), or release: what the store would do (locks respected).
  const free = ids.filter((id) => !lockedSet.has(id));
  const canClip = clipIds(page.elements, free) !== page.elements;
  const canRelease = !canClip && releaseClipIds(page.elements, free) !== page.elements;

  // Align the selection's bounding box to the page, keeping relative positions.
  const alignToPage = (where: AlignTarget) => {
    const x0 = Math.min(...els.map((e) => e.x));
    const y0 = Math.min(...els.map((e) => e.y));
    const x1 = Math.max(...els.map((e) => e.x + e.width));
    const y1 = Math.max(...els.map((e) => e.y + e.height));
    let dx = 0;
    let dy = 0;
    if (where === "left") dx = -x0;
    if (where === "hcenter") dx = (size.width - (x1 - x0)) / 2 - x0;
    if (where === "right") dx = size.width - x1;
    if (where === "top") dy = -y0;
    if (where === "vcenter") dy = (size.height - (y1 - y0)) / 2 - y0;
    if (where === "bottom") dy = size.height - y1;
    st.update(ids, (e) => ({ x: e.x + dx, y: e.y + dy }));
  };

  const bumpFont = (delta: number) => st.update(ids, (e) => (e.type === "text" ? bumpFontSize(e, delta) : {}), { coalesce: "fs" });
  // Text edits apply to the whole box: style runs forget the property (rich text, richText.ts).
  const updText = (patch: Partial<TextElement>, key?: string) =>
    st.update(ids, (e) => (e.type === "text" ? applyToWholeBox(e, patch) : {}), key ? { coalesce: `${key}:${ids.join()}` } : undefined);
  const mixed = (k: Parameters<typeof mixedField>[1]) => els.some((e) => e.type === "text" && mixedField(e, k));

  return (
    <Bar>
      {allType("text") && first.type === "text" && (
        <>
          <FontPicker
            value={first.fontFamily}
            mixed={mixed("fontFamily")}
            onChange={(family) => {
              void ensureFont(family);
              updText({ fontFamily: family });
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
              value={mixed("fontSize") ? "" : Math.round(first.fontSize)}
              placeholder={mixed("fontSize") ? "Mixed" : undefined}
              title={mixed("fontSize") ? "Mixed sizes: + and − change every size, a number sets them all" : undefined}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) updText({ fontSize: v }, "fs");
              }}
              className="h-8 w-12 bg-transparent text-center text-sm tabular-nums outline-none"
            />
            <IconButton title="Increase font size" onClick={() => bumpFont(1)}>
              <Plus size={14} />
            </IconButton>
          </div>
          <ColorInput title="Text color" value={first.fill} onChange={(v) => updText({ fill: v }, "fill")} />
          <IconButton title="Bold" active={first.bold && !mixed("bold")} onClick={() => updText({ bold: !first.bold || mixed("bold") })}>
            <Bold size={16} />
          </IconButton>
          <IconButton title="Italic" active={first.italic && !mixed("italic")} onClick={() => updText({ italic: !first.italic || mixed("italic") })}>
            <Italic size={16} />
          </IconButton>
          <IconButton
            title="Underline"
            active={first.underline && !mixed("underline")}
            onClick={() => updText({ underline: !first.underline || mixed("underline") })}
          >
            <Underline size={16} />
          </IconButton>
          <IconButton
            title={`Alignment: ${first.align}`}
            onClick={() => updText({ align: ({ left: "center", center: "right", right: "left" } as const)[first.align] })}
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
                onChange={(v) => updText({ letterSpacing: v }, "ls")}
              />
              <Slider
                label="Line height"
                value={first.lineHeight}
                min={0.5}
                max={3}
                step={0.05}
                format={(v) => v.toFixed(2)}
                onChange={(v) => updText({ lineHeight: v }, "lh")}
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

      {allType("vector") && first.type === "vector" && <VectorControls first={first} upd={upd} />}

      {els.length === 1 && first.type === "adjustment" && (
        <>
          <Popover
            title="Adjustment settings"
            trigger={
              <>
                <AdjustmentIcon type={first.adjustment.type} size={16} />
                <span className="text-xs">{ADJUSTMENT_LABELS[first.adjustment.type]}</span>
              </>
            }
          >
            <div className="max-h-[70vh] overflow-y-auto">
              <AdjustmentPanel el={first} />
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

      {cropping && (
        <>
          <span className="pl-1 text-xs font-medium text-ink-700">Crop</span>
          <IconButton title="Show the whole image" disabled={!cropping.crop} onClick={() => st.update(ids, uncrop(cropping))}>
            <RotateCcw size={16} />
            <span className="text-xs">Reset</span>
          </IconButton>
          <IconButton title="Done cropping (Enter)" active onClick={() => useView.getState().set({ cropEditId: null })}>
            <Check size={16} />
            <span className="text-xs">Done</span>
          </IconButton>
          <Divider />
        </>
      )}

      {erasing && <EraseBar />}

      {allType("image") && first.type === "image" && !cropping && !erasing && (
        <>
          {els.length === 1 && <BgRemover elId={first.id} />}
          {plain && (
            <>
              <IconButton title="Crop (double-click)" onClick={() => useView.getState().set({ cropEditId: plain.id })}>
                <Crop size={16} />
                <span className="text-xs">Crop</span>
              </IconButton>
              <IconButton title="Erase parts of the image" onClick={() => useView.getState().set({ eraseEditId: plain.id })}>
                <Eraser size={16} />
                <span className="text-xs">Erase</span>
              </IconButton>
            </>
          )}
          {masked ? (
            <IconButton
              title={maskEditId === masked.id ? "Done adjusting the image" : "Adjust image in mask (double-click)"}
              active={maskEditId === masked.id}
              disabled={lockedSet.has(masked.id)}
              onClick={() => useView.getState().set({ maskEditId: maskEditId === masked.id ? null : masked.id })}
            >
              <Crop size={16} />
              <span className="text-xs">{maskEditId === masked.id ? "Done" : "Adjust"}</span>
            </IconButton>
          ) : (
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
          )}
          <Divider />
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
        {outer && (
          <div role="radiogroup" aria-label="Edit the group or each layer" className="mr-1 flex rounded-full bg-ink-100 p-0.5 text-xs">
            {scopeOptions.map((o) => (
              <button
                key={o.key}
                role="radio"
                aria-checked={(pick ?? "each") === o.key}
                title={o.title}
                onClick={() => setScope(o.key)}
                className={cx("max-w-24 truncate rounded-full px-2 py-0.5", (pick ?? "each") === o.key ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500")}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        {!groupScope && !els.some((e) => e.type === "adjustment") && (
          <Popover title="Filters" align="right" trigger={<FiltersIcon size={16} />} triggerClassName={els.some((e) => e.filters?.length) ? "text-accent-600" : undefined}>
            <div className="max-h-[70vh] overflow-y-auto">
              <FiltersPanel els={els} />
            </div>
          </Popover>
        )}
        {!allType("adjustment") && (
        <Popover title="Effects" align="right" trigger={<Sparkles size={16} />} triggerClassName={fxOn ? "text-accent-600" : undefined}>
          <div className="max-h-[70vh] overflow-y-auto">
            <EffectsPanel ids={fxIds} />
          </div>
        </Popover>
        )}
        <Popover title="Transparency and blending" align="right" trigger={<Blend size={16} />}>
          <div className="w-60">
            <Slider
              label={groupScope ? "Group transparency" : "Transparency"}
              value={Math.round(fxFirst.opacity * 100)}
              min={0}
              max={100}
              format={(v) => `${v}%`}
              mixed={commonValue(fxEls, (e) => e.opacity) === "mixed"}
              onChange={(v) => updFx({ opacity: v / 100 }, "op")}
            />
            {groupScope ? (
              <p className="pb-1 text-[11px] leading-snug text-ink-400">The group is faded and blended as one layer.</p>
            ) : (
              <>
                <Slider
                  label="Fill"
                  value={Math.round((first.fillOpacity ?? 1) * 100)}
                  min={0}
                  max={100}
                  format={(v) => `${v}%`}
                  mixed={commonValue(els, (e) => e.fillOpacity ?? 1) === "mixed"}
                  onChange={(v) => upd({ fillOpacity: v === 100 ? undefined : v / 100 }, "fillop")}
                />
                <p className="pb-1 text-[11px] leading-snug text-ink-400">Fill fades the content but keeps its effects.</p>
              </>
            )}
            {groupScope ? (
              <Select<BlendMode>
                label="Blend mode"
                value={selGroup.blendMode ?? "pass-through"}
                groups={[{ label: "Group", options: [{ value: "pass-through", label: "Pass through" }] }, ...BLEND_GROUP_OPTIONS]}
                onChange={(v) => updFx({ blendMode: v === "pass-through" ? undefined : v })}
              />
            ) : (
              <Select<BlendMode>
                label="Blend mode"
                value={first.blendMode ?? "normal"}
                groups={BLEND_GROUP_OPTIONS}
                mixed={commonValue(els, (e) => e.blendMode ?? "normal") === "mixed"}
                onChange={(v) => upd({ blendMode: v === "normal" ? undefined : v })}
              />
            )}
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
        {!cropping && !erasing && canRasterize(els, lockedSet) && <RasterizeButton ids={ids} />}
        {clipPair?.image && clipPair.shape && (
          <IconButton title="Clip image to shape" onClick={() => st.clipToShape(clipPair.image!.id, clipPair.shape!.id)}>
            <SquaresIntersect size={16} />
            <span className="text-xs">Mask</span>
          </IconButton>
        )}
        {masked && (
          <IconButton title="Release clipping mask" disabled={lockedSet.has(masked.id)} onClick={() => st.releaseMask(masked.id)}>
            <SquaresSubtract size={16} />
            <span className="text-xs">Release</span>
          </IconButton>
        )}
        {els.length === 1 && first.vectorMask && (
          <IconButton title="Release vector mask (show the whole layer)" disabled={lockedSet.has(first.id)} onClick={() => upd({ vectorMask: undefined })}>
            <SquaresSubtract size={16} />
            <span className="text-xs">Unmask</span>
          </IconButton>
        )}
        {(canClip || canRelease) && (
          <IconButton
            title={canClip ? "Clip to layer below (Alt+Ctrl+G)" : "Release clip (Alt+Ctrl+G)"}
            active={canRelease}
            onClick={() => (canClip ? st.clipToBelow(ids) : st.releaseClip(ids))}
          >
            <CornerLeftDown size={16} />
            <span className="text-xs">{canClip ? "Clip" : "Unclip"}</span>
          </IconButton>
        )}
        {canGroup && (
          <IconButton title="Group (Ctrl+G)" onClick={() => st.group(ids)}>
            <GroupIcon size={16} />
          </IconButton>
        )}
        {canUngroup && (
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

/** "BG Remover": confirm, then cut the background out on this device with progress in the trigger. */
function BgRemover({ elId }: { elId: string }) {
  const job = useView((s) => s.bgJob);
  const mine = job?.elId === elId ? job : null;
  const busy = !!job && !job.error;
  const pct = downloadPercent(mine?.progress);
  const status = mine?.error ? "Retry" : !mine ? "BG Remover" : pct !== null ? `Downloading ${pct}%` : "Removing…";
  const ready = modelDownloaded();
  return (
    <Popover
      title="Remove background"
      trigger={
        <>
          {mine && !mine.error ? <Loader2 size={16} className="animate-spin" /> : <WandSparkles size={16} />}
          <span className="text-xs tabular-nums">{status}</span>
        </>
      }
    >
      {(close) => (
        <div className="w-64 text-sm text-ink-700">
          <p className="font-semibold text-ink-900">Remove background</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            Runs on this device; the image never leaves your browser.
            {!ready && ` The first time downloads a ${MODEL_SIZE_MB} MB model, which is then kept for next time.`}
          </p>
          {mine?.error && <p className="mt-2 text-xs text-[#B23A30]">It didn&apos;t work: {mine.error}</p>}
          <button
            disabled={busy}
            onClick={() => {
              void removeImageBackground(elId);
              close();
            }}
            className="mt-3 w-full rounded-full bg-accent-500 px-3 py-2 text-sm font-semibold text-white shadow-[var(--shadow-cta)] hover:bg-accent-600 disabled:opacity-50"
          >
            {!busy ? "Remove background" : mine ? "Working on it…" : "Busy with another image…"}
          </button>
        </div>
      )}
    </Popover>
  );
}

/** Rasterize: render the selection into one image element. */
function RasterizeButton({ ids }: { ids: string[] }) {
  const [busy, setBusy] = useState(false);
  return (
    <IconButton
      title="Rasterize: turn into one image"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void rasterizeElements(ids).finally(() => setBusy(false));
      }}
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <ImageDown size={16} />}
      <span className="text-xs">Rasterize</span>
    </IconButton>
  );
}

/** Erase mode: Erase or Restore brush, its size and softness, and Done. */
function EraseBar() {
  const brush = useView((s) => s.eraseBrush);
  const setBrush = (p: Partial<typeof brush>) => useView.getState().set({ eraseBrush: { ...brush, ...p } });
  return (
    <>
      <span className="pl-1 text-xs font-medium text-ink-700">Erase</span>
      <IconButton title="Erase brush" active={!brush.restore} onClick={() => setBrush({ restore: false })}>
        <Eraser size={16} />
      </IconButton>
      <IconButton title="Restore brush: paint the original back" active={brush.restore} onClick={() => setBrush({ restore: true })}>
        <Paintbrush size={16} />
      </IconButton>
      <Popover
        title="Brush size and softness"
        trigger={
          <>
            <span className="rounded-full border-2 border-ink-500" style={{ width: 12, height: 12 }} />
            <span className="text-xs tabular-nums">{brush.size}</span>
          </>
        }
      >
        <div className="w-56">
          <Slider label="Brush size" value={brush.size} min={4} max={300} onChange={(v) => setBrush({ size: v })} />
          <Slider
            label="Softness"
            value={Math.round(brush.softness * 100)}
            min={0}
            max={100}
            format={(v) => `${v}%`}
            onChange={(v) => setBrush({ softness: v / 100 })}
          />
        </div>
      </Popover>
      <IconButton title="Done erasing (Enter)" active onClick={() => void finishErase()}>
        <Check size={16} />
        <span className="text-xs">Done</span>
      </IconButton>
      <Divider />
    </>
  );
}
