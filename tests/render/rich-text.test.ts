// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effects } from "@/lib/effects";
import type { Element, TextElement } from "@/lib/model";
import { elementNodes, pageFonts, renderPageCanvas } from "@/lib/render";
import { fxCache } from "@/lib/fx/cache";
import { normalize } from "@/store/editor";
import { makeDesign, textEl } from "../fixtures/design";

vi.mock("@/lib/images", () => ({ loadAssetImage: async () => null, getReadyImage: () => undefined }));
vi.mock("@/lib/fonts", () => ({ ensureFonts: async () => {} }));

beforeEach(() => fxCache.clear());

async function render(els: Element[], w = 300, h = 200) {
  const d = makeDesign(els, { width: w, height: h });
  const c = await renderPageCanvas(d, d.pages[0], 1);
  return c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
}

/** Columns and rows that have any dark ink. */
function inked(img: ImageData) {
  let x0 = Infinity;
  let x1 = -1;
  let y0 = Infinity;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i] < 128 && img.data[i + 1] < 128 && img.data[i + 2] < 128) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  return { x0, x1, y0, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

const base = (p?: Partial<TextElement>) => textEl({ x: 10, y: 10, width: 280, text: "HHHH", fontSize: 20, fontFamily: "sans-serif", ...p });

describe("rich text rendering", () => {
  it("text without runs still draws with Konva.Text, pixel for pixel", async () => {
    const old = base();
    expect(elementNodes(old)[0].kind).toBe("Text");
    // Runs that override nothing are the same single style.
    const same = base({ runs: [{ length: 4 }] });
    expect(elementNodes(same)[0].kind).toBe("Text");
    const a = await render([old]);
    const b = await render([same]);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });

  it("text with runs draws one Shape the size of the box", () => {
    const el = normalize(base({ runs: [{ length: 2, fontSize: 40 }, { length: 2 }] })) as TextElement;
    const [n] = elementNodes(el);
    expect(n.kind).toBe("Shape");
    expect(n.attrs).toMatchObject({ width: el.width, height: el.height });
  });

  it("a single-style rich box draws close to the plain one", async () => {
    const plain = normalize(base()) as TextElement;
    const rich = normalize(base({ paragraphs: [{ length: 4, spaceAfter: 5 }] })) as TextElement;
    expect(elementNodes(rich)[0].kind).toBe("Shape");
    expect(rich.height).toBe(plain.height);
    const a = inked(await render([plain]));
    const b = inked(await render([rich]));
    for (const k of ["x0", "x1", "y0", "y1"] as const) expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(1);
  });

  it("mixed sizes: wider ink and a taller box", async () => {
    const plain = normalize(base()) as TextElement;
    const rich = normalize(base({ runs: [{ length: 2 }, { length: 2, fontSize: 40 }] })) as TextElement;
    expect(rich.height).toBe(Math.ceil(40 * 1.2));
    const a = inked(await render([plain]));
    const b = inked(await render([rich]));
    // Two 40 px H's are twice as wide as two 20 px ones.
    expect(b.width - a.width).toBeGreaterThan(a.width * 0.4);
    expect(b.height).toBeGreaterThan(a.height * 1.5);
    // Baselines line up: the small and the big H end on (about) the same row.
    const img = await render([rich]);
    let smallBottom = -1;
    for (let y = 0; y < img.height; y++) for (let x = b.x0; x < b.x0 + 5; x++) if (img.data[(y * img.width + x) * 4] < 128) smallBottom = y;
    expect(Math.abs(smallBottom - b.y1)).toBeLessThanOrEqual(2);
  });

  it("wrapped rich text normalizes to its line count", () => {
    const el = normalize(base({ width: 60, text: "HH HH HH", runs: [{ length: 3, bold: true }, { length: 5 }] })) as TextElement;
    expect(el.height).toBe(Math.ceil(3 * 20 * 1.2));
  });

  it("colour runs draw in their colour", async () => {
    const img = await render([base({ text: "HH", fontSize: 40, runs: [{ length: 1, fill: "#ff0000" }, { length: 1 }] })]);
    let red = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] > 200 && img.data[i + 1] < 60 && img.data[i + 2] < 60) red++;
    expect(red).toBeGreaterThan(20);
  });

  it("effects still apply to rich text", async () => {
    const shadow = Effects.parse({ dropShadow: [{ color: "#ff0000", angle: 90, distance: 30, size: 0, opacity: 1, blendMode: "normal" }] });
    const el = normalize(base({ text: "HH", fontSize: 40, runs: [{ length: 1, fontSize: 30 }, { length: 1 }], effects: shadow })) as TextElement;
    const img = await render([el]);
    let red = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] > 200 && img.data[i + 1] < 60 && img.data[i + 2] < 60) red++;
    expect(red).toBeGreaterThan(50);
  });

  it("page fonts include every run's family", () => {
    const d = makeDesign([base({ fontFamily: "Inter", runs: [{ length: 2, fontFamily: "Lora" }, { length: 2 }] })]);
    expect(pageFonts(d.pages[0])).toEqual(["Inter", "Lora"]);
  });
});
