import { describe, expect, it, vi } from "vitest";
import { BLEND_MODES, Effects, hasActiveEffects } from "@/lib/effects";
import {
  BLEND_MODE_GROUPS,
  BLEND_MODE_LABELS,
  FX_KINDS,
  PRESETS,
  addEffect,
  applyPreset,
  commonValue,
  defaultEffect,
  effectList,
  moveEffect,
  patchEffect,
  removeEffect,
  toggleEffect,
  addStop,
  removeStop,
  moveStop,
  patchGradient,
  sameEffectList,
  stopToAdd,
} from "@/lib/effectEdit";
import { imageEl, rectEl, textEl } from "../fixtures/design";

describe("defaultEffect", () => {
  it("every kind's default parses with the schema", () => {
    const el = rectEl({ width: 400, height: 200 });
    for (const { kind } of FX_KINDS) {
      const fx = addEffect(undefined, kind, defaultEffect(kind, el));
      expect(() => Effects.parse(fx)).not.toThrow();
      expect(hasActiveEffects(fx)).toBe(true);
    }
  });

  it("shadow distance scales with the element and size is twice the distance", () => {
    const small = defaultEffect("dropShadow", rectEl({ width: 50, height: 50 }));
    expect(small).toMatchObject({ color: "#000000", opacity: 0.35, angle: 120, distance: 4, size: 8 });
    const big = defaultEffect("dropShadow", rectEl({ width: 1000, height: 500 }));
    expect(big).toMatchObject({ distance: 15, size: 30 });
  });

  it("stroke is 4px outside black", () => {
    expect(defaultEffect("stroke", textEl())).toMatchObject({
      size: 4,
      position: "outside",
      paint: { type: "color", color: "#000000" },
    });
  });
});

describe("add / remove", () => {
  it("add then remove leaves effects undefined", () => {
    const el = rectEl();
    const fx = addEffect(undefined, "dropShadow", defaultEffect("dropShadow", el));
    expect(fx.dropShadow).toHaveLength(1);
    expect(removeEffect(fx, "dropShadow", 0)).toBeUndefined();
  });

  it("adding to an array kind appends, a singleton kind replaces", () => {
    const el = rectEl();
    let fx = addEffect(undefined, "stroke", defaultEffect("stroke", el));
    fx = addEffect(fx, "stroke", { ...defaultEffect("stroke", el), size: 9 });
    expect(fx.stroke!.map((s) => s.size)).toEqual([4, 9]);
    fx = addEffect(fx, "outerGlow", defaultEffect("outerGlow", el));
    fx = addEffect(fx, "outerGlow", { ...defaultEffect("outerGlow", el), size: 3 });
    expect(fx.outerGlow!.size).toBe(3);
  });

  it("removing one of two keeps the other and other kinds", () => {
    const el = rectEl();
    let fx = addEffect(undefined, "stroke", defaultEffect("stroke", el));
    fx = addEffect(fx, "stroke", { ...defaultEffect("stroke", el), size: 9 });
    fx = addEffect(fx, "innerGlow", defaultEffect("innerGlow", el));
    const out = removeEffect(fx, "stroke", 0)!;
    expect(out.stroke!.map((s) => s.size)).toEqual([9]);
    expect(out.innerGlow).toBeDefined();
    const noGlow = removeEffect(out, "innerGlow")!;
    expect("innerGlow" in noGlow).toBe(false);
  });

  it("does not mutate its input", () => {
    const el = rectEl();
    const fx = addEffect(undefined, "dropShadow", defaultEffect("dropShadow", el));
    const snap = structuredClone(fx);
    addEffect(fx, "dropShadow", defaultEffect("dropShadow", el));
    patchEffect(fx, "dropShadow", 0, { size: 99 });
    removeEffect(fx, "dropShadow", 0);
    expect(fx).toEqual(snap);
  });
});

describe("moveEffect", () => {
  it("reorders shadows", () => {
    const el = rectEl();
    let fx = addEffect(undefined, "dropShadow", { ...defaultEffect("dropShadow", el), size: 1 });
    fx = addEffect(fx, "dropShadow", { ...defaultEffect("dropShadow", el), size: 2 });
    fx = addEffect(fx, "dropShadow", { ...defaultEffect("dropShadow", el), size: 3 });
    expect(moveEffect(fx, "dropShadow", 0, 2)!.dropShadow!.map((s) => s.size)).toEqual([2, 3, 1]);
    expect(moveEffect(fx, "dropShadow", 2, 0)!.dropShadow!.map((s) => s.size)).toEqual([3, 1, 2]);
    // Out of range is a no-op.
    expect(moveEffect(fx, "dropShadow", 0, 5)!.dropShadow!.map((s) => s.size)).toEqual([1, 2, 3]);
  });
});

describe("patchEffect / toggleEffect", () => {
  it("patchEffect on multi-shadow edits only index", () => {
    const el = rectEl();
    let fx = addEffect(undefined, "dropShadow", defaultEffect("dropShadow", el));
    fx = addEffect(fx, "dropShadow", defaultEffect("dropShadow", el));
    const out = patchEffect(fx, "dropShadow", 1, { size: 40 })!;
    expect(out.dropShadow![0].size).toBe(fx.dropShadow![0].size);
    expect(out.dropShadow![1].size).toBe(40);
  });

  it("patching a missing effect uses the fallback, or leaves effects alone", () => {
    const el = rectEl();
    const base = defaultEffect("outerGlow", el);
    expect(patchEffect(undefined, "outerGlow", 0, { size: 5 })).toBeUndefined();
    expect(patchEffect(undefined, "outerGlow", 0, { size: 5 }, base)!.outerGlow!.size).toBe(5);
    const strokes = patchEffect(undefined, "stroke", 0, { size: 7 }, defaultEffect("stroke", el))!;
    expect(strokes.stroke!.map((s) => s.size)).toEqual([7]);
  });

  it("toggleEffect flips enabled (undefined counts as on)", () => {
    const el = rectEl();
    const fx = addEffect(undefined, "colorOverlay", defaultEffect("colorOverlay", el));
    const off = toggleEffect(fx, "colorOverlay", 0)!;
    expect(off.colorOverlay![0].enabled).toBe(false);
    expect(hasActiveEffects(off)).toBe(false);
    expect(toggleEffect(off, "colorOverlay", 0)!.colorOverlay![0].enabled).toBe(true);
    const legacy = { colorOverlay: [{ color: "#ff0000" }] } as unknown as Effects;
    expect(toggleEffect(legacy, "colorOverlay", 0)!.colorOverlay![0].enabled).toBe(false);
  });

  it("effectList wraps singletons", () => {
    const el = rectEl();
    const fx = addEffect(undefined, "innerGlow", defaultEffect("innerGlow", el));
    expect(effectList(fx, "innerGlow")).toHaveLength(1);
    expect(effectList(fx, "stroke")).toEqual([]);
    expect(effectList(undefined, "dropShadow")).toEqual([]);
  });
});

describe("presets", () => {
  it("has the planned ids and each parses", () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      "soft-shadow",
      "long-shadow",
      "outline",
      "neon",
      "emboss-lite",
      "duotone",
      "ghost",
    ]);
    for (const p of PRESETS) expect(() => Effects.parse(p.effects)).not.toThrow();
  });

  it("shadow presets multiply", () => {
    for (const p of PRESETS) for (const s of p.effects.dropShadow ?? []) expect(s.blendMode).toBe("multiply");
  });

  it("ghost is fill 0 with an outside stroke", () => {
    const ghost = PRESETS.find((p) => p.id === "ghost")!;
    expect(ghost.fillOpacity).toBe(0);
    expect(ghost.effects.stroke![0].position).toBe("outside");
  });

  it("applyPreset replaces effects and resets fill and blend it doesn't set", () => {
    const el = imageEl({ fillOpacity: 0.3, blendMode: "screen" });
    const soft = applyPreset(PRESETS.find((p) => p.id === "soft-shadow")!);
    expect(soft.fillOpacity).toBeUndefined();
    expect(soft.blendMode).toBeUndefined();
    expect("fillOpacity" in soft && "blendMode" in soft).toBe(true);
    expect({ ...el, ...soft }.effects!.dropShadow).toHaveLength(1);
    // Every apply hands out a fresh copy.
    const a = applyPreset(PRESETS[0]);
    a.effects!.dropShadow![0].size = 999;
    expect(PRESETS[0].effects.dropShadow![0].size).not.toBe(999);
  });
});

describe("commonValue", () => {
  it("same value or mixed", () => {
    const a = rectEl({ opacity: 0.5 });
    const b = rectEl({ opacity: 0.5 });
    const c = rectEl({ opacity: 1 });
    expect(commonValue([a, b], (e) => e.opacity)).toBe(0.5);
    expect(commonValue([a, c], (e) => e.opacity)).toBe("mixed");
    expect(commonValue([a, c], (e) => e.effects?.dropShadow?.[0]?.size)).toBeUndefined();
  });

  it("compares objects by value", () => {
    const a = rectEl({ effects: { stroke: [defaultEffect("stroke", rectEl())] } as Effects });
    const b = rectEl({ effects: structuredClone(a.effects) });
    expect(commonValue([a, b], (e) => e.effects)).toEqual(a.effects);
  });
});

describe("blend mode labels", () => {
  it("label every mode and group all but pass-through", () => {
    for (const m of BLEND_MODES) expect(BLEND_MODE_LABELS[m]).toMatch(/^[A-Z]/);
    const grouped = BLEND_MODE_GROUPS.flatMap((g) => g.modes);
    expect(new Set(grouped)).toEqual(new Set(BLEND_MODES.filter((m) => m !== "pass-through")));
    expect(BLEND_MODE_GROUPS.map((g) => g.label)).toEqual(["Normal", "Darken", "Lighten", "Contrast", "Inversion", "Component"]);
  });
});

describe("gradient stops", () => {
  const stops = [
    { offset: 0, color: "#000000" },
    { offset: 1, color: "#ffffff" },
  ];

  it("addStop inserts in order with the colour sampled at that point", () => {
    const out = addStop(stops, 0.5);
    expect(out.map((s) => s.offset)).toEqual([0, 0.5, 1]);
    expect(out[1].color).toBe("#808080");
    expect(stops).toHaveLength(2);
  });

  it("removeStop keeps at least two", () => {
    const three = addStop(stops, 0.25);
    expect(removeStop(three, 1)).toHaveLength(2);
    expect(removeStop(stops, 0)).toEqual(stops);
  });

  it("moveStop clamps and keeps the list sorted", () => {
    const three = addStop(stops, 0.25);
    const moved = moveStop(three, 1, 1.4);
    expect(moved.map((s) => s.offset)).toEqual([0, 1, 1]);
    expect(moveStop(three, 1, 0.9).map((s) => s.offset)).toEqual([0, 0.9, 1]);
    expect(moveStop(three, 2, 0.1).map((s) => s.color)).toEqual(["#000000", "#ffffff", "#404040"]);
  });
});

describe("review fixes", () => {
  it("a drag over a multi-selection adds the fallback once, never past the end of the list", () => {
    const el = rectEl();
    const fallback = defaultEffect("dropShadow", el);
    // index === length: the first event adds, later events patch that one.
    let fx: Effects | undefined = undefined;
    for (let i = 0; i < 4; i++) fx = patchEffect(fx, "dropShadow", 0, { size: 10 + i }, fallback);
    expect(fx!.dropShadow!.map((s) => s.size)).toEqual([13]);
    // index > length: nothing to line up with, so the element is left alone on every event.
    let gap: Effects | undefined = undefined;
    for (let i = 0; i < 4; i++) gap = patchEffect(gap, "dropShadow", 1, { size: 10 + i }, fallback);
    expect(gap).toBeUndefined();
  });

  it("patchEffect takes a function of the element's own effect", () => {
    const el = rectEl();
    const fx = addEffect(undefined, "dropShadow", { ...defaultEffect("dropShadow", el), size: 5 });
    expect(patchEffect(fx, "dropShadow", 0, (cur) => ({ size: cur.size * 2 }))!.dropShadow![0].size).toBe(10);
  });

  it("patchGradient changes only the edited field of each element's own gradient", () => {
    const el = rectEl();
    const base = defaultEffect("gradientOverlay", el);
    const a = addEffect(undefined, "gradientOverlay", { ...base, gradient: { ...base.gradient, angle: 10 } });
    const b = addEffect(undefined, "gradientOverlay", { ...base, gradient: { ...base.gradient, angle: 70, style: "radial" } });
    const stops = [
      { offset: 0, color: "#ff0000" },
      { offset: 1, color: "#00ff00" },
    ];
    const outA = patchGradient(a, "gradientOverlay", 0, { stops }, a.gradientOverlay![0])!;
    const outB = patchGradient(b, "gradientOverlay", 0, { stops }, a.gradientOverlay![0])!;
    expect(outA.gradientOverlay![0].gradient).toMatchObject({ angle: 10, stops });
    expect(outB.gradientOverlay![0].gradient).toMatchObject({ angle: 70, style: "radial", stops });
  });

  it("patchGradient on a stroke keeps the element's gradient, or starts from the fallback's", () => {
    const el = rectEl();
    const grad = { style: "linear" as const, angle: 33, scale: 1, reverse: false, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] };
    const withGrad = addEffect(undefined, "stroke", { ...defaultEffect("stroke", el), paint: { type: "gradient", gradient: grad } });
    const withColor = addEffect(undefined, "stroke", defaultEffect("stroke", el));
    const ref = { ...defaultEffect("stroke", el), paint: { type: "gradient" as const, gradient: { ...grad, angle: 120 } } };
    const p1 = patchGradient(withGrad, "stroke", 0, { reverse: true }, ref)!.stroke![0].paint;
    expect(p1).toMatchObject({ type: "gradient", gradient: { angle: 33, reverse: true } });
    const p2 = patchGradient(withColor, "stroke", 0, { reverse: true }, ref)!.stroke![0].paint;
    expect(p2).toMatchObject({ type: "gradient", gradient: { angle: 120, reverse: true } });
  });

  it("commonValue compares by reference before serialising", () => {
    const shared = { stroke: [defaultEffect("stroke", rectEl())] } as Effects;
    const els = [rectEl({ effects: shared }), rectEl({ effects: shared }), rectEl({ effects: shared })];
    const spy = vi.spyOn(JSON, "stringify");
    expect(commonValue(els, (e) => e.effects)).toBe(shared);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("sameEffectList tells whether every element has the same list of a kind", () => {
    const el = rectEl();
    const one = addEffect(undefined, "dropShadow", defaultEffect("dropShadow", el));
    const two = addEffect(one, "dropShadow", defaultEffect("dropShadow", el));
    expect(sameEffectList([rectEl({ effects: one }), rectEl({ effects: structuredClone(one) })], "dropShadow")).toBe(true);
    expect(sameEffectList([rectEl({ effects: one }), rectEl({ effects: two })], "dropShadow")).toBe(false);
  });

  it("stopToAdd picks the middle of the widest gap", () => {
    const stops = [
      { offset: 0, color: "#000000" },
      { offset: 0.2, color: "#ff0000" },
      { offset: 1, color: "#ffffff" },
    ];
    expect(stopToAdd(stops)).toBeCloseTo(0.6);
  });
});
