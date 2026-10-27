import { describe, expect, it } from "vitest";
import type { Psd } from "ag-psd";
import { convert, type PsdResult } from "@/lib/importers/psdConvert";
import { buildPsd, groupLayer, pixelLayer, readFixture, textLayer } from "../fixtures/psd";

const io = { encode: async (rgba: Uint8ClampedArray) => new Blob([rgba as Uint8ClampedArray<ArrayBuffer>]) };
export const run = (psd: Psd): Promise<PsdResult> => convert(psd, () => {}, io);

describe("psd convert (characterization)", () => {
  it("flat pixel layers come through with positions", async () => {
    const r = await run(readFixture(buildPsd([pixelLayer({ name: "A", left: 10, top: 20, w: 30, h: 40 })])));
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0]).toMatchObject({ name: "A", left: 10, top: 20, width: 30, height: 40, hidden: false, parent: null });
    expect(r.nodes[0].png).toBeInstanceOf(Blob);
    expect(r.width).toBe(200);
  });

  it("group opacity stays on the group node, not multiplied into the child", async () => {
    const psd = readFixture(
      buildPsd([groupLayer("G", [pixelLayer({ w: 4, h: 4, extra: { opacity: 0.5 } })], { opacity: 0.5 })]),
    );
    const r = await run(psd);
    expect(r.nodes.map((n) => n.kind ?? "layer")).toEqual(["layer", "group"]);
    expect(r.nodes[0].opacity).toBeCloseTo(0.5, 2);
    expect(r.nodes[1]).toMatchObject({ name: "G", parent: null });
    expect(r.nodes[1].opacity).toBeCloseTo(0.5, 2);
    expect(r.nodes[0].parent).toBe(r.nodes[1].key);
  });

  it("hidden layer stays hidden", async () => {
    const r = await run(readFixture(buildPsd([pixelLayer({ w: 4, h: 4, extra: { hidden: true } })])));
    expect(r.nodes[0].hidden).toBe(true);
  });

  it("text layer yields text node", async () => {
    const r = await run(readFixture(buildPsd([textLayer({ text: "Hello", left: 5, top: 5, fontSize: 30, color: "#ff0000" })])));
    expect(r.nodes[0].text).toMatchObject({ text: "Hello", fontSize: 30, fill: "#ff0000" });
  });

  it("16-bit layer data converts to 8-bit", async () => {
    const data = new Uint16Array(2 * 2 * 4).fill(0xffff);
    for (let i = 0; i < data.length; i += 4) data[i + 1] = data[i + 2] = 0;
    const psd: Psd = {
      width: 10,
      height: 10,
      bitsPerChannel: 16,
      children: [{ name: "deep", left: 0, top: 0, right: 2, bottom: 2, imageData: { width: 2, height: 2, data } as never }],
    };
    const r = await run(psd);
    const bytes = new Uint8Array(await r.nodes[0].png!.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });
});

describe("psd convert limits", () => {
  it("a very deep folder chain hits the layer limit instead of the call stack", async () => {
    let layer: Psd["children"] extends (infer L)[] | undefined ? L : never = { name: "leaf" };
    for (let i = 0; i < 20000; i++) layer = { name: `g${i}`, children: [layer] };
    await expect(run({ width: 10, height: 10, children: [layer] } as Psd)).rejects.toThrow(/imports up to 1000/);
  });
});
