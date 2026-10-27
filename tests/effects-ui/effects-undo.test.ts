// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addEffect, defaultEffect, patchEffect } from "@/lib/effectEdit";
import { useEditor } from "@/store/editor";
import { makeDesign, rectEl } from "../fixtures/design";

describe("effects undo", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("effect slider coalesces into one history entry", () => {
    const a = rectEl();
    const b = rectEl({ effects: addEffect(undefined, "stroke", defaultEffect("stroke", rectEl())) });
    useEditor.getState().load(makeDesign([a, b]));
    useEditor.getState().select([a.id, b.id]);
    const ids = useEditor.getState().selected;
    const fallback = defaultEffect("dropShadow", a);
    for (let i = 1; i <= 10; i++) {
      useEditor
        .getState()
        .update(ids, (e) => ({ effects: patchEffect(e.effects, "dropShadow", 0, { size: i }, fallback) }), {
          coalesce: `fx:dropShadow:0:size:${ids.join()}`,
        });
      vi.advanceTimersByTime(50);
    }
    const st = useEditor.getState();
    expect(st.past).toHaveLength(1);
    const els = st.design!.pages[0].elements;
    for (const el of els) expect(el.effects!.dropShadow![0].size).toBe(10);
    // b keeps its own stroke; a never had one.
    expect(els[1].effects!.stroke).toHaveLength(1);
    expect(els[0].effects!.stroke).toBeUndefined();

    st.undo();
    for (const el of useEditor.getState().design!.pages[0].elements) expect(el.effects?.dropShadow).toBeUndefined();
  });
});
