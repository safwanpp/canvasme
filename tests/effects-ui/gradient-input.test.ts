// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ColorStop } from "@/lib/effects";
import { GradientInput } from "@/components/ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let latest: ColorStop[] = [];
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(initial: ColorStop[]) {
  const host = document.createElement("div");
  document.body.append(host);
  function Harness() {
    const [stops, setStops] = useState(initial);
    latest = stops;
    return createElement(GradientInput, { stops, onChange: setStops });
  }
  root = createRoot(host);
  act(() => root!.render(createElement(Harness)));
  return host;
}
const press = (el: Element, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
};
const handles = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Stop "]')];

const three: ColorStop[] = [
  { offset: 0, color: "#000000" },
  { offset: 0.5, color: "#ff0000" },
  { offset: 0.51, color: "#00ff00" },
];

describe("GradientInput keyboard", () => {
  // Escape still bubbles, so the popover's document listener can close it.
  it("stop keys don't reach the editor's window shortcuts", () => {
    const host = mount(three);
    let reached = 0;
    const count = () => reached++;
    window.addEventListener("keydown", count);
    const h = handles(host)[1];
    h.focus();
    press(h, "Delete");
    press(handles(host)[0], "ArrowRight");
    press(handles(host)[0], "Backspace");
    window.removeEventListener("keydown", count);
    expect(reached).toBe(0);
  });

  it("focus follows the moved stop when it passes a neighbour", () => {
    const host = mount(three);
    const h = handles(host)[1];
    h.focus();
    press(h, "ArrowRight", { shiftKey: true }); // 0.5 → 0.6, past the stop at 0.51
    expect(latest.map((s) => s.color)).toEqual(["#000000", "#00ff00", "#ff0000"]);
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute("aria-label")).toMatch(/^Stop 3 at 60%/);
    expect(focused.style.background).toMatch(/255, 0, 0|#ff0000/);
  });

  it("a stop can be added from the keyboard", () => {
    const host = mount(three);
    const add = host.querySelector<HTMLButtonElement>('button[aria-label="Add stop"]')!;
    expect(add).not.toBeNull();
    act(() => add.click());
    expect(latest).toHaveLength(4);
    expect(latest.map((s) => s.offset)).toContain(0.25);
  });
});
