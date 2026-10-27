"use client";

import type { Gradient, Paint } from "@/lib/effects";
import type { VectorElement } from "@/lib/model";
import { ColorInput, Divider, Popover, Select, Slider, Toggle } from "../ui";
import { GradientFields } from "./EffectsPanel";

type Upd = (patch: Partial<VectorElement>, key?: string) => void;
type PaintKind = "none" | "color" | "gradient";

const kindOf = (p: Paint | null | undefined): PaintKind => (p ? p.type : "none");

/** A paint of the given kind, keeping the old paint's first colour. */
function switchPaint(p: Paint | null, kind: PaintKind, fallback: string): Paint | null {
  if (kind === "none") return null;
  const c = !p ? fallback : p.type === "color" ? p.color : p.gradient.stops[0].color;
  if (kind === "color") return { type: "color", color: c };
  return {
    type: "gradient",
    gradient: { style: "linear", angle: 90, scale: 1, reverse: false, stops: [{ offset: 0, color: c }, { offset: 1, color: "#ffffff" }] },
  };
}

/** A swatch for the trigger: the colour, the gradient, or a crossed box for none. */
function Swatch({ paint, ring }: { paint: Paint | null; ring?: boolean }) {
  const bg = !paint
    ? "repeating-linear-gradient(45deg, #fff 0 3px, #cbd5e1 3px 4px)"
    : paint.type === "color"
      ? paint.color
      : `linear-gradient(90deg, ${paint.gradient.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(", ")})`;
  return ring ? (
    <span className="h-4 w-4 rounded-sm border-2" style={{ borderColor: !paint ? "#94a3b8" : paint.type === "color" ? paint.color : paint.gradient.stops[0].color }} />
  ) : (
    <span className="h-4 w-4 rounded-sm border border-ink-300" style={{ background: bg }} />
  );
}

function PaintFields({ label, paint, onChange, fallback }: { label: string; paint: Paint | null; onChange: (p: Paint | null, key?: string) => void; fallback: string }) {
  return (
    <>
      <Select<PaintKind>
        label={label}
        value={kindOf(paint)}
        options={[
          { value: "none", label: "None" },
          { value: "color", label: "Color" },
          { value: "gradient", label: "Gradient" },
        ]}
        onChange={(k) => k !== kindOf(paint) && onChange(switchPaint(paint, k, fallback))}
      />
      {paint?.type === "color" && (
        <span className="flex items-center justify-between py-0.5 text-xs text-ink-600">
          Color
          <ColorInput title={`${label} color`} value={paint.color} onChange={(color) => onChange({ type: "color", color }, label)} />
        </span>
      )}
      {paint?.type === "gradient" && (
        <GradientFields
          gradient={paint.gradient}
          onChange={(patch: Partial<Gradient>, field?: string) =>
            onChange({ type: "gradient", gradient: { ...paint.gradient, ...patch } }, field ? `${label}-${field}` : undefined)
          }
        />
      )}
    </>
  );
}

/** Fill and stroke of vector shapes (no point editing). Edits apply to every selected vector. */
export function VectorControls({ first, upd }: { first: VectorElement; upd: Upd }) {
  const sw = first.strokeWidth ?? 0;
  return (
    <>
      <Popover title="Fill" trigger={<Swatch paint={first.fill} />}>
        <div className="w-60">
          <PaintFields label="Fill" paint={first.fill} fallback="#94a3b8" onChange={(fill, key) => upd({ fill }, key ? `vfill-${key}` : undefined)} />
          {first.fill && (
            <Select
              label="Fill rule"
              value={first.fillRule ?? "nonzero"}
              options={[
                { value: "nonzero", label: "Non-zero" },
                { value: "evenodd", label: "Even-odd" },
              ]}
              onChange={(fillRule) => upd({ fillRule })}
            />
          )}
        </div>
      </Popover>
      <Popover title="Stroke" trigger={<Swatch paint={sw > 0 ? first.stroke : null} ring />}>
        <div className="w-60">
          <PaintFields
            label="Stroke"
            paint={first.stroke}
            fallback="#000000"
            onChange={(stroke, key) => upd(stroke && !sw ? { stroke, strokeWidth: 2 } : { stroke }, key ? `vstroke-${key}` : undefined)}
          />
          {first.stroke && (
            <>
              <Slider label="Width" value={sw} min={0} max={100} onChange={(v) => upd({ strokeWidth: v }, "vsw")} />
              <Select
                label="Position"
                value={first.strokeAlign ?? "center"}
                options={[
                  { value: "inside", label: "Inside" },
                  { value: "center", label: "Center" },
                  { value: "outside", label: "Outside" },
                ]}
                onChange={(strokeAlign) => upd({ strokeAlign })}
              />
              <Select
                label="Caps"
                value={first.lineCap ?? "butt"}
                options={[
                  { value: "butt", label: "Butt" },
                  { value: "round", label: "Round" },
                  { value: "square", label: "Square" },
                ]}
                onChange={(lineCap) => upd({ lineCap })}
              />
              <Select
                label="Corners"
                value={first.lineJoin ?? "miter"}
                options={[
                  { value: "miter", label: "Miter" },
                  { value: "round", label: "Round" },
                  { value: "bevel", label: "Bevel" },
                ]}
                onChange={(lineJoin) => upd({ lineJoin })}
              />
              <Toggle
                label="Dashed"
                checked={!!first.dash?.length}
                onChange={(on) => upd({ dash: on ? [3, 2] : undefined })}
              />
            </>
          )}
        </div>
      </Popover>
      <Divider />
    </>
  );
}
