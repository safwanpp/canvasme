import { describe, expect, it } from "vitest";
import * as fx from "@/lib/fx/fxShape";

describe("fxGeneration", () => {
  it("is bumped when an asset image becomes ready, so group effects re-render their members", () => {
    const before = fx.fxGeneration;
    fx.noteImageReady();
    expect(fx.fxGeneration).toBe(before + 1);
  });
});
