// Pixel buffers for the effects pipeline: premultiplied RGBA as 0..1 floats, row-major.
// Premultiplied so blurs, masks and compositing need no per-pixel divides.

export type Raster = { w: number; h: number; data: Float32Array };

export const createRaster = (w: number, h: number): Raster => ({ w, h, data: new Float32Array(w * h * 4) });

/** The alpha channel as its own buffer. */
export function alphaOf(r: Raster): Float32Array {
  const a = new Float32Array(r.w * r.h);
  for (let i = 0, j = 3; i < a.length; i++, j += 4) a[i] = r.data[j];
  return a;
}

type ImageDataLike = { width: number; height: number; data: Uint8ClampedArray };

export function fromImageData(d: ImageDataLike): Raster {
  const r = createRaster(d.width, d.height);
  const src = d.data;
  const out = r.data;
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    const k = a / 255;
    out[i] = src[i] * k;
    out[i + 1] = src[i + 1] * k;
    out[i + 2] = src[i + 2] * k;
    out[i + 3] = a;
  }
  return r;
}

/**
 * Straight 8-bit pixels into `target` (or a fresh buffer). Uint8ClampedArray rounds to the
 * nearest level on its own, so no +0.5 here: that would turn float residue (1e-8) into 1/255.
 */
export function toPixels(r: Raster, target = new Uint8ClampedArray(r.w * r.h * 4)): Uint8ClampedArray {
  const src = r.data;
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    if (a * 255 < 0.5) {
      target[i] = target[i + 1] = target[i + 2] = target[i + 3] = 0;
      continue;
    }
    const k = 255 / a;
    target[i] = src[i] * k;
    target[i + 1] = src[i + 1] * k;
    target[i + 2] = src[i + 2] * k;
    target[i + 3] = a * 255;
  }
  return target;
}

export function toImageData(r: Raster): ImageData {
  if (typeof ImageData !== "undefined") return new ImageData(toPixels(r) as Uint8ClampedArray<ArrayBuffer>, r.w, r.h);
  return { width: r.w, height: r.h, data: toPixels(r), colorSpace: "srgb" } as ImageData;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function fromCanvas(c: AnyCanvas): Raster {
  if (c.width < 1 || c.height < 1) return createRaster(0, 0);
  const ctx = c.getContext("2d") as Ctx2D;
  return fromImageData(ctx.getImageData(0, 0, c.width, c.height));
}

/** A blank canvas; OffscreenCanvas when there is no DOM (a worker). */
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement;
}

export function toCanvas(r: Raster): HTMLCanvasElement {
  const c = makeCanvas(Math.max(1, r.w), Math.max(1, r.h));
  if (r.w < 1 || r.h < 1) return c;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(r.w, r.h);
  toPixels(r, img.data);
  ctx.putImageData(img, 0, 0);
  return c;
}
