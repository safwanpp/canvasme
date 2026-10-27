import type { ImageElement, ShapeElement } from "./model";

// Elements rotate about their top-left corner (x, y), so converting between page and
// element-local coordinates is a rotation about that point.
export const rotate = (x: number, y: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
};

/**
 * Clip an image to a shape. The result keeps the image's id and takes the shape's
 * box; the image keeps exactly where it was on the page.
 */
export function maskImage(img: ImageElement, shape: ShapeElement, shapeAbove: boolean): ImageElement {
  const local = rotate(img.x - shape.x, img.y - shape.y, -shape.rotation);
  const out: ImageElement = {
    ...img,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    rotation: shape.rotation,
    mask: {
      shape: structuredClone(shape),
      image: { ...local, width: img.width, height: img.height, rotation: img.rotation - shape.rotation },
      shapeAbove,
    },
  };
  // It takes the shape's place in the layer order, so also its place in a clip stack.
  if (shape.clipped) out.clipped = true;
  else delete out.clipped;
  return out;
}

/** Split a masked image back into the shape (at the mask's current box) and the image. */
export function unmaskImage(el: ImageElement): { shape: ShapeElement; image: ImageElement } | null {
  const m = el.mask;
  if (!m) return null;
  const shape: ShapeElement = {
    ...m.shape,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.rotation,
    groupId: el.groupId,
    locked: el.locked,
    hidden: el.hidden,
  };
  // Both parts go back to the masked image's place, so into its clip stack too.
  if (el.clipped) shape.clipped = true;
  else delete shape.clipped;
  const at = rotate(m.image.x, m.image.y, el.rotation);
  const image: ImageElement = {
    ...el,
    x: el.x + at.x,
    y: el.y + at.y,
    width: m.image.width,
    height: m.image.height,
    rotation: el.rotation + m.image.rotation,
  };
  delete image.mask;
  return { shape, image };
}

/** Scale the picture inside a mask along with its box (the transformer resizes the box). */
export function scaleMask(el: ImageElement, sx: number, sy: number): ImageElement["mask"] {
  if (!el.mask) return undefined;
  const r = el.mask.image;
  return {
    ...el.mask,
    image: { ...r, x: r.x * sx, y: r.y * sy, width: r.width * sx, height: r.height * sy },
  };
}
