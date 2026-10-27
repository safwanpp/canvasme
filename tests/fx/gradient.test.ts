import { describe, expect, it } from "vitest";
import { Gradient } from "@/lib/effects";
import { sampleGradient } from "@/lib/fx/gradient";
import { expectPx, px } from "../fixtures/raster";

const g = (o: Record<string, unknown>) =>
  Gradient.parse({ stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }], ...o });
const box = { w: 100, h: 100 };

describe("sampleGradient", () => {
  it("linear 90° runs bottom to top", () => {
    const r = sampleGradient(g({ angle: 90 }), box, 100, 100);
    expectPx(px(r, 50, 0), [253, 253, 253, 255], 3);
    expectPx(px(r, 50, 99), [1, 1, 1, 255], 3);
  });

  it("linear 0° runs left to right, inside the box at an origin", () => {
    const r = sampleGradient(g({ angle: 0 }), { w: 40, h: 40 }, 100, 100, { x: 30, y: 30 });
    expect(px(r, 30, 50)[0]).toBeLessThan(10);
    expect(px(r, 69, 50)[0]).toBeGreaterThan(245);
    expect(px(r, 5, 50)[0]).toBe(0);
  });

  it("ratio scales the box to device pixels", () => {
    const r = sampleGradient(g({ angle: 0 }), { w: 50, h: 50 }, 100, 100, { x: 0, y: 0 }, 2);
    expect(px(r, 99, 50)[0]).toBeGreaterThan(250);
    expect(Math.abs(px(r, 50, 50)[0] - 128)).toBeLessThan(4);
  });

  it("radial centre equals first stop", () => {
    const r = sampleGradient(g({ style: "radial" }), box, 100, 100);
    expect(px(r, 50, 50)[0]).toBeLessThan(6);
    expect(px(r, 0, 0)[0]).toBeGreaterThan(245);
  });

  it("angle style wraps 360°", () => {
    const r = sampleGradient(g({ style: "angle", angle: 0 }), box, 100, 100);
    // Just above and just below the 0° ray (to the right of centre) sit at opposite ends.
    const above = px(r, 90, 48)[0];
    const below = px(r, 90, 51)[0];
    expect(Math.abs(above - below)).toBeGreaterThan(200);
  });

  it("reflected is symmetric", () => {
    const r = sampleGradient(g({ style: "reflected", angle: 90 }), box, 100, 100);
    expectPx(px(r, 50, 10), px(r, 50, 89), 1);
    expect(px(r, 50, 50)[0]).toBeLessThan(8);
  });

  it("diamond corner equals last stop", () => {
    const r = sampleGradient(g({ style: "diamond" }), box, 100, 100);
    expectPx(px(r, 0, 0), [255, 255, 255, 255], 1);
    expect(px(r, 50, 50)[0]).toBeLessThan(8);
  });

  it("midpoint 0.25 shifts the 50% colour to t=0.25", () => {
    const grad = Gradient.parse({
      angle: 0,
      stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff", midpoint: 0.25 }],
    });
    const r = sampleGradient(grad, { w: 100, h: 1 }, 100, 1);
    expect(Math.abs(px(r, 25, 0)[0] - 128)).toBeLessThan(4);
  });

  it("reverse flips and opacity stops fade", () => {
    const r = sampleGradient(
      g({ angle: 0, reverse: true, opacityStops: [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 0 }] }),
      { w: 100, h: 1 },
      100,
      1,
    );
    // Reversed: white at the left, and the opacity ramp reverses with it.
    expect(px(r, 0, 0)[0]).toBeGreaterThan(245);
    expect(px(r, 0, 0)[3]).toBeLessThan(10);
    expect(px(r, 99, 0)[3]).toBeGreaterThan(245);
  });
});
