// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { skipsShortcuts } from "@/components/ui";

const keyFrom = (el: Element, key: string, prevent = false) => {
  let top = el;
  while (top.parentElement) top = top.parentElement;
  if (!top.isConnected) document.body.append(top);
  let got: KeyboardEvent | null = null;
  window.addEventListener("keydown", (ev) => (got = ev), { once: true });
  if (prevent) el.addEventListener("keydown", (ev) => ev.preventDefault(), { once: true });
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  return got!;
};
const withRole = (tag: string, role?: string) => {
  const el = document.createElement(tag);
  if (role) el.setAttribute("role", role);
  return el;
};

describe("editor shortcuts skip", () => {
  it("events already handled by the control", () => {
    const b = document.createElement("div");
    expect(skipsShortcuts(keyFrom(b, "Delete"))).toBe(false);
    expect(skipsShortcuts(keyFrom(b, "Delete", true))).toBe(true);
  });

  it("events from inside a popover or dialog", () => {
    for (const attr of [["role", "dialog"], ["data-popover", ""]]) {
      const box = document.createElement("div");
      box.setAttribute(attr[0], attr[1]);
      const inner = document.createElement("span");
      box.append(inner);
      expect(skipsShortcuts(keyFrom(inner, "Backspace"))).toBe(true);
    }
  });

  it("any key from sliders and options, which use the arrows themselves", () => {
    expect(skipsShortcuts(keyFrom(withRole("div", "slider"), "ArrowLeft"))).toBe(true);
    expect(skipsShortcuts(keyFrom(withRole("li", "option"), "Delete"))).toBe(true);
  });

  it("Space and Enter from buttons and switches, so they can be pressed", () => {
    for (const el of [withRole("button"), withRole("button", "switch"), withRole("div", "button")]) {
      expect(skipsShortcuts(keyFrom(el, " "))).toBe(true);
      expect(skipsShortcuts(keyFrom(el, "Enter"))).toBe(true);
    }
    // A toolbar button keeps focus after a click; Delete should still delete the selection.
    expect(skipsShortcuts(keyFrom(withRole("button"), "Delete"))).toBe(false);
  });

  it("not plain canvas or body events", () => {
    expect(skipsShortcuts(keyFrom(document.createElement("canvas"), "ArrowLeft"))).toBe(false);
  });
});
