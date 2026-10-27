import { describe, expect, it } from "vitest";
import { createCanvas } from "canvas";
import { pdfPages } from "@/lib/export";
import { buildPsd, type RenderLayer } from "@/lib/importers/psdBuild";
import { adjEl, makeDesign, rectEl } from "../fixtures/design";

const seen: string[] = [];
const stub: RenderLayer = async (el) => {
  seen.push(el.id);
  const c = createCanvas(2, 2);
  return { canvas: c as unknown as HTMLCanvasElement, box: { x: 0, y: 0, width: 2, height: 2 } };
};

describe("exports use each page's size", () => {
  it("PDF pages take their own sizes", () => {
    const d = makeDesign([]);
    d.pages.push({ id: "p2", background: "#fff", elements: [], width: 600, height: 300 });
    expect(pdfPages(d)).toEqual([
      { w: 200, h: 200, orientation: "portrait" },
      { w: 600, h: 300, orientation: "landscape" },
    ]);
  });

  it("PSD of a sized page is that size; adjustments are layers without pixels, filters noted", async () => {
    const d = makeDesign([rectEl({ id: "r", filters: [{ type: "blur", radius: 2 }] }), adjEl({ id: "a" })]);
    d.pages[0].width = 320;
    d.pages[0].height = 90;
    const notes: string[] = [];
    seen.length = 0;
    const psd = await buildPsd(d, d.pages[0], stub, notes);
    expect([psd.width, psd.height]).toEqual([320, 90]);
    const bg = psd.children![0].imageData!;
    expect([bg.width, bg.height]).toEqual([320, 90]);
    expect(seen).toEqual(["r"]);
    expect(psd.children!.length).toBe(3);
    expect(psd.children![2].adjustment).toMatchObject({ type: "invert" });
    expect(notes.join(" ")).toMatch(/Filters/);
  });
});
