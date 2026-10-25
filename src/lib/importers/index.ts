"use client";

import type { Design } from "../model";
import { importWorkfile, WORKFILE_EXT } from "../workfile";
import { askPdfMode, clearProgress, setProgress, setReport } from "./job";

/** Files that open as a new design: work files, Photoshop, Illustrator and PDF. */
export const OPEN_ACCEPT = `${WORKFILE_EXT},.psd,.ai,.pdf,application/pdf,image/vnd.adobe.photoshop`;
export const OPEN_EXTS = [WORKFILE_EXT, ".psd", ".ai", ".pdf"];

export const canOpen = (file: File) => OPEN_EXTS.some((ext) => file.name.toLowerCase().endsWith(ext));

/**
 * Open a file as a brand-new design. The parsers load only when a file needs them. Resolves
 * with the design, or null if the user cancelled; throws with a message to show otherwise.
 */
export async function openDesignFile(file: File): Promise<Design | null> {
  const name = file.name.toLowerCase();
  if (name.endsWith(WORKFILE_EXT)) return importWorkfile(file);
  setReport(null);
  try {
    if (name.endsWith(".psd")) {
      setProgress(`Opening ${file.name}`);
      const { importPsd } = await import("./psd");
      const { design, report } = await importPsd(file, (detail) => setProgress(`Opening ${file.name}`, detail));
      setReport(report && { ...report, designId: design.id });
      return design;
    }
    if (name.endsWith(".ai") || name.endsWith(".pdf")) {
      const mode = await askPdfMode(file.name);
      if (!mode) return null;
      setProgress(`Opening ${file.name}`);
      const { importPdf } = await import("./pdf");
      const { design, report } = await importPdf(file, mode, (detail) => setProgress(`Opening ${file.name}`, detail));
      setReport(report && { ...report, designId: design.id });
      return design;
    }
  } catch (err) {
    // Parsers throw plain errors on hostile or damaged input; keep the message, never the stack.
    throw new Error((err as Error)?.message || "Couldn't open this file.");
  } finally {
    clearProgress();
  }
  throw new Error(`Choose a ${WORKFILE_EXT}, .psd, .ai or .pdf file.`);
}
