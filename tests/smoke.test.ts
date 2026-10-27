// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import Konva from "konva";
import { readPsd, writePsd } from "ag-psd";
import { FORMAT_VERSION } from "@/lib/model";

describe("smoke", () => {
  it("resolves the @ alias", () => {
    expect(FORMAT_VERSION).toBeGreaterThan(0);
  });

  it("konva renders in jsdom", () => {
    const stage = new Konva.Stage({ container: document.createElement("div"), width: 4, height: 4 });
    const layer = new Konva.Layer();
    layer.add(new Konva.Rect({ x: 0, y: 0, width: 4, height: 4, fill: "#ff0000" }));
    stage.add(layer);
    const ctx = stage.toCanvas({ pixelRatio: 1 }).getContext("2d")!;
    expect(Array.from(ctx.getImageData(1, 1, 1, 1).data)).toEqual([255, 0, 0, 255]);
    stage.destroy();
  });

  it("ag-psd round-trips a layer", () => {
    const data = new Uint8ClampedArray(2 * 2 * 4).fill(255);
    const imageData = { width: 2, height: 2, data } as ImageData;
    const buf = writePsd({ width: 2, height: 2, children: [{ name: "L", left: 0, top: 0, imageData }] }, { noBackground: true });
    const psd = readPsd(buf, { useImageData: true });
    expect(psd.children?.[0].imageData?.width).toBe(2);
  });
});
