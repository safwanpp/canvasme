"use client";

import { ArrowDown, ArrowUp, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { BlendMode, Gradient, Paint } from "@/lib/effects";
import {
  type AnyFx,
  BLEND_MODE_GROUPS,
  BLEND_MODE_LABELS,
  FX_KINDS,
  type FxKind,
  type FxValue,
  MAX_PER_KIND,
  PRESETS,
  addEffect,
  applyPreset,
  commonValue,
  defaultEffect,
  effectList,
  moveEffect,
  patchEffect,
  patchGradient,
  removeEffect,
  sameEffectList,
} from "@/lib/effectEdit";
import type { Element } from "@/lib/model";
import { currentPage, useEditor } from "@/store/editor";
import { ColorInput, GradientInput, Select, Slider, Toggle, cx } from "../ui";

export const BLEND_GROUP_OPTIONS = BLEND_MODE_GROUPS.map((g) => ({
  label: g.label,
  options: g.modes.map((m) => ({ value: m, label: BLEND_MODE_LABELS[m] })),
}));

const pct = (v: number) => `${Math.round(v)}%`;
const px = (v: number) => `${Math.round(v)} px`;
const deg = (v: number) => `${Math.round(v)}°`;

/**
 * Layer effects for the selected elements. Every edit is a patch applied per element, so a
 * multi-selection keeps each element's other effects; slider drags coalesce into one undo step.
 */
export function EffectsPanel({ ids }: { ids: string[] }) {
  const page = useEditor(currentPage);
  const idKey = ids.join();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- idKey stands for ids
  const els = useMemo(() => (page?.elements ?? []).filter((e) => ids.includes(e.id)), [page, idKey]);
  const [open, setOpen] = useState<FxKind | null>(null);
  if (!els.length) return null;
  const st = useEditor.getState();
  const key = (s: string) => ({ coalesce: `fx:${s}:${ids.join()}` });
  const updateFx = (fn: (e: Element) => Element["effects"], coalesce?: string) =>
    st.update(ids, (e) => ({ effects: fn(e) }), coalesce ? key(coalesce) : undefined);
  const hasAny = els.some((e) => e.effects);

  return (
    <div className="w-72 text-xs text-ink-600">
      <p className="mb-1.5 font-medium text-ink-900">Presets</p>
      <div className="mb-3 flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => st.update(ids, applyPreset(p))}
            className="rounded-full border border-ink-200 px-2.5 py-1 text-ink-700 transition-colors hover:border-accent-300 hover:bg-accent-50 hover:text-accent-600"
          >
            {p.label}
          </button>
        ))}
      </div>
      <ul className="-mx-1 space-y-0.5">
        {FX_KINDS.map(({ kind, label, multi }) => (
          <KindRow
            key={kind}
            kind={kind}
            label={label}
            multi={multi}
            els={els}
            expanded={open === kind}
            onExpand={() => setOpen(open === kind ? null : kind)}
            onAdd={() => {
              const value = defaultEffect(kind, els[0]);
              updateFx((e) => (effectList(e.effects, kind).length >= MAX_PER_KIND ? e.effects : addEffect(e.effects, kind, value)));
              setOpen(kind);
            }}
            updateFx={updateFx}
          />
        ))}
      </ul>
      <button
        type="button"
        disabled={!hasAny}
        onClick={() => updateFx(() => undefined)}
        className="mt-2 w-full rounded-md px-2 py-1.5 text-ink-600 hover:bg-ink-100 disabled:opacity-35"
      >
        Clear all effects
      </button>
    </div>
  );
}

/**
 * Render keys for a kind's instances that follow an effect when this panel moves or removes it,
 * so local state (the selected gradient stop) stays with its effect. Effects can't carry an id:
 * every edit structuredClones the design, so object identity doesn't survive. Lists changed
 * elsewhere (undo) just grow or shrink at the end.
 */
function useInstanceKeys(count: number) {
  const ref = useRef({ keys: [] as number[], next: 0 });
  const r = ref.current;
  while (r.keys.length < count) r.keys.push(r.next++);
  if (r.keys.length > count) r.keys.length = count;
  return {
    keys: r.keys,
    move: (from: number, to: number) => r.keys.splice(to, 0, ...r.keys.splice(from, 1)),
    remove: (i: number) => r.keys.splice(i, 1),
  };
}
type InstanceKeys = ReturnType<typeof useInstanceKeys>;

type UpdateFx = (fn: (e: Element) => Element["effects"], coalesce?: string) => void;

function KindRow({
  kind,
  label,
  multi,
  els,
  expanded,
  onExpand,
  onAdd,
  updateFx,
}: {
  kind: FxKind;
  label: string;
  multi: boolean;
  els: Element[];
  expanded: boolean;
  onExpand: () => void;
  onAdd: () => void;
  updateFx: UpdateFx;
}) {
  // The first element carrying this kind is the reference; others may differ ("Mixed").
  const ref = els.find((e) => effectList(e.effects, kind).length) ?? els[0];
  const list = effectList(ref.effects, kind) as AnyFx[];
  // Serialises only when the selected elements' lists are different objects; memoised per render of the selection.
  const mixed = useMemo(() => !sameEffectList(els, kind), [els, kind]);
  const anyOn = list.some((f) => f.enabled !== false);
  const panelId = `fx-${kind}`;
  const shown = expanded && list.length > 0;
  const keys = useInstanceKeys(list.length);

  const setAllEnabled = (on: boolean) => {
    updateFx((e) => {
      let fx = e.effects;
      effectList(fx, kind).forEach((_, i) => (fx = patchEffect(fx, kind, i, { enabled: on })));
      return fx;
    });
  };

  return (
    <li className="rounded-md">
      <div className={cx("flex items-center gap-1 rounded-md px-1", expanded && "bg-ink-50")}>
        {list.length ? (
          <button
            type="button"
            aria-expanded={shown}
            aria-controls={shown ? panelId : undefined}
            onClick={onExpand}
            className="flex min-h-8 flex-1 items-center gap-1.5 rounded-md py-1 text-left text-ink-800"
          >
            <ChevronRight size={14} className={cx("text-ink-400 transition-transform duration-150", expanded && "rotate-90")} />
            {label}
            {list.length > 1 && <span className="tabular-nums text-ink-400">×{list.length}</span>}
            {mixed && <span className="text-ink-400">Mixed</span>}
          </button>
        ) : (
          <span className="flex min-h-8 flex-1 items-center gap-1.5 py-1 pl-5 text-ink-500">{label}</span>
        )}
        {(multi || !list.length) && (
          <button
            type="button"
            title={`Add ${label.toLowerCase()}`}
            aria-label={`Add ${label.toLowerCase()}`}
            disabled={list.length >= MAX_PER_KIND}
            onClick={onAdd}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100 disabled:opacity-35"
          >
            <Plus size={14} />
          </button>
        )}
        {list.length > 0 && <Toggle hideLabel label={`${label} on`} checked={anyOn} onChange={setAllEnabled} />}
      </div>
      {shown && (
        <div id={panelId} className="space-y-2 px-1 pb-2 pt-1">
          {list.map((fx, i) => (
            <Instance
              key={keys.keys[i]}
              keys={keys}
              kind={kind}
              index={i}
              count={list.length}
              mixedList={mixed}
              label={multi && list.length > 1 ? `${label} ${i + 1}` : label}
              fx={fx}
              els={els}
              updateFx={updateFx}
            />
          ))}
        </div>
      )}
    </li>
  );
}

function Instance({
  kind,
  index,
  count,
  keys,
  mixedList,
  label,
  fx,
  els,
  updateFx,
}: {
  kind: FxKind;
  index: number;
  count: number;
  keys: InstanceKeys;
  /** The selected elements' lists of this kind differ, so index-based moves and removes are off. */
  mixedList: boolean;
  label: string;
  fx: AnyFx;
  els: Element[];
  updateFx: UpdateFx;
}) {
  const set = (patch: Partial<AnyFx>, field?: string) =>
    updateFx((e) => patchEffect(e.effects, kind, index, patch as Partial<FxValue[FxKind]>, fx), field && `${kind}:${index}:${field}`);
  const mixedField = (get: (f: AnyFx | undefined) => unknown) =>
    els.length > 1 && commonValue(els, (e) => get(effectList(e.effects, kind)[index] as AnyFx | undefined)) === "mixed";
  const f = fx as Partial<FxValue["dropShadow"] & FxValue["innerShadow"] & FxValue["innerGlow"] & FxValue["outerGlow"] & FxValue["stroke"]>;
  const num = (field: keyof typeof f, label: string, min: number, max: number, format = px, scale = 1, step = 1) => {
    const value = ((f[field] as number | undefined) ?? 0) * scale;
    // Imported values can sit past the usual range (a 400 px shadow distance); widen to fit.
    return (
      <Slider
        label={label}
        value={value}
        min={Math.min(min, Math.floor(value))}
        max={Math.max(max, Math.ceil(value))}
        step={step}
        format={format}
        mixed={mixedField((g) => (g as typeof f | undefined)?.[field])}
        onChange={(v) => set({ [field]: v / scale } as Partial<AnyFx>, String(field))}
      />
    );
  };
  const color = (field: "color") => (
    <span className="flex items-center justify-between py-0.5">
      Color
      <ColorInput title={`${label} color`} value={f[field] ?? "#000000"} onChange={(v) => set({ [field]: v }, field)} />
    </span>
  );

  return (
    <section aria-label={label} className="rounded-md border border-ink-200 p-2">
      <div className="mb-1 flex items-center gap-1">
        <span className="flex-1 font-medium text-ink-900">{label}</span>
        {count > 1 && (
          <>
            <SmallButton
              label={`Move ${label} up`}
              disabled={index === 0 || mixedList}
              onClick={() => {
                keys.move(index, index - 1);
                updateFx((e) => moveEffect(e.effects, kind, index, index - 1));
              }}
            >
              <ArrowUp size={13} />
            </SmallButton>
            <SmallButton
              label={`Move ${label} down`}
              disabled={index === count - 1 || mixedList}
              onClick={() => {
                keys.move(index, index + 1);
                updateFx((e) => moveEffect(e.effects, kind, index, index + 1));
              }}
            >
              <ArrowDown size={13} />
            </SmallButton>
          </>
        )}
        <Toggle hideLabel label={`${label} visible`} checked={fx.enabled !== false} onChange={(on) => set({ enabled: on })} />
        <SmallButton
          label={`Remove ${label}`}
          disabled={mixedList}
          onClick={() => {
            keys.remove(index);
            updateFx((e) => removeEffect(e.effects, kind, index));
          }}
        >
          <Trash2 size={13} />
        </SmallButton>
      </div>

      {(kind === "dropShadow" || kind === "innerShadow") && (
        <>
          {color("color")}
          {num("angle", "Angle", -180, 180, deg)}
          {num("distance", "Distance", 0, 200)}
          {num("size", "Blur", 0, 250)}
          {kind === "dropShadow" ? num("spread", "Spread", 0, 100, pct, 100) : num("choke", "Choke", 0, 100, pct, 100)}
        </>
      )}
      {(kind === "outerGlow" || kind === "innerGlow") && (
        <>
          {color("color")}
          {num("size", "Size", 0, 250)}
          {kind === "outerGlow" ? num("spread", "Spread", 0, 100, pct, 100) : num("choke", "Choke", 0, 100, pct, 100)}
          <Select
            label="Technique"
            value={f.technique ?? "softer"}
            options={[
              { value: "softer", label: "Softer" },
              { value: "precise", label: "Precise" },
            ]}
            onChange={(v) => set({ technique: v })}
          />
          {kind === "innerGlow" && (
            <Select
              label="Source"
              value={f.source ?? "edge"}
              options={[
                { value: "edge", label: "Edge" },
                { value: "center", label: "Center" },
              ]}
              onChange={(v) => set({ source: v })}
            />
          )}
        </>
      )}
      {kind === "stroke" && (
        <StrokeFields
          f={f as FxValue["stroke"]}
          set={set}
          setPaint={(fn) =>
            updateFx((e) => patchEffect(e.effects, "stroke", index, (cur) => ({ paint: fn(cur.paint) }), fx as FxValue["stroke"]))
          }
          setGradient={(patch, field) =>
            updateFx((e) => patchGradient(e.effects, "stroke", index, patch, fx as FxValue["stroke"]), field && `${kind}:${index}:${field}`)
          }
          label={label}
          num={num}
        />
      )}
      {kind === "colorOverlay" && color("color")}
      {kind === "gradientOverlay" && (
        <GradientFields
          gradient={(fx as FxValue["gradientOverlay"]).gradient}
          onChange={(patch, field) =>
            updateFx(
              (e) => patchGradient(e.effects, "gradientOverlay", index, patch, fx as FxValue["gradientOverlay"]),
              field && `${kind}:${index}:${field}`,
            )
          }
        />
      )}

      <Select<BlendMode>
        label="Blend"
        value={fx.blendMode ?? "normal"}
        groups={BLEND_GROUP_OPTIONS}
        mixed={mixedField((g) => g?.blendMode ?? "normal")}
        onChange={(v) => set({ blendMode: v })}
      />
      <Slider
        label="Opacity"
        value={Math.round((fx.opacity ?? 1) * 100)}
        min={0}
        max={100}
        format={pct}
        mixed={mixedField((g) => g?.opacity ?? 1)}
        onChange={(v) => set({ opacity: v / 100 }, "opacity")}
      />
      {kind === "dropShadow" && <Toggle label="Hide under layer" checked={f.knockout !== false} onChange={(v) => set({ knockout: v })} />}
    </section>
  );
}

function StrokeFields({
  f,
  set,
  setPaint,
  setGradient,
  label,
  num,
}: {
  f: FxValue["stroke"];
  set: (patch: Partial<AnyFx>, field?: string) => void;
  /** Change each element's own paint (switching fill type keeps that element's colour). */
  setPaint: (fn: (paint: Paint) => Paint) => void;
  setGradient: (patch: Partial<Gradient>, field?: string) => void;
  label: string;
  num: (field: "size", label: string, min: number, max: number) => React.ReactNode;
}) {
  const paint: Paint = f.paint ?? { type: "color", color: "#000000" };
  return (
    <>
      {num("size", "Size", 0, 250)}
      <Select
        label="Position"
        value={f.position ?? "outside"}
        options={[
          { value: "outside", label: "Outside" },
          { value: "center", label: "Center" },
          { value: "inside", label: "Inside" },
        ]}
        onChange={(v) => set({ position: v })}
      />
      <Select
        label="Fill"
        value={paint.type}
        options={[
          { value: "color", label: "Color" },
          { value: "gradient", label: "Gradient" },
        ]}
        onChange={(v) => {
          if (v === paint.type) return;
          setPaint((p) => {
            if (p.type === v) return p;
            const c = p.type === "color" ? p.color : p.gradient.stops[0].color;
            return v === "color"
              ? { type: "color", color: c }
              : {
                  type: "gradient",
                  gradient: {
                    style: "linear",
                    angle: 90,
                    scale: 1,
                    reverse: false,
                    stops: [
                      { offset: 0, color: c },
                      { offset: 1, color: "#ffffff" },
                    ],
                  },
                };
          });
        }}
      />
      {paint.type === "color" ? (
        <span className="flex items-center justify-between py-0.5">
          Color
          <ColorInput title={`${label} color`} value={paint.color} onChange={(v) => set({ paint: { type: "color", color: v } }, "paint")} />
        </span>
      ) : (
        <GradientFields gradient={paint.gradient} onChange={setGradient} />
      )}
    </>
  );
}

export function GradientFields({ gradient, onChange }: { gradient: Gradient; onChange: (patch: Partial<Gradient>, field?: string) => void }) {
  const g = gradient;
  return (
    <>
      <GradientInput stops={g.stops} onChange={(stops) => onChange({ stops }, "stops")} />
      <Select
        label="Style"
        value={g.style ?? "linear"}
        options={[
          { value: "linear", label: "Linear" },
          { value: "radial", label: "Radial" },
          { value: "angle", label: "Angle" },
          { value: "reflected", label: "Reflected" },
          { value: "diamond", label: "Diamond" },
        ]}
        onChange={(style) => onChange({ style })}
      />
      <Slider label="Angle" value={g.angle ?? 90} min={-180} max={180} format={deg} onChange={(angle) => onChange({ angle }, "angle")} />
      <Slider
        label="Scale"
        value={Math.round((g.scale ?? 1) * 100)}
        min={10}
        max={150}
        format={pct}
        onChange={(v) => onChange({ scale: v / 100 }, "scale")}
      />
      <Toggle label="Reverse" checked={!!g.reverse} onChange={(reverse) => onChange({ reverse })} />
    </>
  );
}

function SmallButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100 disabled:opacity-35"
    >
      {children}
    </button>
  );
}
