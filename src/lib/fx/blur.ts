// Gaussian blur approximated by three successive box blurs (the "boxes for Gauss" sizing),
// separable and O(n) per pass with running sums. Pixels outside the buffer count as 0, which
// is what a shadow or glow wants: the image fades out rather than smearing its border.

const PASSES = 3;

/** Box radii whose three passes approximate a Gaussian of `sigma`. */
export function boxRadii(sigma: number): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / PASSES + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - PASSES * wl * wl - 4 * PASSES * wl - 3 * PASSES) / (-4 * wl - 4));
  const out: number[] = [];
  for (let i = 0; i < PASSES; i++) out.push(((i < m ? wl : wu) - 1) / 2);
  return out;
}

/** One horizontal box pass of radius r. */
function boxRows(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  const first = Math.min(r, w - 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = 0; x <= first; x++) acc += src[row + x];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * inv;
      if (x + r + 1 < w) acc += src[row + x + r + 1];
      if (x - r >= 0) acc -= src[row + x - r];
    }
  }
}

/** One vertical box pass of radius r, a whole row of running sums at a time (cache friendly). */
function boxCols(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, acc: Float32Array) {
  const inv = 1 / (2 * r + 1);
  acc.fill(0);
  const first = Math.min(r, h - 1);
  for (let y = 0; y <= first; y++) for (let x = 0, i = y * w; x < w; x++, i++) acc[x] += src[i];
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) dst[row + x] = acc[x] * inv;
    if (y + r + 1 < h) for (let x = 0, i = (y + r + 1) * w; x < w; x++, i++) acc[x] += src[i];
    if (y - r >= 0) for (let x = 0, i = (y - r) * w; x < w; x++, i++) acc[x] -= src[i];
  }
}

/** Blur one channel. A sigma of 0.3 or less returns a copy. */
export function gaussianBlur(ch: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const out = new Float32Array(ch);
  if (!(sigma > 0.3) || w < 1 || h < 1) return out;
  const tmp = new Float32Array(ch.length);
  const acc = new Float32Array(w);
  for (const r of boxRadii(sigma)) {
    if (r <= 0) continue;
    boxRows(out, tmp, w, h, r);
    boxCols(tmp, out, w, h, r, acc);
  }
  return out;
}
