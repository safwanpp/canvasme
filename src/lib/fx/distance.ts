// Signed Euclidean distance from an alpha mask's edge, in pixels: negative inside, positive
// outside. Exact squared distance transform (the lower envelope of parabolas, Felzenszwalb
// and Huttenlocher), run once for the inside and once for the outside.

const FAR = 1e20;

/** One-dimensional squared distance transform of f into d (length n), with scratch v, z. */
function edt1d(f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    // z[0] is -Infinity, so k never drops below 0.
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/** Squared distance from every pixel to the nearest pixel where `feature` is true. */
function sqDistance(feature: (i: number) => boolean, w: number, h: number): Float64Array {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = feature(i) ? 0 : FAR;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) grid[row + x] = d[x];
  }
  return grid;
}

/**
 * Signed distance from the alpha edge (threshold 0.5). A fully covered or empty pixel measures
 * from its centre to the edge of the nearest pixel on the other side; a partly covered one
 * takes its coverage as the edge's position inside it, which keeps edges antialiased.
 */
export function signedDistance(alpha: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  if (w < 1 || h < 1) return out;
  const toInside = sqDistance((i) => alpha[i] >= 0.5, w, h);
  const toOutside = sqDistance((i) => alpha[i] < 0.5, w, h);
  for (let i = 0; i < out.length; i++) {
    const a = alpha[i];
    if (a > 0 && a < 1) out[i] = 0.5 - a;
    else if (a >= 0.5) out[i] = toOutside[i] >= FAR ? -FAR : -(Math.sqrt(toOutside[i]) - 0.5);
    else out[i] = toInside[i] >= FAR ? FAR : Math.sqrt(toInside[i]) - 0.5;
  }
  return out;
}

/** The mask grown by r pixels, antialiased. Pass a field already computed to reuse it. */
export function dilateAlpha(alpha: Float32Array, w: number, h: number, r: number, field?: Float32Array): Float32Array {
  const d = field ?? signedDistance(alpha, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, r - d[i] + 0.5));
  return out;
}
