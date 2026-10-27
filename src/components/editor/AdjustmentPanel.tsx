"use client";

import {
  Aperture,
  ArrowLeftRight,
  Camera,
  ChartColumn,
  Contrast,
  Droplets,
  Eclipse,
  Layers2,
  Palette,
  Plus,
  Rows3,
  Scale,
  SlidersHorizontal,
  Spline,
  SunMedium,
  SwatchBook,
  Trash2,
  Waves,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  ADJUSTMENT_LABELS,
  ADJUSTMENT_TYPES,
  type Adjustment,
  type AdjustmentType,
  defaultAdjustment,
  defaultFilter,
  type Filter,
  FILTER_LABELS,
  type FilterType,
  HUE_RANGE_DEFAULTS,
  type LevelsChannel,
} from "@/lib/adjustments";
import type { AdjustmentElement, Element } from "@/lib/model";
import { useEditor } from "@/store/editor";
import { ColorInput, cx, GradientInput, IconButton, Popover, Select, Slider, Toggle } from "../ui";

// Adjustment layers (add menu, properties) and per-element filters. Every slider drag coalesces
// into one undo step per field.

const ICONS: Record<AdjustmentType, typeof SunMedium> = {
  "brightness-contrast": SunMedium,
  levels: ChartColumn,
  curves: Spline,
  exposure: Aperture,
  vibrance: Droplets,
  "hue-saturation": Palette,
  "color-balance": Scale,
  "black-white": Contrast,
  "photo-filter": Camera,
  "channel-mixer": SlidersHorizontal,
  invert: ArrowLeftRight,
  posterize: Rows3,
  threshold: Eclipse,
  "gradient-map": SwatchBook,
};

/** The toolbar's Filters trigger icon. */
export const FiltersIcon = Waves;

export function AdjustmentIcon({ type, size = 14, className }: { type: AdjustmentType; size?: number; className?: string }) {
  const I = ICONS[type] ?? Layers2;
  return <I size={size} className={className} aria-label={ADJUSTMENT_LABELS[type]} />;
}

/** "Add adjustment" menu: a full-page adjustment layer above the selection (or on top). */
export function AddAdjustmentMenu({ compact }: { compact?: boolean }) {
  return (
    <Popover
      title="Add adjustment layer"
      align="right"
      trigger={
        <>
          <Layers2 size={14} />
          {!compact && <span className="text-xs">Adjust</span>}
        </>
      }
    >
      {(close) => (
        <div className="grid w-60 grid-cols-1 gap-0.5 text-sm" role="menu" aria-label="Adjustment layers">
          <p className="px-2 pb-1 text-[11px] leading-snug text-ink-400">Changes the colours of the layers below it, without touching them.</p>
          {ADJUSTMENT_TYPES.map((t) => (
            <button
              key={t}
              role="menuitem"
              onClick={() => {
                useEditor.getState().addAdjustment(t);
                close();
              }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink-800 hover:bg-ink-100"
            >
              <AdjustmentIcon type={t} />
              {ADJUSTMENT_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

type Change = (next: Adjustment, field: string) => void;

/** The adjustment layer's own settings (toolbar popover). */
export function AdjustmentPanel({ el }: { el: AdjustmentElement }) {
  const st = useEditor.getState();
  const change: Change = (next, field) => st.update([el.id], { adjustment: next } as Partial<Element>, { coalesce: `adj:${field}:${el.id}` });
  return (
    <div className="w-72">
      <p className="mb-1 flex items-center gap-2 text-xs font-medium text-ink-900">
        <AdjustmentIcon type={el.adjustment.type} />
        {ADJUSTMENT_LABELS[el.adjustment.type]}
      </p>
      <AdjustmentFields a={el.adjustment} onChange={change} />
      <button
        onClick={() => change(defaultAdjustment(el.adjustment.type), "reset")}
        className="mt-2 rounded-md px-2 py-1 text-xs text-ink-600 hover:bg-ink-100"
      >
        Reset
      </button>
    </div>
  );
}

const CHANNELS = [
  { value: "rgb", label: "RGB" },
  { value: "r", label: "Red" },
  { value: "g", label: "Green" },
  { value: "b", label: "Blue" },
] as const;
type Ch = (typeof CHANNELS)[number]["value"];

/** Fields for any adjustment; `onChange` gets the whole new adjustment and the field's name. */
export function AdjustmentFields({ a, onChange }: { a: Adjustment; onChange: Change }) {
  const [ch, setCh] = useState<Ch>("rgb");
  const pct = (v: number) => `${Math.round(v)}`;
  switch (a.type) {
    case "brightness-contrast":
      return (
        <>
          <Slider label="Brightness" value={a.brightness} min={-150} max={150} format={pct} onChange={(v) => onChange({ ...a, brightness: v }, "b")} />
          <Slider label="Contrast" value={a.contrast} min={-100} max={100} format={pct} onChange={(v) => onChange({ ...a, contrast: v }, "c")} />
          <Toggle label="Use legacy" checked={!!a.legacy} onChange={(v) => onChange({ ...a, legacy: v }, "legacy")} />
        </>
      );
    case "levels": {
      const cur: LevelsChannel = a.channels[ch] ?? { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
      const set = (p: Partial<LevelsChannel>, f: string) => onChange({ ...a, channels: { ...a.channels, [ch]: { ...cur, ...p } } }, `${ch}${f}`);
      return (
        <>
          <Select<Ch> label="Channel" value={ch} options={[...CHANNELS]} onChange={setCh} />
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-ink-600">
            <NumberField label="Input black" value={cur.inBlack} min={0} max={254} onChange={(v) => set({ inBlack: Math.min(v, cur.inWhite - 1) }, "ib")} />
            <NumberField label="Input white" value={cur.inWhite} min={1} max={255} onChange={(v) => set({ inWhite: Math.max(v, cur.inBlack + 1) }, "iw")} />
            <NumberField label="Output black" value={cur.outBlack} min={0} max={255} onChange={(v) => set({ outBlack: v }, "ob")} />
            <NumberField label="Output white" value={cur.outWhite} min={0} max={255} onChange={(v) => set({ outWhite: v }, "ow")} />
          </div>
          <Slider label="Midtones (gamma)" value={cur.gamma} min={0.1} max={9.99} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => set({ gamma: v }, "g")} />
        </>
      );
    }
    case "curves": {
      const pts = a.channels[ch] ?? [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ];
      return (
        <>
          <Select<Ch> label="Channel" value={ch} options={[...CHANNELS]} onChange={setCh} />
          <CurveEditor points={pts} onChange={(p) => onChange({ ...a, channels: { ...a.channels, [ch]: p } }, `curve${ch}`)} />
          <p className="text-[11px] leading-snug text-ink-400">Drag points; click the line to add one, double-click a point to remove it.</p>
        </>
      );
    }
    case "exposure":
      return (
        <>
          <Slider label="Exposure" value={a.exposure} min={-5} max={5} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => onChange({ ...a, exposure: v }, "e")} />
          <Slider label="Offset" value={a.offset} min={-0.5} max={0.5} step={0.001} format={(v) => v.toFixed(3)} onChange={(v) => onChange({ ...a, offset: v }, "o")} />
          <Slider label="Gamma" value={a.gamma} min={0.01} max={9.99} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => onChange({ ...a, gamma: v }, "g")} />
        </>
      );
    case "vibrance":
      return (
        <>
          <Slider label="Vibrance" value={a.vibrance} min={-100} max={100} format={pct} onChange={(v) => onChange({ ...a, vibrance: v }, "v")} />
          <Slider label="Saturation" value={a.saturation} min={-100} max={100} format={pct} onChange={(v) => onChange({ ...a, saturation: v }, "s")} />
        </>
      );
    case "hue-saturation": {
      const ranges = a.ranges ?? [];
      const target = ch === "rgb" ? "master" : (["reds", "greens", "blues"] as const)[["r", "g", "b"].indexOf(ch)];
      const r = target === "master" ? null : ranges.find((x) => x.range === target);
      const vals = r ?? a.master;
      const set = (p: Partial<typeof a.master>, f: string) => {
        if (target === "master") return onChange({ ...a, master: { ...a.master, ...p } }, `m${f}`);
        const [ra, rb, rc, rd] = HUE_RANGE_DEFAULTS[target];
        const base = r ?? { range: target, a: ra, b: rb, c: rc, d: rd, hue: 0, saturation: 0, lightness: 0 };
        const next = [...ranges.filter((x) => x.range !== target), { ...base, ...p }];
        onChange({ ...a, ranges: next }, `${target}${f}`);
      };
      return (
        <>
          {!a.colorize && (
            <Select<Ch>
              label="Range"
              value={ch}
              options={[
                { value: "rgb", label: "Master" },
                { value: "r", label: "Reds" },
                { value: "g", label: "Greens" },
                { value: "b", label: "Blues" },
              ]}
              onChange={setCh}
            />
          )}
          <Slider label="Hue" value={vals.hue} min={a.colorize ? 0 : -180} max={a.colorize ? 360 : 180} format={pct} onChange={(v) => set({ hue: v }, "h")} />
          <Slider label="Saturation" value={vals.saturation} min={a.colorize ? 0 : -100} max={100} format={pct} onChange={(v) => set({ saturation: v }, "s")} />
          <Slider label="Lightness" value={vals.lightness} min={-100} max={100} format={pct} onChange={(v) => set({ lightness: v }, "l")} />
          <Toggle
            label="Colorize"
            checked={!!a.colorize}
            onChange={(v) => {
              setCh("rgb");
              onChange({ ...a, colorize: v, master: v ? { hue: 0, saturation: 25, lightness: 0 } : { hue: 0, saturation: 0, lightness: 0 } }, "colorize");
            }}
          />
        </>
      );
    }
    case "color-balance": {
      const [tone, setTone] = [ch === "r" ? "shadows" : ch === "b" ? "highlights" : "midtones", setCh] as const;
      const v = a[tone];
      const set = (p: Partial<typeof v>, f: string) => onChange({ ...a, [tone]: { ...v, ...p } } as Adjustment, `${tone}${f}`);
      return (
        <>
          <Select<Ch>
            label="Tone"
            value={tone === "shadows" ? "r" : tone === "highlights" ? "b" : "g"}
            options={[
              { value: "r", label: "Shadows" },
              { value: "g", label: "Midtones" },
              { value: "b", label: "Highlights" },
            ]}
            onChange={setTone}
          />
          <Slider label="Cyan – Red" value={v.cyanRed} min={-100} max={100} format={pct} onChange={(x) => set({ cyanRed: x }, "cr")} />
          <Slider label="Magenta – Green" value={v.magentaGreen} min={-100} max={100} format={pct} onChange={(x) => set({ magentaGreen: x }, "mg")} />
          <Slider label="Yellow – Blue" value={v.yellowBlue} min={-100} max={100} format={pct} onChange={(x) => set({ yellowBlue: x }, "yb")} />
          <Toggle label="Preserve luminosity" checked={a.preserveLuminosity} onChange={(x) => onChange({ ...a, preserveLuminosity: x }, "pl")} />
        </>
      );
    }
    case "black-white":
      return (
        <>
          {(["reds", "yellows", "greens", "cyans", "blues", "magentas"] as const).map((k) => (
            <Slider
              key={k}
              label={k[0].toUpperCase() + k.slice(1)}
              value={a.weights[k]}
              min={-200}
              max={300}
              format={(x) => `${Math.round(x)}%`}
              onChange={(x) => onChange({ ...a, weights: { ...a.weights, [k]: x } }, k)}
            />
          ))}
          <div className="mt-1 flex items-center justify-between text-xs text-ink-600">
            <Toggle label="Tint" checked={!!a.tint} onChange={(x) => onChange({ ...a, tint: x ? "#e1b86a" : undefined }, "tint")} />
            {a.tint && <ColorInput title="Tint color" value={a.tint} onChange={(x) => onChange({ ...a, tint: x }, "tintc")} />}
          </div>
        </>
      );
    case "photo-filter":
      return (
        <>
          <div className="mb-1 flex items-center justify-between text-xs text-ink-600">
            Filter color
            <ColorInput title="Filter color" value={a.color} onChange={(x) => onChange({ ...a, color: x }, "color")} />
          </div>
          <Slider label="Density" value={Math.round(a.density * 100)} min={0} max={100} format={(x) => `${x}%`} onChange={(x) => onChange({ ...a, density: x / 100 }, "d")} />
          <Toggle label="Preserve luminosity" checked={a.preserveLuminosity} onChange={(x) => onChange({ ...a, preserveLuminosity: x }, "pl")} />
        </>
      );
    case "channel-mixer": {
      const out = a.monochrome ? "gray" : ch === "g" ? "g" : ch === "b" ? "b" : "r";
      const m = (out === "gray" ? (a.gray ?? { r: 40, g: 40, b: 20, constant: 0 }) : a[out])!;
      const set = (p: Partial<typeof m>, f: string) => onChange({ ...a, [out]: { ...m, ...p } } as Adjustment, `${out}${f}`);
      return (
        <>
          {!a.monochrome && (
            <Select<Ch>
              label="Output channel"
              value={ch === "rgb" ? "r" : ch}
              options={[
                { value: "r", label: "Red" },
                { value: "g", label: "Green" },
                { value: "b", label: "Blue" },
              ]}
              onChange={setCh}
            />
          )}
          <Slider label="Red" value={m.r} min={-200} max={200} format={(x) => `${Math.round(x)}%`} onChange={(x) => set({ r: x }, "r")} />
          <Slider label="Green" value={m.g} min={-200} max={200} format={(x) => `${Math.round(x)}%`} onChange={(x) => set({ g: x }, "g")} />
          <Slider label="Blue" value={m.b} min={-200} max={200} format={(x) => `${Math.round(x)}%`} onChange={(x) => set({ b: x }, "b")} />
          <Slider label="Constant" value={m.constant} min={-200} max={200} format={(x) => `${Math.round(x)}%`} onChange={(x) => set({ constant: x }, "k")} />
          <Toggle label="Monochrome" checked={a.monochrome} onChange={(x) => onChange({ ...a, monochrome: x, gray: a.gray ?? { r: 40, g: 40, b: 20, constant: 0 } }, "mono")} />
        </>
      );
    }
    case "invert":
      return <p className="text-xs text-ink-500">Inverts the colours below. Use transparency and blending to tone it down.</p>;
    case "posterize":
      return <Slider label="Levels" value={a.levels} min={2} max={255} onChange={(v) => onChange({ ...a, levels: v }, "l")} />;
    case "threshold":
      return <Slider label="Threshold level" value={a.level} min={1} max={255} onChange={(v) => onChange({ ...a, level: v }, "l")} />;
    case "gradient-map":
      return (
        <>
          <GradientInput stops={a.gradient.stops} onChange={(stops) => onChange({ ...a, gradient: { ...a.gradient, stops } }, "stops")} />
          <Toggle label="Reverse" checked={!!a.reverse} onChange={(v) => onChange({ ...a, reverse: v }, "rev")} />
        </>
      );
  }
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={Math.round(value)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        className="h-7 rounded-md border border-ink-200 bg-transparent px-1.5 text-sm tabular-nums text-ink-900"
      />
    </label>
  );
}

const SIZE = 200;

/** A curve on a 0..1 square: drag points, click the box to add, double-click a point to remove. */
function CurveEditor({ points, onChange }: { points: { x: number; y: number }[]; onChange: (p: { x: number; y: number }[]) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const at = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    const c = (v: number) => Math.max(0, Math.min(1, v));
    return { x: c((e.clientX - r.left) / r.width), y: c(1 - (e.clientY - r.top) / r.height) };
  };
  const path = sorted.map((p, i) => `${i ? "L" : "M"}${p.x * SIZE},${(1 - p.y) * SIZE}`).join(" ");
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="my-2 aspect-square w-full touch-none rounded-md border border-ink-200 bg-ink-50"
      role="img"
      aria-label="Curve"
      onPointerDown={(e) => {
        if (drag.current !== null || sorted.length >= 16) return;
        const p = at(e);
        const next = [...sorted, p].sort((a, b) => a.x - b.x);
        drag.current = next.indexOf(p);
        (e.target as globalThis.Element).setPointerCapture?.(e.pointerId);
        onChange(next);
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return;
        const i = drag.current;
        const p = at(e);
        // A point stays between its neighbours; the end points stay at the edges' order.
        const lo = i > 0 ? sorted[i - 1].x + 0.01 : 0;
        const hi = i < sorted.length - 1 ? sorted[i + 1].x - 0.01 : 1;
        onChange(sorted.map((q, j) => (j === i ? { x: Math.max(lo, Math.min(hi, p.x)), y: p.y } : q)));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g} className="stroke-ink-200" strokeWidth={1}>
          <line x1={g * SIZE} y1={0} x2={g * SIZE} y2={SIZE} />
          <line x1={0} y1={g * SIZE} x2={SIZE} y2={g * SIZE} />
        </g>
      ))}
      <path d={path} fill="none" className="stroke-ink-800" strokeWidth={2} />
      {sorted.map((p, i) => (
        <circle
          key={i}
          cx={p.x * SIZE}
          cy={(1 - p.y) * SIZE}
          r={6}
          className="cursor-grab fill-surface stroke-accent-600"
          strokeWidth={2}
          onPointerDown={(e) => {
            e.stopPropagation();
            drag.current = i;
            (e.target as globalThis.Element).setPointerCapture?.(e.pointerId);
          }}
          onDoubleClick={() => sorted.length > 2 && onChange(sorted.filter((_, j) => j !== i))}
        />
      ))}
    </svg>
  );
}

const FILTER_TYPES: FilterType[] = ["blur", "sharpen", "noise", "adjust"];

/** Filters on the selection: the first element's list, applied to every selected element. */
export function FiltersPanel({ els }: { els: Element[] }) {
  const st = useEditor.getState();
  const ids = els.map((e) => e.id);
  const list = els[0]?.filters ?? [];
  const setAll = (next: Filter[] | undefined, field: string) =>
    st.update(ids, { filters: next?.length ? next : undefined } as Partial<Element>, field ? { coalesce: `filters:${field}:${ids.join()}` } : undefined);
  const setOne = (i: number, f: Filter, field: string) => setAll(list.map((x, j) => (j === i ? f : x)), `${i}${field}`);
  return (
    <div className="w-72">
      <p className="mb-1 text-xs font-medium text-ink-900">Filters</p>
      {!list.length && <p className="pb-1 text-[11px] leading-snug text-ink-400">Filters change this layer&apos;s own pixels, before its effects.</p>}
      {list.map((f, i) => (
        <div key={i} className="mb-2 rounded-md border border-ink-100 p-2">
          <div className="flex items-center justify-between text-xs font-medium text-ink-800">
            {f.type === "adjust" ? `Adjust colours: ${ADJUSTMENT_LABELS[f.adjustment.type]}` : FILTER_LABELS[f.type]}
            <IconButton title="Remove filter" onClick={() => setAll(list.filter((_, j) => j !== i), "")}>
              <Trash2 size={14} />
            </IconButton>
          </div>
          {f.type === "blur" && <Slider label="Radius" value={f.radius} min={0} max={100} step={0.5} format={(v) => v.toFixed(1)} onChange={(v) => setOne(i, { ...f, radius: v }, "r")} />}
          {f.type === "sharpen" && (
            <>
              <Slider label="Amount" value={Math.round(f.amount * 100)} min={0} max={500} format={(v) => `${v}%`} onChange={(v) => setOne(i, { ...f, amount: v / 100 }, "a")} />
              <Slider label="Radius" value={f.radius} min={0.1} max={50} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => setOne(i, { ...f, radius: v }, "r")} />
            </>
          )}
          {f.type === "noise" && (
            <>
              <Slider label="Amount" value={Math.round(f.amount * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => setOne(i, { ...f, amount: v / 100 }, "a")} />
              <Toggle label="Monochromatic" checked={f.mono} onChange={(v) => setOne(i, { ...f, mono: v }, "m")} />
            </>
          )}
          {f.type === "adjust" && (
            <>
              <Select<AdjustmentType>
                label="Adjustment"
                value={f.adjustment.type}
                options={ADJUSTMENT_TYPES.map((t) => ({ value: t, label: ADJUSTMENT_LABELS[t] }))}
                onChange={(t) => setOne(i, { ...f, adjustment: defaultAdjustment(t) }, "t")}
              />
              <AdjustmentFields a={f.adjustment} onChange={(a, field) => setOne(i, { ...f, adjustment: a }, field)} />
            </>
          )}
        </div>
      ))}
      <div className={cx("flex flex-wrap gap-1", list.length >= 20 && "hidden")}>
        {FILTER_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setAll([...list, defaultFilter(t)], "")}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-ink-700 shadow-[var(--shadow-hairline)] hover:bg-ink-50"
          >
            <Plus size={12} />
            {FILTER_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  );
}
