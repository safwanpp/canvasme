import type { ImageElement } from "./model";
import { rotate } from "./mask";
import { FULL_CROP } from "./render";

export type Box = { x: number; y: number; width: number; height: number };

/** Smallest crop box, in design units. */
export const MIN_CROP = 8;

/** Where the whole picture sits in the element's local coordinates (the crop box is 0..width, 0..height). */
export function fullPicture(el: ImageElement): Box {
  const c = el.crop ?? FULL_CROP;
  const width = el.width / c.width;
  const height = el.height / c.height;
  return { x: -c.x * width, y: -c.y * height, width, height };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Move the crop box to `box` (local coordinates of `el`, inside the picture) with the
 * picture fixed on the page. The element takes the new box.
 */
export function cropTo(el: ImageElement, box: Box): Partial<ImageElement> {
  const pic = fullPicture(el);
  const at = rotate(box.x, box.y, el.rotation);
  return {
    x: el.x + at.x,
    y: el.y + at.y,
    width: box.width,
    height: box.height,
    crop: {
      x: clamp01((box.x - pic.x) / pic.width),
      y: clamp01((box.y - pic.y) / pic.height),
      width: Math.min(1, box.width / pic.width),
      height: Math.min(1, box.height / pic.height),
    },
  };
}

/** Slide the picture under a fixed crop box so its top-left sits at (px, py), kept covering the box. */
export function slidePicture(el: ImageElement, px: number, py: number): Partial<ImageElement> {
  const pic = fullPicture(el);
  const c = el.crop ?? FULL_CROP;
  const x = Math.min(0, Math.max(el.width - pic.width, px));
  const y = Math.min(0, Math.max(el.height - pic.height, py));
  return { crop: { ...c, x: clamp01(-x / pic.width), y: clamp01(-y / pic.height) } };
}

/** Show the whole picture again, at the size and place it has under the crop. */
export function uncrop(el: ImageElement): Partial<ImageElement> {
  const pic = fullPicture(el);
  const at = rotate(pic.x, pic.y, el.rotation);
  return { x: el.x + at.x, y: el.y + at.y, width: pic.width, height: pic.height, crop: undefined };
}
