import type { BgRequest, BgResponse } from "./bgRemove.worker";

export type BgProgress = { phase: "download"; loaded: number; total: number } | { phase: "processing" };

/** Download percentage, or null when nothing is really downloading (a cached model reports 0 of N briefly). */
export const downloadPercent = (p: BgProgress | null | undefined) =>
  p?.phase === "download" && p.total && p.loaded > 0 && p.loaded < p.total ? Math.round((p.loaded / p.total) * 100) : null;

/** Largest one-time model download (fp16 on WebGPU; the CPU model is 44 MB), for the confirmation text. */
export const MODEL_SIZE_MB = 90;

const DOWNLOADED_KEY = "canvasme:bg-model-ready";

let worker: Worker | null = null;
let nextId = 0;

export function modelDownloaded() {
  try {
    return localStorage.getItem(DOWNLOADED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Cut the background out of an image on this device. Resolves with a transparent PNG. */
export function removeBackground(blob: Blob, onProgress: (p: BgProgress) => void): Promise<Blob> {
  worker ??= new Worker(new URL("./bgRemove.worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const onMessage = ({ data }: MessageEvent<BgResponse>) => {
      if (data.id !== id) return;
      if (data.type === "progress") onProgress({ phase: "download", loaded: data.loaded, total: data.total });
      else if (data.type === "processing") {
        try {
          localStorage.setItem(DOWNLOADED_KEY, "1");
        } catch {
          // Only affects the wording of the next confirmation.
        }
        onProgress({ phase: "processing" });
      } else {
        w.removeEventListener("message", onMessage);
        if (data.type === "done") resolve(data.blob);
        else reject(new Error(data.message));
      }
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ id, blob } satisfies BgRequest);
  });
}
