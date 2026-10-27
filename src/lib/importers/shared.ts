import { DEFAULT_FONT, ensureFont } from "../fonts";
import type { Design, TextElement } from "../model";
import { contextMeasure, hasRichStyle, layoutRichText, textFamilies } from "../richText";
import type { ImportReport } from "./job";

export const MAX_IMPORT_BYTES = 250 * 1024 * 1024;

/** Largest page side the editor allows (the custom-size limit). */
export const MAX_DESIGN_SIDE = 8000;

/**
 * Where a Konva text line's alphabetic baseline sits below the middle of its line box, as a
 * fraction of the font size: (ascent - descent) / 2 for typical fonts. Used to put imported text
 * on the baseline the source file had.
 */
export const BASELINE_OFFSET = 0.36;

export type ImportOutcome = { design: Design; report: ImportReport | null };

export const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, "").trim().slice(0, 80) || "Imported design";

/** A design size for a source canvas, scaled down to the editor's limit if needed. */
export function fitDesignSize(w: number, h: number) {
  const scale = Math.min(1, MAX_DESIGN_SIDE / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
  };
}

export const missingFontsNote = (missing: Set<string>) =>
  `Fonts not available here, replaced with ${DEFAULT_FONT}: ${[...missing].sort().join(", ")}. Upload them in the font picker and switch the text back.`;

let measurer: CanvasRenderingContext2D | null = null;

/**
 * A text box width that fits each line on one line in the font canvas.me will draw it with,
 * which is often a substitute wider than the original. Never narrower than `minWidth`. Text with
 * style runs is measured with its runs (every family loaded first).
 */
export async function fitTextWidth(
  t: { text: string; fontFamily: string; bold: boolean; italic: boolean; fontSize: number; letterSpacing: number } & Partial<TextElement>,
  minWidth: number,
) {
  const el = t.type === "text" ? (t as TextElement) : null;
  const rich = el && hasRichStyle(el);
  await Promise.all((rich ? textFamilies(el) : [t.fontFamily]).map((f) => ensureFont(f).catch(() => {})));
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return minWidth;
  if (rich) {
    const layout = layoutRichText({ ...el, width: 1e7 }, contextMeasure(measurer));
    const widest = Math.max(...layout.lines.map((l) => l.x + l.width));
    return Math.max(minWidth, widest * 1.03 + 2);
  }
  measurer.font = `${t.italic ? "italic " : ""}${t.bold ? "bold " : ""}${t.fontSize}px "${t.fontFamily}"`;
  const widest = Math.max(
    ...t.text.split("\n").map((line) => measurer!.measureText(line).width + t.letterSpacing * line.length),
  );
  return Math.max(minWidth, widest * 1.03 + 2);
}
