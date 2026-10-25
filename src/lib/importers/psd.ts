import { type Design, type Element, type ImageElement, newDesign, type TextElement, uid } from "../model";
import { saveAsset, saveDesign, saveThumb } from "../storage";
import { renderThumbnail } from "../render";
import { availableFamilies, matchFont } from "./fontMatch";
import type { PsdNode, PsdRequest, PsdResponse, PsdResult } from "./psd.worker";
import { baseName, BASELINE_OFFSET, fitDesignSize, fitTextWidth, type ImportOutcome, MAX_IMPORT_BYTES, missingFontsNote } from "./shared";

// Past this the file would need gigabytes of memory to decode in a browser tab.
const MAX_PSD_SIDE = 30000;
const MAX_PSD_PIXELS = 150_000_000;

/** Read the size from the header before handing the whole file to the parser. */
async function checkHeader(file: File) {
  const head = new DataView(await file.slice(0, 26).arrayBuffer());
  const sig = head.byteLength >= 26 ? String.fromCharCode(...new Uint8Array(head.buffer, 0, 4)) : "";
  const version = sig === "8BPS" ? head.getUint16(4) : 0;
  const reserved = new Uint8Array(head.buffer, 6, 6).some((b) => b !== 0);
  const channels = version ? head.getUint16(12) : 0;
  if ((version !== 1 && version !== 2) || reserved || channels < 1 || channels > 56) {
    throw new Error("This isn't a Photoshop file canvas.me can read.");
  }
  const height = head.getUint32(14);
  const width = head.getUint32(18);
  if (width > MAX_PSD_SIDE || height > MAX_PSD_SIDE || width * height > MAX_PSD_PIXELS) {
    throw new Error(`This Photoshop file is ${width} × ${height} px, too large to open in the browser.`);
  }
}

function parse(buffer: ArrayBuffer, onProgress: (done: number, total: number) => void) {
  const worker = new Worker(new URL("./psd.worker.ts", import.meta.url), { type: "module" });
  return new Promise<PsdResult>((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<PsdResponse>) => {
      if (data.type === "progress") return onProgress(data.done, data.total);
      worker.terminate();
      if (data.type === "done") resolve(data.result);
      else reject(new Error(data.message));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("Couldn't read this Photoshop file."));
    };
    worker.postMessage({ id: 1, buffer } satisfies PsdRequest, [buffer]);
  });
}

const common = (name: string) => ({
  id: uid(),
  name: name.slice(0, 120),
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  groupId: null as string | null,
});

/** Import a .psd as a new design: one element per layer, at the file's canvas size. */
export async function importPsd(file: File, onProgress: (detail: string) => void): Promise<ImportOutcome> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("File is too large (max 250 MB).");
  await checkHeader(file);
  onProgress("Reading layers…");
  const result = await parse(await file.arrayBuffer(), (done, total) => onProgress(`Layer ${done} of ${total}`));
  onProgress("Saving…");

  const { width, height, scale } = fitDesignSize(result.width, result.height);
  const design: Design = newDesign(baseName(file.name), width, height);
  const page = design.pages[0];
  const notes = [...result.notes];
  if (scale < 1) notes.push(`The canvas was scaled down to ${width} × ${height} px to fit canvas.me's 8000 px limit.`);

  const addImage = async (blob: Blob, name: string, box: { x: number; y: number; w: number; h: number }) => {
    const assetId = uid();
    await saveAsset(assetId, blob);
    // Kept out of the Uploads panel, like the editor's own bitmaps, so a 100-layer file doesn't flood it.
    design.assets[assetId] = { mime: "image/png", name: `${name.slice(0, 80)}.png`, width: box.w, height: box.h, generated: true };
    const el: ImageElement = {
      ...common(name),
      type: "image",
      assetId,
      cornerRadius: 0,
      x: box.x * scale,
      y: box.y * scale,
      width: Math.max(box.w * scale, 0.1),
      height: Math.max(box.h * scale, 0.1),
    };
    return el;
  };

  if (result.flattened) {
    if (!result.composite) throw new Error("Couldn't read this Photoshop file.");
    page.elements.push(await addImage(result.composite, "Photoshop image", { x: 0, y: 0, w: result.width, h: result.height }));
    notes.unshift("No layers could be read, so the file came in as one flattened image.");
  } else {
    if (result.lossy && result.composite) {
      const flat = await addImage(result.composite, "Flattened (as saved by Photoshop)", { x: 0, y: 0, w: result.width, h: result.height });
      page.elements.push({ ...flat, hidden: true, locked: true });
      notes.push("The flattened image Photoshop saved is the hidden, locked bottom layer, for comparison.");
    }
    const families = await availableFamilies();
    const missing = new Set<string>();
    const groupIds = new Map<number, string>();
    for (const node of result.nodes) {
      const el = node.text ? await textElement(node, scale, families, missing) : await addImage(node.png!, node.name, { x: node.left, y: node.top, w: node.width, h: node.height });
      el.opacity = Math.max(0, Math.min(1, node.opacity));
      el.hidden = node.hidden;
      if (node.group !== null) {
        if (!groupIds.has(node.group)) groupIds.set(node.group, uid());
        el.groupId = groupIds.get(node.group)!;
      }
      page.elements.push(el);
    }
    // A group of one is just a layer.
    for (const gid of groupIds.values()) {
      const members = page.elements.filter((e) => e.groupId === gid);
      if (members.length === 1) members[0].groupId = null;
    }
    if (missing.size) notes.push(missingFontsNote(missing));
    if (!page.elements.length) throw new Error("This Photoshop file has no layers canvas.me can import.");
  }

  await saveDesign(design);
  try {
    await saveThumb(design.id, await renderThumbnail(design));
  } catch {
    // The editor makes one on first save.
  }
  return { design, report: notes.length ? { title: "Opened from Photoshop", notes } : null };
}

async function textElement(node: PsdNode, scale: number, families: string[], missing: Set<string>): Promise<Element> {
  const t = node.text!;
  const font = matchFont(t.fontName, families, t.fauxBold, t.fauxItalic);
  if (font.missing) missing.add(font.missing);
  const fontSize = Math.max(1, t.fontSize * scale);
  let x: number;
  let y: number;
  let width: number;
  if (t.box) {
    x = t.box.x * scale;
    y = t.box.y * scale;
    width = t.box.width * scale;
  } else {
    // Point text never wraps in Photoshop: size the box to fit each line in the font used here.
    const inked = Math.max(1, node.width * scale);
    width = await fitTextWidth(
      { text: t.text, fontFamily: font.family, bold: font.bold, italic: font.italic, fontSize, letterSpacing: t.letterSpacing * scale },
      inked,
    );
    const ax = (t.anchor?.x ?? node.left) * scale;
    x = t.align === "center" ? ax - width / 2 : t.align === "right" ? ax - width : ax;
    // Put the first line's baseline where Photoshop had it.
    const baseline = (t.anchor?.y ?? node.top + t.fontSize) * scale;
    y = baseline - (t.lineHeight * fontSize) / 2 - BASELINE_OFFSET * fontSize;
  }
  const el: TextElement = {
    ...common(node.name),
    type: "text",
    text: t.text,
    fontFamily: font.family,
    fontSize,
    bold: font.bold,
    italic: font.italic,
    underline: t.underline,
    fill: t.fill,
    align: t.align,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing * scale,
    x,
    y,
    width: Math.max(width, 1),
    // The editor measures the real height when the design loads.
    height: fontSize * t.lineHeight * t.text.split("\n").length,
  };
  return el;
}
