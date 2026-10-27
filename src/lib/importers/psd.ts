import { type AdjustmentElement, type Design, type Element, type ImageElement, type ImportReportItem, newDesign, newPage, type Page, type ShapeElement, type TextElement, uid, type VectorElement } from "../model";
import { transformSubpaths } from "../vector";
import { saveAsset, saveDesign, saveThumb } from "../storage";
import { renderThumbnail } from "../render";
import { availableFamilies, matchFont } from "./fontMatch";
import type { PsdRequest, PsdResponse } from "./psd.worker";
import type { PsdNode, PsdResult } from "./psdConvert";
import { scaleEffects } from "./psdEffects";
import { makeGroup, tidyTree } from "../tree";
import { normalizeRuns } from "../richText";
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
  const outcome = await buildDesignFromPsdResult(result, file.name, { saveAsset });
  await saveDesign(outcome.design);
  try {
    await saveThumb(outcome.design.id, await renderThumbnail(outcome.design));
  } catch {
    // The editor makes one on first save.
  }
  return outcome;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** The design for a parsed file. Pure apart from `deps.saveAsset`, so tests can run it. */
export async function buildDesignFromPsdResult(
  result: PsdResult,
  fileName: string,
  deps: { saveAsset: (id: string, blob: Blob) => Promise<unknown> },
): Promise<ImportOutcome> {
  // Photoshop artboards: each top-level artboard folder becomes a page of its own size.
  const boards = result.flattened ? [] : result.nodes.filter((n) => n.kind === "group" && n.artboard && n.parent === null);
  const first = boards[0]?.artboard;
  const fit = fitDesignSize(first?.width ?? result.width, first?.height ?? result.height);
  // One scale for every page, so the biggest artboard also fits the editor's limit.
  // Layers outside every artboard get a page at the document's size, which must fit too.
  const byKey = new Map(result.nodes.filter((n) => n.kind === "group").map((n) => [n.key!, n]));
  const hasOutside = boards.length > 0 && result.nodes.some((n) => !boards.includes(n) && !ownerBoard(byKey, n));
  const scale = Math.min(
    fit.scale,
    ...boards.map((b) => fitDesignSize(b.artboard!.width, b.artboard!.height).scale),
    ...(hasOutside ? [fitDesignSize(result.width, result.height).scale] : []),
  );
  const width = first ? Math.max(1, Math.round(first.width * scale)) : fit.width;
  const height = first ? Math.max(1, Math.round(first.height * scale)) : fit.height;
  const design: Design = newDesign(baseName(fileName), width, height);
  const page = design.pages[0];
  const notes = [...result.notes];
  const items: ImportReportItem[] = [];
  if (scale < 1) notes.push(`The canvas was scaled down to ${width} × ${height} px to fit canvas.me's 8000 px limit.`);

  const addImage = async (blob: Blob, name: string, box: { x: number; y: number; w: number; h: number }) => {
    const assetId = uid();
    await deps.saveAsset(assetId, blob);
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

  // A smart object drawn from its original file, in its placed frame.
  const smartImage = async (node: PsdNode) => {
    const o = node.original!;
    const assetId = uid();
    await deps.saveAsset(assetId, o.blob);
    design.assets[assetId] = { mime: o.mime, name: o.name.slice(0, 120), width: o.width, height: o.height, generated: true };
    const el: ImageElement = {
      ...common(node.name),
      type: "image",
      assetId,
      cornerRadius: 0,
      x: node.left * scale,
      y: node.top * scale,
      width: Math.max(node.width * scale, 0.1),
      height: Math.max(node.height * scale, 0.1),
      rotation: node.rotation ?? 0,
      source: { kind: "smart-object", name: o.name.slice(0, 200) },
    };
    return el;
  };

  // An adjustment layer covers its whole page; its mask (if any) is an asset placed on that page.
  const adjustmentElement = async (node: PsdNode, sc: number, pageW: number, pageH: number) => {
    const el: AdjustmentElement = { ...common(node.name), type: "adjustment", adjustment: node.adjustment!, x: 0, y: 0, width: pageW, height: pageH };
    const m = node.mask;
    if (m) {
      const assetId = uid();
      await deps.saveAsset(assetId, m.png);
      design.assets[assetId] = { mime: "image/png", name: `${node.name.slice(0, 80)} mask.png`, width: m.width, height: m.height, generated: true };
      el.rasterMask = {
        assetId,
        x: m.left * sc,
        y: m.top * sc,
        width: Math.max(m.width * sc, 0.1),
        height: Math.max(m.height * sc, 0.1),
        ...(m.outside ? { outside: m.outside } : {}),
      };
    }
    return el;
  };

  if (result.flattened) {
    if (!result.composite) throw new Error("Couldn't read this Photoshop file.");
    page.elements.push(await addImage(result.composite, "Photoshop image", { x: 0, y: 0, w: result.width, h: result.height }));
    notes.unshift("No layers could be read, so the file came in as one flattened image.");
  } else {
    if (result.lossy && result.composite && !boards.length) {
      const flat = await addImage(result.composite, "Flattened (as saved by Photoshop)", { x: 0, y: 0, w: result.width, h: result.height });
      page.elements.push({ ...flat, hidden: true, locked: true });
      notes.push("The flattened image Photoshop saved is the hidden, locked bottom layer, for comparison.");
    }
    const families = await availableFamilies();
    const missing = new Set<string>();
    // Nodes come bottom first with each group right above its members: the editor's own order.
    const groupIds = new Map<number, string>();
    const idOf = (key: number | null) => {
      if (key === null) return null;
      if (!groupIds.has(key)) groupIds.set(key, uid());
      return groupIds.get(key)!;
    };
    const buckets = boards.length ? artboardBuckets(result, design, scale, boards) : [{ page, nodes: result.nodes, w: width, h: height }];
    if (boards.length) {
      design.pages = buckets.map((b) => b.page);
      if (buckets.length > boards.length) notes.push("Layers outside every artboard are on the last page, at the document's size.");
      if (result.lossy && result.composite) {
        // The whole-document composite sits under each page's layers, moved so the artboard lines up.
        const ref = await addImage(result.composite, "Flattened (as saved by Photoshop)", { x: 0, y: 0, w: result.width, h: result.height });
        buckets.forEach((b, i) => {
          const ab = boards[i]?.artboard;
          b.page.elements.push({ ...ref, id: uid(), x: ab ? 0 - ab.left * scale : 0, y: ab ? 0 - ab.top * scale : 0, hidden: true, locked: true });
        });
        notes.push("The flattened image Photoshop saved is the hidden, locked bottom layer of each page (shifted to line up with its artboard), for comparison.");
      }
    }
    for (const { page, nodes, w: pageW, h: pageH } of buckets) {
    for (const node of nodes) {
      const el: Element =
        node.kind === "group"
          ? { ...makeGroup(idOf(node.key!)!, null, node.name.slice(0, 120)), ...(node.collapsed ? { collapsed: true } : {}) }
          : node.kind === "adjustment"
            ? await adjustmentElement(node, scale, pageW, pageH)
          : node.text
            ? await textElement(node, scale, families, missing)
            : node.vector
              ? vectorElement(node, scale)
              : node.original
                ? await smartImage(node)
                : await addImage(node.png!, node.name, { x: node.left, y: node.top, w: node.width, h: node.height });
      if (node.vectorMask) {
        const m = node.vectorMask;
        // Into the element's own frame: about its top-left, unrotated (smart objects can be rotated).
        const a = ((node.rotation ?? 0) * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const local = (x: number, y: number): [number, number] => {
          const dx = x - node.left;
          const dy = y - node.top;
          return [(dx * cos + dy * sin) * scale, (-dx * sin + dy * cos) * scale];
        };
        el.vectorMask = { ...m, subpaths: transformSubpaths(m.subpaths, local) };
      }
      el.opacity = Math.max(0, Math.min(1, node.opacity));
      el.hidden = node.hidden;
      el.groupId = idOf(node.parent);
      if (node.clipped) el.clipped = true;
      if (node.blendMode) el.blendMode = node.blendMode;
      if (node.fillOpacity !== undefined && node.fillOpacity < 1) el.fillOpacity = Math.max(0, node.fillOpacity);
      if (node.effects) el.effects = scaleEffects(node.effects, scale);
      for (const i of node.issues ?? []) items.push({ elementId: el.id, layerName: node.name.slice(0, 120), kind: i.kind, message: i.message.slice(0, 500) });
      page.elements.push(el);
    }
    // Empty groups go; group boxes come from their members.
    page.elements = tidyTree(page.elements);
    }
    for (const i of result.layerIssues) items.push({ layerName: i.layerName.slice(0, 120), kind: i.kind, message: i.message.slice(0, 500) });
    const kept = new Set(design.pages.flatMap((p) => p.elements.map((e) => e.id)));
    for (const i of items) if (i.elementId && !kept.has(i.elementId)) delete i.elementId;
    if (missing.size) notes.push(missingFontsNote(missing));
    if (!kept.size) throw new Error("This Photoshop file has no layers canvas.me can import.");
  }

  const kept = items.slice(0, 2000);
  let summary: string[] = [];
  if (kept.length) {
    const layers = (kind: ImportReportItem["kind"]) => new Set(kept.filter((i) => i.kind === kind).map((i) => i.elementId ?? i.layerName)).size;
    summary = [
      layers("baked") && `${plural(layers("baked"), "layer", "layers")} had effects baked into pixels.`,
      layers("approximated") && `${plural(layers("approximated"), "layer", "layers")} had effects or blend modes simplified.`,
      layers("dropped") && `${plural(layers("dropped"), "layer", "layers")} lost effects or settings canvas.me can't keep.`,
    ].filter((x): x is string => !!x);
  }
  // The design keeps every note (Layers panel > Import notes); the toast adds a pointer there.
  if (notes.length || kept.length) {
    const persisted = [...summary, ...notes].slice(0, 50).map((n) => n.slice(0, 500));
    design.importReport = { source: "psd", fileName: fileName.slice(0, 200), at: Date.now(), notes: persisted, items: kept };
  }
  if (kept.length) notes.push(`${summary.join(" ")} See Import notes in the Layers panel.`);
  return {
    design,
    report: notes.length ? { title: "Opened from Photoshop", notes, ...(items.length ? { itemsCount: Math.min(items.length, 2000) } : {}) } : null,
  };
}

/** A copy of the node moved by (dx, dy) document pixels, with its vectors, text frame and mask. */
function shiftNode(node: PsdNode, dx: number, dy: number): PsdNode {
  if (!dx && !dy) return node;
  const mv = (x: number, y: number): [number, number] => [x + dx, y + dy];
  const out: PsdNode = { ...node, left: node.left + dx, top: node.top + dy };
  if (node.vector) out.vector = { ...node.vector, subpaths: transformSubpaths(node.vector.subpaths, mv) };
  if (node.vectorMask) out.vectorMask = { ...node.vectorMask, subpaths: transformSubpaths(node.vectorMask.subpaths, mv) };
  if (node.text) {
    out.text = { ...node.text };
    if (node.text.box) out.text.box = { ...node.text.box, x: node.text.box.x + dx, y: node.text.box.y + dy };
    if (node.text.anchor) out.text.anchor = { x: node.text.anchor.x + dx, y: node.text.anchor.y + dy };
  }
  if (node.mask) out.mask = { ...node.mask, left: node.mask.left + dx, top: node.mask.top + dy };
  return out;
}

/**
 * One page per artboard (in file order), holding the nodes inside it moved so the artboard's
 * corner is the origin; the artboard folder itself goes. Nodes outside every artboard share a
 * last page at the document's size.
 */
function ownerBoard(byKey: Map<number, PsdNode>, n: PsdNode): PsdNode | null {
  for (let cur: PsdNode | undefined = n, i = 0; cur && i < 1000; i++) {
    if (cur.kind === "group" && cur.artboard && cur.parent === null) return cur;
    cur = cur.parent === null ? undefined : byKey.get(cur.parent);
  }
  return null;
}

function artboardBuckets(result: PsdResult, design: Design, scale: number, boards: PsdNode[]) {
  const byKey = new Map(result.nodes.filter((n) => n.kind === "group").map((n) => [n.key!, n]));
  const buckets = boards.map((b, i) => {
    const ab = b.artboard!;
    const page = i === 0 ? design.pages[0] : newPage();
    page.background = ab.background ?? "#ffffff";
    page.width = Math.max(1, Math.round(ab.width * scale));
    page.height = Math.max(1, Math.round(ab.height * scale));
    return { board: b, page, nodes: [] as PsdNode[], w: page.width, h: page.height };
  });
  const outside: PsdNode[] = [];
  for (const n of result.nodes) {
    if (boards.includes(n)) continue;
    const owner = ownerBoard(byKey, n);
    if (!owner) {
      outside.push(n);
      continue;
    }
    const b = buckets[boards.indexOf(owner)];
    const ab = owner.artboard!;
    // The artboard's own members sit at the page's top level; a hidden artboard hides them.
    const moved = shiftNode(n, -ab.left, -ab.top);
    b.nodes.push(n.parent === owner.key ? { ...moved, parent: null, hidden: moved.hidden || owner.hidden } : moved);
  }
  const out: { page: Page; nodes: PsdNode[]; w: number; h: number }[] = buckets;
  if (outside.length) {
    const page = newPage();
    page.width = Math.max(1, Math.round(result.width * scale));
    page.height = Math.max(1, Math.round(result.height * scale));
    out.push({ page, nodes: outside, w: page.width, h: page.height });
  }
  return out;
}

/** A shape layer's vector, or the shape element a live rectangle or ellipse is exactly. */
function vectorElement(node: PsdNode, scale: number): VectorElement | ShapeElement {
  const v = node.vector!;
  const box = { x: node.left * scale, y: node.top * scale, width: Math.max(node.width * scale, 0.1), height: Math.max(node.height * scale, 0.1) };
  if (v.shape && v.fill?.type === "color") {
    return {
      ...common(node.name),
      ...box,
      type: "shape",
      shape: v.shape.kind,
      fill: v.fill.color,
      stroke: v.stroke?.type === "color" ? v.stroke.color : "#000000",
      strokeWidth: v.stroke ? v.strokeWidth * scale : 0,
      cornerRadius: v.shape.cornerRadius * scale,
    };
  }
  const { shape: _shape, ...rest } = v;
  void _shape;
  return {
    ...common(node.name),
    ...box,
    ...rest,
    type: "vector",
    subpaths: transformSubpaths(v.subpaths, (x, y) => [(x - node.left) * scale, (y - node.top) * scale]),
    strokeWidth: v.strokeWidth * scale,
  };
}

/** The value covering the most characters (the first such on a tie). */
function vote<T>(runs: { length: number }[], value: (i: number) => T): T {
  const counts = new Map<T, number>();
  let best = value(0);
  let bestN = -1;
  runs.forEach((r, i) => {
    const v = value(i);
    const n = (counts.get(v) ?? 0) + r.length;
    counts.set(v, n);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  });
  return best;
}

/** The largest size on the first line (it sets where the first baseline sits). */
function firstLineSize(el: TextElement) {
  if (!el.runs) return el.fontSize;
  const end = el.text.indexOf("\n") < 0 ? el.text.length : el.text.indexOf("\n");
  let m = 0;
  let at = 0;
  for (const r of el.runs) {
    if (at >= Math.max(end, 1)) break;
    m = Math.max(m, r.fontSize ?? el.fontSize);
    at += r.length;
  }
  return m || el.fontSize;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

async function textElement(node: PsdNode, scale: number, families: string[], missing: Set<string>): Promise<Element> {
  const t = node.text!;
  // Each run's font, matched once per name; the element's own style is what most characters use.
  const fonts = t.runs.map((r) => {
    const m = matchFont(r.fontName, families, r.fauxBold, r.fauxItalic);
    if (m.missing) missing.add(m.missing);
    return m;
  });
  const runs = t.runs;
  const own = {
    fontFamily: vote(runs, (i) => fonts[i].family),
    bold: vote(runs, (i) => fonts[i].bold),
    italic: vote(runs, (i) => fonts[i].italic),
    fontSize: Math.max(1, round(vote(runs, (i) => runs[i].fontSize) * scale)),
    fill: vote(runs, (i) => runs[i].fill),
    underline: vote(runs, (i) => runs[i].underline),
    letterSpacing: round(vote(runs, (i) => runs[i].letterSpacing) * scale),
    align: vote(t.paragraphs ?? [{ length: 1 }], (i) => t.paragraphs?.[i].align ?? t.align),
  };
  const lineHeight = t.lineHeight;
  const el: TextElement = {
    ...common(node.name),
    type: "text",
    text: t.text,
    ...own,
    lineHeight,
    rotation: t.rotation,
    x: 0,
    y: 0,
    width: 1,
    // The editor measures the real height when the design loads.
    height: own.fontSize * lineHeight * t.text.split("\n").length,
  };
  // Every run as overrides of the element's style (normalizeRuns drops what equals it).
  el.runs = runs.map((r, i) => ({
    length: r.length,
    fontFamily: fonts[i].family,
    bold: fonts[i].bold,
    italic: fonts[i].italic,
    fontSize: Math.max(1, round(r.fontSize * scale)),
    fill: r.fill,
    underline: r.underline,
    strike: r.strike || undefined,
    letterSpacing: round(r.letterSpacing * scale),
    baselineShift: r.baselineShift ? round(r.baselineShift * scale) : undefined,
    caps: r.caps,
    scaleX: r.scaleX !== 1 ? round(r.scaleX) : undefined,
    scaleY: r.scaleY !== 1 ? round(r.scaleY) : undefined,
  }));
  if (t.paragraphs) {
    const sc = (v: number) => (v ? round(v * scale) : undefined);
    el.paragraphs = t.paragraphs.map((p) => ({
      length: p.length,
      align: p.align,
      indent: sc(p.indent),
      startIndent: sc(p.startIndent),
      endIndent: sc(p.endIndent),
      spaceBefore: sc(p.spaceBefore),
      spaceAfter: sc(p.spaceAfter),
    }));
  }
  const tidy = normalizeRuns(el);
  delete el.runs;
  delete el.paragraphs;
  if (tidy.runs) el.runs = tidy.runs;
  if (tidy.paragraphs) el.paragraphs = tidy.paragraphs;

  const rot = (t.rotation * Math.PI) / 180;
  if (t.box) {
    el.x = t.box.x * scale;
    el.y = t.box.y * scale;
    el.width = Math.max(1, t.box.width * scale);
  } else {
    // Point text never wraps in Photoshop: size the box to fit each line in the font used here.
    // A rotated layer's pixel bounds aren't its line width, so only the text decides there.
    const inked = t.rotation ? 1 : Math.max(1, node.width * scale);
    el.width = Math.max(1, await fitTextWidth(el, inked));
    const ax = (t.anchor?.x ?? node.left) * scale;
    const ay = (t.anchor?.y ?? node.top + t.fontSize) * scale;
    // From the first line's baseline start to the box's top-left, in the text's own (rotated) frame.
    const dx = own.align === "center" ? -el.width / 2 : own.align === "right" ? -el.width : 0;
    const firstSize = firstLineSize(el);
    const dy = -((lineHeight * firstSize) / 2 + BASELINE_OFFSET * firstSize);
    el.x = ax + dx * Math.cos(rot) - dy * Math.sin(rot);
    el.y = ay + dx * Math.sin(rot) + dy * Math.cos(rot);
  }
  return el;
}
