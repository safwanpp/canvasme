// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/bgRemove", () => ({ removeBackground: vi.fn() }));

import { canRasterize } from "@/components/editor/actions";
import { imageEl, rectPath } from "../fixtures/design";

describe("canRasterize", () => {
  it("a plain image is already a bitmap; one with a vector mask isn't", () => {
    expect(canRasterize([imageEl()], new Set())).toBe(false);
    const vectorMask = { subpaths: [rectPath(0, 0, 10, 10, "combine")], fillRule: "nonzero" as const, invert: false };
    expect(canRasterize([imageEl({ vectorMask })], new Set())).toBe(true);
  });
});
