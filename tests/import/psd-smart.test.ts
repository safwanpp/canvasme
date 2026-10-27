import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({ saveAsset: vi.fn(), saveDesign: vi.fn(), saveThumb: vi.fn(), listFonts: async () => [] }));
vi.mock("@/lib/render", () => ({ renderThumbnail: vi.fn(() => Promise.reject(new Error("no canvas"))) }));

import type { Layer, LinkedFile, Psd } from "ag-psd";
import { createCanvas } from "canvas";
import { Design, type ImageElement } from "@/lib/model";
import { buildDesignFromPsdResult } from "@/lib/importers/psd";
import { convert } from "@/lib/importers/psdConvert";
import { imageInfo } from "@/lib/importers/imageSniff";
import { buildPsd, pixelLayer, readFixture } from "../fixtures/psd";

const io = { encode: async (rgba: Uint8ClampedArray) => new Blob([rgba as Uint8ClampedArray<ArrayBuffer>], { type: "image/png" }) };
const ID = "20953ddb-9391-11ec-b4f1-c15674f50bc4";

const pngBytes = (w = 4, h = 2) => new Uint8Array(createCanvas(w, h).toBuffer("image/png"));
const jpegBytes = (w = 6, h = 3) => new Uint8Array(createCanvas(w, h).toBuffer("image/jpeg"));

/** Corners TL, TR, BR, BL of a w×h box at (x, y) rotated by `deg` about its top-left. */
function corners(x: number, y: number, w: number, h: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const p = (u: number, v: number) => [x + u * c - v * s, y + u * s + v * c];
  return [...p(0, 0), ...p(w, 0), ...p(w, h), ...p(0, h)];
}

/** A smart-object layer: its pixels over the box's bounds, and the placed transform. */
function smartLayer(transform: number[], extra?: Partial<Layer>): Layer {
  const xs = transform.filter((_, i) => i % 2 === 0);
  const ys = transform.filter((_, i) => i % 2 === 1);
  const left = Math.floor(Math.min(...xs));
  const top = Math.floor(Math.min(...ys));
  const layer = pixelLayer({ name: "Photo", left, top, w: Math.ceil(Math.max(...xs)) - left, h: Math.ceil(Math.max(...ys)) - top, rgba: [0, 0, 255, 255] });
  return { ...layer, placedLayer: { id: ID, placed: ID, type: "raster", transform, width: 4, height: 2 }, ...extra };
}

const psdOf = (layers: Layer[], files: LinkedFile[]): Psd => ({ width: 300, height: 200, children: layers, linkedFiles: files });

async function importPsd(psd: Psd) {
  const saved = new Map<string, Blob>();
  const result = await convert(psd, () => {}, io);
  const { design } = await buildDesignFromPsdResult(result, "smart.psd", { saveAsset: async (id, b) => void saved.set(id, b) });
  expect(Design.safeParse(design).success).toBe(true);
  const img = design.pages[0].elements.find((e): e is ImageElement => e.type === "image" && e.name === "Photo")!;
  return { design, img, saved, notes: (design.importReport?.notes ?? []).join(" ") + JSON.stringify(design.importReport?.items ?? []) };
}

describe("image sniffing", () => {
  it("reads PNG, JPEG and WebP sizes from their headers", () => {
    expect(imageInfo(pngBytes(7, 5))).toEqual({ mime: "image/png", width: 7, height: 5 });
    expect(imageInfo(jpegBytes(6, 3))).toEqual({ mime: "image/jpeg", width: 6, height: 3 });
    // A VP8L (lossless) header for a 3×2 image: 14 bits each of width-1 and height-1.
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0, 0, 0, 0, 0x2f, 2, 0x40, 0, 0]);
    expect(imageInfo(webp)).toEqual({ mime: "image/webp", width: 3, height: 2 });
    expect(imageInfo(new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, 1]))).toBeNull();
  });
});

describe("psd smart objects", () => {
  it("smart object with png linked file uses original and transform rotation 30°", async () => {
    const t = corners(100, 80, 40, 20, 30);
    const buf = buildPsd([smartLayer(t)], { width: 300, height: 200, extra: { linkedFiles: [{ id: ID, name: "photo.png", type: "png ", data: pngBytes() }] } });
    const psd = readFixture(buf);
    expect(psd.linkedFiles?.[0].data?.length).toBeGreaterThan(0);
    const { img, design, saved } = await importPsd(psd);
    expect(img.rotation).toBeCloseTo(30, 3);
    expect(img.x).toBeCloseTo(100, 3);
    expect(img.y).toBeCloseTo(80, 3);
    expect(img.width).toBeCloseTo(40, 3);
    expect(img.height).toBeCloseTo(20, 3);
    expect(img.source).toEqual({ kind: "smart-object", name: "photo.png" });
    expect(design.assets[img.assetId]).toMatchObject({ mime: "image/png", width: 4, height: 2 });
    const blob = saved.get(img.assetId)!;
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(pngBytes());
  });

  it("a JPEG original keeps its type", async () => {
    const { img, design } = await importPsd(psdOf([smartLayer(corners(10, 10, 60, 30, 0))], [{ id: ID, name: "p.jpg", data: jpegBytes() }]));
    expect(design.assets[img.assetId].mime).toBe("image/jpeg");
    expect(img).toMatchObject({ x: 10, y: 10, width: 60, height: 30, rotation: 0 });
  });

  it("a non-affine (perspective) transform keeps the layer pixels with a note", async () => {
    const t = [10, 10, 70, 15, 80, 60, 5, 50];
    const { img, design, notes } = await importPsd(psdOf([smartLayer(t)], [{ id: ID, name: "p.png", data: pngBytes() }]));
    expect(img.source).toBeUndefined();
    expect(img.rotation).toBe(0);
    expect(design.assets[img.assetId].mime).toBe("image/png");
    expect(notes).toMatch(/perspective|distort/i);
  });

  it("a warp keeps the layer pixels with a note", async () => {
    const layer = smartLayer(corners(10, 10, 40, 20, 0));
    layer.placedLayer!.warp = { style: "arc", value: 50 };
    const { img, notes } = await importPsd(psdOf([layer], [{ id: ID, name: "p.png", data: pngBytes() }]));
    expect(img.source).toBeUndefined();
    expect(notes).toMatch(/warp/i);
  });

  it("an identity custom warp (what ag-psd writes by default) is no warp", async () => {
    const layer = smartLayer(corners(10, 10, 40, 20, 0));
    const g = (n: number, w: number) => [0, w / 3, (2 * w) / 3, w].map((v) => v * 1).slice(0, n);
    const xs = g(4, 4);
    const ys = g(4, 2);
    layer.placedLayer!.warp = { style: "custom", customEnvelopeWarp: { meshPoints: ys.flatMap((y) => xs.map((x) => ({ x, y }))) } };
    const { img } = await importPsd(psdOf([layer], [{ id: ID, name: "p.png", data: pngBytes() }]));
    expect(img.source?.kind).toBe("smart-object");
  });

  it("an embedded PSD, AI or PDF smart object keeps the layer pixels with a note", async () => {
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // %PDF-1
    const { img, notes } = await importPsd(psdOf([smartLayer(corners(10, 10, 40, 20, 0))], [{ id: ID, name: "logo.ai", data }]));
    expect(img.source).toBeUndefined();
    expect(notes).toMatch(/smart object/i);
  });

  it("a filtered smart object keeps the layer pixels (filters are baked there)", async () => {
    const layer = smartLayer(corners(10, 10, 40, 20, 0));
    layer.placedLayer!.filter = { enabled: true, validAtPosition: true, maskEnabled: false, maskLinked: false, maskExtendWithWhite: false, list: [] } as never;
    const { img, notes } = await importPsd(psdOf([layer], [{ id: ID, name: "p.png", data: pngBytes() }]));
    expect(img.source).toBeUndefined();
    expect(notes).toMatch(/filter/i);
  });

  it("an original past the size caps falls back to the layer pixels", async () => {
    const huge = pngBytes();
    // Claim a 20000 × 20000 image in the header.
    new DataView(huge.buffer).setUint32(16, 20000);
    new DataView(huge.buffer).setUint32(20, 20000);
    const { img, notes } = await importPsd(psdOf([smartLayer(corners(10, 10, 40, 20, 0))], [{ id: ID, name: "big.png", data: huge }]));
    expect(img.source).toBeUndefined();
    expect(notes).toMatch(/too large/i);
  });

  it("without linked file data (or a pixel mask) the layer pixels are used, as before", async () => {
    const plain = await importPsd(psdOf([smartLayer(corners(10, 10, 40, 20, 15))], []));
    expect(plain.img.source).toBeUndefined();
    expect(plain.img.rotation).toBe(0);
    const masked = smartLayer(corners(10, 10, 40, 20, 0));
    masked.mask = { left: 10, top: 10, right: 50, bottom: 30, imageData: { width: 40, height: 20, data: new Uint8ClampedArray(40 * 20 * 4).fill(255) } as unknown as ImageData };
    const m = await importPsd(psdOf([masked], [{ id: ID, name: "p.png", data: pngBytes() }]));
    expect(m.img.source).toBeUndefined();
  });

  it("a vector mask on a rotated smart object is put in the rotated frame", async () => {
    const layer = smartLayer(corners(100, 50, 40, 20, 90));
    // A square mask in document pixels around the rotated box (x 80..100, y 50..90).
    const k = (x: number, y: number) => ({ linked: false, points: [x, y, x, y, x, y] });
    layer.vectorMask = { paths: [{ open: false, fillRule: "non-zero", operation: "combine", knots: [k(80, 50), k(100, 50), k(100, 90), k(80, 90)] }] };
    const { img } = await importPsd(psdOf([layer], [{ id: ID, name: "p.png", data: pngBytes() }]));
    expect(img.rotation).toBeCloseTo(90, 3);
    const xs = img.vectorMask!.subpaths[0].knots.map((kn) => Math.round(kn.x * 1000) / 1000 + 0);
    const ys = img.vectorMask!.subpaths[0].knots.map((kn) => Math.round(kn.y * 1000) / 1000 + 0);
    // In the element's own frame the mask is its 40 × 20 box.
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 40, 0, 20]);
  });
});
