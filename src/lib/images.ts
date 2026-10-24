import { loadAsset } from "./storage";

const pending = new Map<string, Promise<HTMLImageElement | null>>();
const ready = new Map<string, HTMLImageElement>();

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

/** Load an asset blob from IndexedDB as a decoded image, cached per asset id. */
export function loadAssetImage(id: string): Promise<HTMLImageElement | null> {
  const hit = pending.get(id);
  if (hit) return hit;
  const p = loadAsset(id)
    .then((blob) => (blob ? blobToImage(blob) : null))
    .then((img) => {
      if (img) ready.set(id, img);
      return img;
    })
    .catch(() => null);
  pending.set(id, p);
  return p;
}

export const getReadyImage = (id: string) => ready.get(id);

/** Prime the cache right after an upload so the canvas does not re-read IndexedDB. */
export async function primeAssetImage(id: string, blob: Blob) {
  const img = await blobToImage(blob);
  ready.set(id, img);
  pending.set(id, Promise.resolve(img));
  return img;
}
