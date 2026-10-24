import { zipSync } from "fflate";
import type { Design } from "./model";
import { canvasToBlob, renderPageCanvas } from "./render";
import { downloadBlob, safeFilename } from "./workfile";

export type ImageFormat = "png" | "jpg";

export async function exportImages(design: Design, format: ImageFormat, pageIds: string[], scale = 1) {
  const mime = format === "png" ? "image/png" : "image/jpeg";
  const base = safeFilename(design.name);
  const pages = design.pages.filter((p) => pageIds.includes(p.id));
  const blobs: Blob[] = [];
  for (const page of pages) {
    const canvas = await renderPageCanvas(design, page, scale);
    blobs.push(await canvasToBlob(canvas, mime, format === "jpg" ? 0.92 : undefined));
  }
  if (blobs.length === 1) {
    downloadBlob(blobs[0], `${base}.${format}`);
    return;
  }
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < blobs.length; i++) {
    const n = design.pages.indexOf(pages[i]) + 1;
    files[`${base}-${n}.${format}`] = new Uint8Array(await blobs[i].arrayBuffer());
  }
  downloadBlob(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: "application/zip" }), `${base}.zip`);
}

export async function exportPdf(design: Design) {
  const { jsPDF } = await import("jspdf");
  const { width: w, height: h } = design;
  const orientation = w > h ? "landscape" : "portrait";
  const pdf = new jsPDF({ orientation, unit: "px", format: [w, h], hotfixes: ["px_scaling"] });
  for (let i = 0; i < design.pages.length; i++) {
    if (i > 0) pdf.addPage([w, h], orientation);
    const canvas = await renderPageCanvas(design, design.pages[i], 2);
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, w, h);
  }
  pdf.save(`${safeFilename(design.name)}.pdf`);
}
