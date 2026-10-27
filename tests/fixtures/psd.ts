/**
 * PSD fixtures built in code with ag-psd, so tests carry no binary files.
 *
 * What survives ag-psd's write → read (checked in fixtures.test.ts, "ag-psd units"):
 * effects (every kind, incl. choke, contour, gradients, disabled), blend mode strings,
 * opacity and fillOpacity, text and style runs, nested groups, vector masks and Psd.patterns.
 * Lossy on the way through: opacity and fillOpacity round to 1/255, effect opacities to whole
 * percent, gradient stop locations to 1/4096 (at smoothness 1), midpoints to whole percent and
 * vector knots to about 1e-5 px. An effect written without `enabled` reads back `enabled: false`.
 * Choke with `Percent` units can't be written at all (ag-psd throws), so a mapping test
 * for that shape must build the `Layer` object directly instead of round-tripping it.
 */
import { initializeCanvas, readPsd, writePsd, type BezierPath, type Layer, type Psd, type TextStyleRun, type VectorContent } from "ag-psd";
import { createCanvas, ImageData as NodeImageData } from "canvas";

// No DOM in the node test environment: back ag-psd's canvas and image data with node-canvas,
// as the worker does with OffscreenCanvas.
initializeCanvas(
  (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
  (w, h) => new NodeImageData(w, h) as unknown as ImageData,
);

type Rgba = [number, number, number, number];

// No DOM here: ag-psd only reads width, height and data from image data.
const imageData = (w: number, h: number, rgba: Rgba) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width: w, height: h, data } as unknown as ImageData;
};

const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

/** A solid-colour pixel layer. */
export function pixelLayer(o: {
  name?: string;
  left?: number;
  top?: number;
  w: number;
  h: number;
  rgba?: Rgba;
  extra?: Partial<Layer>;
}): Layer {
  const left = o.left ?? 0;
  const top = o.top ?? 0;
  return {
    name: o.name ?? "Layer",
    left,
    top,
    right: left + o.w,
    bottom: top + o.h,
    imageData: imageData(o.w, o.h, o.rgba ?? [255, 0, 0, 255]),
    ...o.extra,
  };
}

/** A point-text layer; `runs` become `text.styleRuns`. */
export function textLayer(o: {
  text: string;
  left: number;
  top: number;
  fontSize?: number;
  font?: string;
  color?: string;
  runs?: TextStyleRun[];
  extra?: Partial<Layer>;
}): Layer {
  const fontSize = o.fontSize ?? 24;
  return {
    name: o.text.slice(0, 60),
    left: o.left,
    top: o.top,
    text: {
      text: o.text,
      // Point text: the transform's translation is the first baseline's anchor.
      transform: [1, 0, 0, 1, o.left, o.top + fontSize],
      style: { font: { name: o.font ?? "ArialMT" }, fontSize, fillColor: rgbOf(o.color ?? "#000000") },
      ...(o.runs ? { styleRuns: o.runs } : {}),
    },
    ...o.extra,
  };
}

export function groupLayer(name: string, children: Layer[], extra?: Partial<Layer>): Layer {
  return { name, opened: true, children, ...extra };
}

/** Writes a PSD (200×200 by default) with a flat grey composite. */
export function buildPsd(children: Layer[], o?: { width?: number; height?: number; extra?: Partial<Psd> }): ArrayBuffer {
  const width = o?.width ?? 200;
  const height = o?.height ?? 200;
  const psd: Psd = { width, height, imageData: imageData(width, height, [128, 128, 128, 255]), children, ...o?.extra };
  return writePsd(psd, { noBackground: true });
}

export function readFixture(buf: ArrayBuffer): Psd {
  return readPsd(buf, { useImageData: true, skipThumbnail: true });
}

type Pt = [number, number];
/** A closed path through straight corners, in document pixels (ag-psd knot order [inX,inY,x,y,outX,outY]). */
export const polyPath = (pts: Pt[], extra?: Partial<BezierPath>): BezierPath => ({
  open: false,
  fillRule: "non-zero",
  operation: "combine",
  knots: pts.map(([x, y]) => ({ linked: false, points: [x, y, x, y, x, y] })),
  ...extra,
});

/** A shape layer: a vector fill over `paths`, with pixels (solid) over their box like Photoshop saves. */
export function shapeLayer(o: { name?: string; paths: BezierPath[]; fill?: VectorContent; extra?: Partial<Layer>; pixels?: boolean }): Layer {
  const xs = o.paths.flatMap((p) => p.knots.flatMap((k) => [k.points[0], k.points[2], k.points[4]]));
  const ys = o.paths.flatMap((p) => p.knots.flatMap((k) => [k.points[1], k.points[3], k.points[5]]));
  const left = Math.floor(Math.min(...xs));
  const top = Math.floor(Math.min(...ys));
  const right = Math.ceil(Math.max(...xs));
  const bottom = Math.ceil(Math.max(...ys));
  return {
    name: o.name ?? "Shape",
    ...(o.pixels === false
      ? {}
      : { left, top, right, bottom, imageData: imageData(right - left, bottom - top, [255, 0, 0, 255]) }),
    vectorFill: o.fill ?? { type: "color", color: { r: 255, g: 0, b: 0 } },
    vectorMask: { paths: o.paths },
    ...o.extra,
  };
}
