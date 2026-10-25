import { writePsd, type Layer, type Psd } from "ag-psd";
import type { Design, Element } from "../model";
import { renderElementLayer, renderPageCanvas } from "../render";
import { downloadBlob, safeFilename } from "../workfile";

const layerName = (el: Element) =>
  (el.name || (el.type === "text" ? el.text.replace(/\s+/g, " ").trim().slice(0, 60) : null) || el.type).slice(0, 120) ||
  "Layer";

/**
 * Download one page as a Photoshop file: a background layer, one pixel layer per element
 * (drawn by the same renderer as every other export, so text is rasterized), groups as layer
 * folders where their elements sit next to each other, and the flattened page as the composite.
 */
export async function exportPsd(design: Design, pageId: string) {
  const page = design.pages.find((p) => p.id === pageId) ?? design.pages[0];
  const { width, height } = design;

  const bg = document.createElement("canvas");
  bg.width = width;
  bg.height = height;
  const ctx = bg.getContext("2d")!;
  ctx.fillStyle = page.background;
  ctx.fillRect(0, 0, width, height);

  const layers: Layer[] = [{ name: "Background", left: 0, top: 0, canvas: bg }];
  let folder = null as { id: string; layer: Layer } | null;
  for (const el of page.elements) {
    const out = await renderElementLayer(design, el);
    const layer: Layer = {
      name: layerName(el),
      opacity: el.opacity,
      hidden: el.hidden,
      ...(out ? { left: out.box.x, top: out.box.y, canvas: out.canvas } : {}),
    };
    if (!el.groupId) {
      folder = null;
      layers.push(layer);
    } else if (folder?.id === el.groupId) {
      folder.layer.children!.push(layer);
    } else {
      folder = { id: el.groupId, layer: { name: "Group", opened: true, children: [layer] } };
      layers.push(folder.layer);
    }
  }

  const psd: Psd = { width, height, children: layers, canvas: await renderPageCanvas(design, page, 1) };
  const buffer = writePsd(psd, { generateThumbnail: true, noBackground: true });
  const n = design.pages.length > 1 ? `-${design.pages.indexOf(page) + 1}` : "";
  downloadBlob(new Blob([buffer], { type: "image/vnd.adobe.photoshop" }), `${safeFilename(design.name)}${n}.psd`);
}
