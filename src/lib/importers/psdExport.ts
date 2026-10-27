import { writePsd } from "ag-psd";
import type { Design } from "../model";
import { renderElementLayer, renderPageCanvas } from "../render";
import { loadAsset } from "../storage";
import { downloadBlob, safeFilename } from "../workfile";
import { buildArtboardPsd, buildPsd, compositeFits, type BuildIo } from "./psdBuild";

const BLANK_PREVIEW = "The file is very large, so its preview image was left blank: Photoshop rebuilds it on open, but other apps may show it black.";
const CANVAS_REFUSED = "Couldn't create the preview image for the PSD (the browser refused the canvas).";

/** An adjustment's stored grayscale mask, redrawn at the size its layer mask covers. */
const io: BuildIo = {
  async loadMask(assetId, width, height) {
    const blob = await loadAsset(assetId);
    if (!blob) return null;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    // The mask's value is its alpha (what the renderer reads). The canvas stores premultiplied
    // colour, so the red channel loses low values: copy alpha into the channel ag-psd writes.
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = data[i + 3];
      data[i + 3] = 255;
    }
    return { width, height, data };
  },
};

/**
 * Download pages as a Photoshop file: a background layer, one layer per element with its
 * blend mode, fill opacity and effects as live layer styles (the pixels are drawn without them,
 * so Photoshop doesn't double them), text as editable text layers that also carry our rendered
 * pixels, groups as layer folders, adjustments as adjustment layers, and the flattened page as
 * the composite. `"artboards"` writes every page as an artboard in one document; `"current"`
 * writes just the given page at its own size.
 */
export async function exportPsd(design: Design, pageId: string, mode: "current" | "artboards" = "current"): Promise<string[]> {
  const page = design.pages.find((p) => p.id === pageId) ?? design.pages[0];
  const notes: string[] = [];
  // A one-page design has nothing to lay out: "artboards" writes it like the current page.
  const asArtboards = mode === "artboards" && design.pages.length > 1;
  const renderFor = (p: typeof page): Parameters<typeof buildPsd>[2] => (el, o) => renderElementLayer(design, el, 1, { ...o, page: p });
  let psd;
  if (asArtboards) {
    // One renderer per page: elements are rendered against their own page's size.
    const owner = new Map(design.pages.flatMap((p) => p.elements.map((e) => [e.id, p] as const)));
    // Throws a clear Error (shown as the notice) before rendering when the document is too big.
    psd = await buildArtboardPsd(design, design.pages, (el, o) => renderFor(owner.get(el.id) ?? page)(el, o), notes, io);
    // The composite must be exactly the document's size, so it can't be scaled to fit the raster caps.
    if (compositeFits(psd.width, psd.height)) {
      const canvas = document.createElement("canvas");
      canvas.width = psd.width;
      canvas.height = psd.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error(CANVAS_REFUSED);
      for (const [i, p] of design.pages.entries()) {
        const rect = psd.children![i].artboard!.rect;
        ctx.drawImage(await renderPageCanvas(design, p, 1), rect.left, rect.top);
      }
      psd.canvas = canvas;
    } else {
      notes.push(BLANK_PREVIEW);
    }
  } else {
    // As before artboards existed: always the rendered page as composite and thumbnail.
    psd = await buildPsd(design, page, renderFor(page), notes, io);
    const canvas = await renderPageCanvas(design, page, 1);
    if (!canvas.getContext("2d")) throw new Error(CANVAS_REFUSED);
    psd.canvas = canvas;
  }
  // invalidateTextLayers: Photoshop re-lays out the text with its own fonts on open.
  const buffer = writePsd(psd, { generateThumbnail: !!psd.canvas, noBackground: true, invalidateTextLayers: true });
  const n = !asArtboards && design.pages.length > 1 ? `-${design.pages.indexOf(page) + 1}` : "";
  downloadBlob(new Blob([buffer], { type: "image/vnd.adobe.photoshop" }), `${safeFilename(design.name)}${n}.psd`);
  return notes;
}
