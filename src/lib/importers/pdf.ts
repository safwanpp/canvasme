import { type Design, type Element, newDesign, newPage, type TextElement, uid } from "../model";
import { saveAsset, saveDesign, saveThumb } from "../storage";
import { canvasToBlob, renderThumbnail } from "../render";
import { availableFamilies, matchFont } from "./fontMatch";
import type { PdfMode } from "./job";
import { baseName, BASELINE_OFFSET, fitDesignSize, fitTextWidth, type ImportOutcome, MAX_IMPORT_BYTES, missingFontsNote } from "./shared";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>["getPage"]>>;

const MAX_PAGES = 30;
// Page images: up to 4x the design size, within what phones can hold in canvas memory.
const RENDER_MAX_RATIO = 4;
const RENDER_MAX_SIDE = 4096;
const RENDER_MAX_PIXELS = 16_000_000;
const MAX_TEXT_RUNS = 1500;

export const AI_NOT_PDF =
  "This Illustrator file has no PDF content, so it can't be opened here. In Illustrator, choose File › Save As, pick Illustrator (.ai), tick “Create PDF Compatible File” and save again. Or save it as a PDF.";

/** Load pdf.js on demand, with its worker and data files served from /pdfjs/<version>/. */
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const base = `/pdfjs/${pdfjs.version}/`;
  pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
  return { pdfjs, base };
}

type Run = { str: string; x: number; y: number; w: number; fs: number; font: string };

/** Upright text items in design units (relative to the page box), merged into runs along each line. */
async function textRuns(pdfjs: PdfJs, page: PdfPage, scale: number) {
  const vp = page.getViewport({ scale });
  const content = await page.getTextContent();
  const runs: Run[] = [];
  let run: Run | null = null;
  const fontInfo = (id: string) => {
    try {
      return page.commonObjs.has(id)
        ? (page.commonObjs.get(id) as { name?: string; isType3Font?: boolean; bold?: boolean; italic?: boolean })
        : null;
    } catch {
      return null;
    }
  };
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const m = pdfjs.Util.transform(vp.transform, item.transform);
    const fs = Math.abs(m[3]);
    const upright = Math.abs(m[1]) < 1e-3 * fs && Math.abs(m[2]) < 1e-3 * fs && m[0] > 0 && m[3] < 0;
    const info = fontInfo(item.fontName);
    if (!upright || !fs || info?.isType3Font) {
      run = null;
      continue;
    }
    const x = m[4];
    const y = m[5];
    const w = item.width * scale;
    if (!item.str.trim()) {
      if (run && item.str) run.str += run.str.endsWith(" ") ? "" : " ";
      if (item.hasEOL) run = null;
      continue;
    }
    const gap = run ? x - (run.x + run.w) : 0;
    if (
      run &&
      run.font === item.fontName &&
      Math.abs(run.fs - fs) < 0.1 * fs &&
      Math.abs(run.y - y) < 0.25 * fs &&
      gap > -0.3 * fs &&
      gap < 1.2 * fs
    ) {
      run.str += gap > 0.15 * fs && !run.str.endsWith(" ") ? ` ${item.str}` : item.str;
      run.w = x + w - run.x;
    } else {
      run = { str: item.str, x, y, w, fs, font: item.fontName };
      runs.push(run);
    }
    if (item.hasEOL) run = null;
  }
  return runs.map((r) => {
    const info = fontInfo(r.font);
    return { ...r, str: r.str.trim(), fontName: info?.name ?? "", bold: !!info?.bold, italic: !!info?.italic };
  });
}

/** Render a page; with `hideText`, upright glyphs drawn as text are left out (they become text boxes). */
async function renderPage(page: PdfPage, scale: number, hideText: boolean) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: hideText })!;
  if (hideText) {
    const fill = ctx.fillText.bind(ctx);
    const stroke = ctx.strokeText.bind(ctx);
    const upright = () => {
      const t = ctx.getTransform();
      return Math.abs(t.b) <= 1e-6 * Math.abs(t.a) && Math.abs(t.c) <= 1e-6 * Math.abs(t.d);
    };
    ctx.fillText = (...a: Parameters<typeof ctx.fillText>) => void (upright() || fill(...a));
    ctx.strokeText = (...a: Parameters<typeof ctx.strokeText>) => void (upright() || stroke(...a));
  }
  await page.render({ canvas, canvasContext: ctx, viewport, background: "rgba(0,0,0,0)" }).promise;
  return canvas;
}

/**
 * The colour of a run's glyphs: the pixels that differ between the full render and the one
 * without text. No difference means the text wasn't drawn as text (outlined, in a group, …),
 * so it's still in the image and must not become a text box too.
 */
function sampleColor(full: ImageData, bare: ImageData, run: Run, ratio: number): string | null {
  const x0 = Math.max(0, Math.floor(run.x * ratio));
  const x1 = Math.min(full.width, Math.ceil((run.x + run.w) * ratio));
  const y0 = Math.max(0, Math.floor((run.y - run.fs * 0.9) * ratio));
  const y1 = Math.min(full.height, Math.ceil((run.y + run.fs * 0.3) * ratio));
  let r = 0, g = 0, b = 0, wsum = 0, hits = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * full.width + x) * 4;
      const f = full.data;
      const n = bare.data;
      const diff = Math.abs(f[i] - n[i]) + Math.abs(f[i + 1] - n[i + 1]) + Math.abs(f[i + 2] - n[i + 2]) + Math.abs(f[i + 3] - n[i + 3]);
      if (diff < 64) continue;
      const w = diff * diff;
      r += f[i] * w;
      g += f[i + 1] * w;
      b += f[i + 2] * w;
      wsum += w;
      hits++;
    }
  }
  if (hits < 3) return null;
  const h = (v: number) => Math.round(v / wsum).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

async function head(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  return String.fromCharCode(...bytes);
}

/** Import an Illustrator (.ai, with PDF content) or PDF file: one design page per artboard/page. */
export async function importPdf(file: File, mode: PdfMode, onProgress: (detail: string) => void): Promise<ImportOutcome> {
  const isAi = file.name.toLowerCase().endsWith(".ai");
  if (file.size > MAX_IMPORT_BYTES) throw new Error("File is too large (max 250 MB).");
  const start = await head(file);
  if (!start.includes("%PDF-")) {
    throw new Error(isAi ? AI_NOT_PDF : "This isn't a PDF file canvas.me can read.");
  }

  onProgress("Loading PDF reader…");
  const { pdfjs, base } = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    enableXfa: false,
    // Font names (to match fonts for editable text) are only sent along with this.
    fontExtraProperties: mode === "text",
    // Refuse absurd embedded images rather than run out of memory.
    maxImageSize: 100_000_000,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    void task.destroy();
    if ((err as Error)?.name === "PasswordException") throw new Error("This file is password-protected. Remove the password and try again.");
    throw new Error(isAi ? AI_NOT_PDF : "This PDF is damaged or not supported.");
  }

  try {
    const notes: string[] = [];
    const count = Math.min(doc.numPages, MAX_PAGES);
    if (doc.numPages > MAX_PAGES) notes.push(`Only the first ${MAX_PAGES} of ${doc.numPages} pages were imported.`);
    const first = await doc.getPage(1);
    const firstVp = first.getViewport({ scale: 1 });
    const size = fitDesignSize(firstVp.width, firstVp.height);
    if (size.scale < 1) notes.push(`Pages were scaled down to fit canvas.me's 8000 px limit.`);
    const design: Design = newDesign(baseName(file.name), size.width, size.height);
    design.pages = [];
    const families = mode === "text" ? await availableFamilies() : [];
    const missing = new Set<string>();
    let resized = false;
    let textCount = 0;

    for (let n = 1; n <= count; n++) {
      onProgress(`Page ${n} of ${count}`);
      const page = n === 1 ? first : await doc.getPage(n);
      if (n === 1 && isAi) {
        // Illustrator writes a stand-in page saying so when PDF compatibility was off.
        const text = (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
        if (/saved without PDF Content/i.test(text)) throw new Error(AI_NOT_PDF);
      }
      const vp1 = page.getViewport({ scale: 1 });
      // Pages share the design's size; one of another size is fitted inside and centred.
      const s = Math.min(design.width / vp1.width, design.height / vp1.height);
      if (Math.abs(vp1.width * s - design.width) > 1 || Math.abs(vp1.height * s - design.height) > 1) resized = true;
      const boxW = vp1.width * s;
      const boxH = vp1.height * s;
      const off = { x: (design.width - boxW) / 2, y: (design.height - boxH) / 2 };
      const ratio = Math.max(
        0.25,
        Math.min(RENDER_MAX_RATIO, RENDER_MAX_SIDE / Math.max(boxW, boxH), Math.sqrt(RENDER_MAX_PIXELS / (boxW * boxH))),
      );

      const full = await renderPage(page, s * ratio, false);
      let image = full;
      const texts: Element[] = [];
      if (mode === "text") {
        const runs = (await textRuns(pdfjs, page, s)).filter((r) => r.str);
        if (runs.length > MAX_TEXT_RUNS) {
          notes.push(`Page ${n} has too much text to make editable, so it came in as an image only.`);
        } else if (runs.length) {
          const bare = await renderPage(page, s * ratio, true);
          const fullPx = full.getContext("2d")!.getImageData(0, 0, full.width, full.height);
          const barePx = bare.getContext("2d")!.getImageData(0, 0, bare.width, bare.height);
          for (const r of runs) {
            const fill = sampleColor(fullPx, barePx, r, ratio);
            if (!fill) continue;
            texts.push(await textElement(r, fill, off, families, missing));
          }
          image = bare;
          textCount += texts.length;
        }
      }

      const assetId = uid();
      const blob = await canvasToBlob(image);
      await saveAsset(assetId, blob);
      design.assets[assetId] = {
        mime: "image/png",
        name: `${design.name} page ${n}.png`.slice(0, 120),
        width: image.width,
        height: image.height,
        generated: true,
      };
      const p = newPage();
      p.elements.push(
        {
          id: uid(),
          name: count > 1 ? `${isAi ? "Artboard" : "Page"} ${n}` : isAi ? "Artboard" : "Page",
          type: "image",
          assetId,
          cornerRadius: 0,
          x: off.x,
          y: off.y,
          width: boxW,
          height: boxH,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          groupId: null,
        },
        ...texts,
      );
      design.pages.push(p);
      page.cleanup();
    }

    if (resized) notes.push(`${isAi ? "Artboards" : "Pages"} of a different size were scaled to fit the first one's size.`);
    if (mode === "text") {
      notes.push(
        textCount
          ? "Text is approximate: lines became separate text boxes, and spacing may differ. Rotated or outlined text stays part of the image."
          : "No editable text was found, so the file came in as images.",
      );
      if (missing.size) notes.push(missingFontsNote(missing));
    } else {
      notes.push(`Each ${isAi ? "artboard" : "page"} came in as one high-resolution image.`);
    }

    await saveDesign(design);
    try {
      await saveThumb(design.id, await renderThumbnail(design));
    } catch {
      // The editor makes one on first save.
    }
    return { design, report: { title: isAi ? "Opened from Illustrator" : "Opened from PDF", notes } };
  } finally {
    void task.destroy();
  }
}

async function textElement(
  r: Run & { fontName: string; bold: boolean; italic: boolean },
  fill: string,
  off: { x: number; y: number },
  families: string[],
  missing: Set<string>,
): Promise<TextElement> {
  const font = matchFont(r.fontName, families, r.bold, r.italic);
  if (font.missing && r.fontName) missing.add(font.missing);
  const lineHeight = 1.2;
  const el: TextElement = {
    id: uid(),
    name: r.str.slice(0, 60),
    type: "text",
    text: r.str,
    fontFamily: font.family,
    fontSize: r.fs,
    bold: font.bold,
    italic: font.italic,
    underline: false,
    fill,
    align: "left",
    lineHeight,
    letterSpacing: 0,
    x: off.x + r.x,
    y: off.y + r.y - (lineHeight * r.fs) / 2 - BASELINE_OFFSET * r.fs,
    width: r.w,
    height: r.fs * lineHeight,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    groupId: null,
  };
  return { ...el, width: await fitTextWidth(el, r.w * 1.02) };
}
