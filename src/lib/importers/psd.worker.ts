// Parses a Photoshop file off the main thread with ag-psd (MIT) and hands back plain layer data
// (see psdConvert.ts).
import { initializeCanvas, readPsd, type Psd } from "ag-psd";
import { convert, toRgba8, type PsdResult } from "./psdConvert";

export type { PsdNode, PsdResult, PsdText } from "./psdConvert";
export type PsdRequest = { id: number; buffer: ArrayBuffer };
export type PsdResponse =
  | { id: number; type: "progress"; done: number; total: number }
  | { id: number; type: "done"; result: PsdResult }
  | { id: number; type: "error"; message: string };

// No DOM in a worker: ag-psd only needs a canvas for a few conversions, and image data otherwise.
initializeCanvas(
  (w, h) => new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement,
  (w, h) => new ImageData(w, h),
);

async function png(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

self.onmessage = async ({ data }: MessageEvent<PsdRequest>) => {
  const { id, buffer } = data;
  const post = (msg: PsdResponse) => self.postMessage(msg);
  try {
    let result: PsdResult;
    try {
      // Smart objects' embedded files are read too: ag-psd hands them out as views into `buffer`
      // (no copy), and convert copies out only originals within the caps (MAX_SMART_*).
      const psd = readPsd(buffer, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: false });
      result = await convert(psd, (done, total) => post({ id, type: "progress", done, total }), { encode: png });
      if (!result.nodes.length && result.composite) result = { ...result, flattened: true };
    } catch (err) {
      // Layer data we can't read: fall back to the flattened image Photoshop saves with the file.
      if (err instanceof Error && err.message.startsWith("This file has")) throw err;
      let psd: Psd;
      try {
        psd = readPsd(buffer, { useImageData: true, skipLayerImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
      } catch {
        throw new Error("This Photoshop file is damaged or uses a format canvas.me can't read.");
      }
      if (!psd.imageData) throw new Error("This Photoshop file is damaged or uses a format canvas.me can't read.");
      result = {
        width: psd.width,
        height: psd.height,
        nodes: [],
        composite: await png(toRgba8(psd.imageData), psd.imageData.width, psd.imageData.height),
        notes: [],
        layerIssues: [],
        flattened: true,
        lossy: false,
      };
    }
    post({ id, type: "done", result });
  } catch (err) {
    post({ id, type: "error", message: (err as Error)?.message || "Couldn't read this Photoshop file." });
  }
};
