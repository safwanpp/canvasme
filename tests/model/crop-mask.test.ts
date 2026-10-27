import { describe, expect, it } from "vitest";
import { cropTo, slidePicture, uncrop } from "@/lib/crop";
import type { ImageElement } from "@/lib/model";
import { imageEl, rectPath } from "../fixtures/design";

const mask = { subpaths: [rectPath(20, 20, 40, 40, "combine")], fillRule: "nonzero" as const, invert: false };
/** The mask's first knot on the page (rotation 0). */
const knotOnPage = (el: ImageElement) => ({ x: el.x + el.vectorMask!.subpaths[0].knots[0].x, y: el.y + el.vectorMask!.subpaths[0].knots[0].y });

describe("crop keeps a vector mask on the picture", () => {
  const el = imageEl({ x: 100, y: 50, width: 200, height: 100, vectorMask: mask }) as ImageElement;

  it("cropTo moves the mask into the new box's coordinates", () => {
    const c = { ...el, ...cropTo(el, { x: 10, y: 5, width: 150, height: 80 }) } as ImageElement;
    expect(knotOnPage(c)).toEqual({ x: 120, y: 70 });
  });

  it("uncrop moves it back", () => {
    const c = { ...el, ...cropTo(el, { x: 10, y: 5, width: 150, height: 80 }) } as ImageElement;
    const u = { ...c, ...uncrop(c) } as ImageElement;
    expect(knotOnPage(u)).toEqual({ x: 120, y: 70 });
    expect(u.vectorMask!.subpaths[0].knots[0]).toMatchObject({ x: 20, y: 20 });
  });

  it("sliding the picture under the box takes the mask along", () => {
    const c = { ...el, ...cropTo(el, { x: 10, y: 5, width: 150, height: 80 }) } as ImageElement;
    const s = { ...c, ...slidePicture(c, -20, -10) } as ImageElement;
    // The picture moved by (-10, -5) on the page.
    expect(knotOnPage(s)).toEqual({ x: 110, y: 65 });
  });

  it("no mask, no mask field", () => {
    expect("vectorMask" in cropTo(imageEl() as ImageElement, { x: 1, y: 1, width: 50, height: 50 })).toBe(false);
  });
});
