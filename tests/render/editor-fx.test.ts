// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { Effects } from "@/lib/effects";
import { renderElementsCanvas } from "@/lib/render";
import { rectEl } from "../fixtures/design";

vi.mock("@/lib/images", () => ({ loadAssetImage: async () => null, getReadyImage: () => undefined }));
vi.mock("@/lib/fonts", () => ({ ensureFonts: async () => {} }));

describe("rasterize with effects", () => {
  it("rasterize keeps shadow inside box", async () => {
    const el = rectEl({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      effects: Effects.parse({ dropShadow: [{ color: "#000000", angle: 90, distance: 20, size: 4 }] }),
    });
    const { canvas, box } = await renderElementsCanvas([el]);
    expect(box.height).toBeGreaterThanOrEqual(el.height + 20);
    // The shadow is drawn into the bitmap: below the rect, inside the box, is dark.
    const ratio = canvas.height / box.height;
    const y = Math.round((el.height + 15 - box.y) * ratio);
    const x = Math.round((20 - box.x) * ratio);
    const a = canvas.getContext("2d")!.getImageData(x, y, 1, 1).data[3];
    expect(a).toBeGreaterThan(200);
  });

  it("several elements union their visual bounds", async () => {
    const a = rectEl({ x: 0, y: 0, width: 20, height: 20 });
    const b = rectEl({
      x: 50,
      y: 0,
      width: 20,
      height: 20,
      effects: Effects.parse({ dropShadow: [{ color: "#000000", angle: 90, distance: 30, size: 0 }] }),
    });
    const { box } = await renderElementsCanvas([a, b]);
    expect(box.y + box.height).toBeGreaterThanOrEqual(50);
    expect(box.x).toBeLessThanOrEqual(0);
  });
});

describe("rasterize fill opacity", () => {
  it("one plain element keeps its fill opacity", async () => {
    const el = rectEl({ x: 10, y: 10, width: 40, height: 40, fill: "#000000", fillOpacity: 0.5 });
    const { canvas } = await renderElementsCanvas([el]);
    const a = canvas.getContext("2d")!.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data[3];
    expect(Math.abs(a - 128)).toBeLessThanOrEqual(2);
  });
});
