"use client";

import { DEFAULT_FONT, ensureFont } from "@/lib/fonts";
import { hasActiveEffects } from "@/lib/effects";
import { primeAssetImage } from "@/lib/images";
import { type Element, type IMAGE_MIMES, isAllowedImage, pageSize as sizeOf, type ShapeKind, uid } from "@/lib/model";
import { removeBackground } from "@/lib/bgRemove";
import { loadAsset, saveAsset } from "@/lib/storage";
import { rotate } from "@/lib/mask";
import { clipBase, makeGroup } from "@/lib/tree";
import { canvasToBlob, lineBetween, renderElementsCanvas } from "@/lib/render";
import { lockedIds, normalize, useEditor } from "@/store/editor";
import { useView } from "@/store/view";

export const ASSET_DRAG_TYPE = "application/x-canvasme-asset";

const base = () => ({
  id: uid(),
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  groupId: null,
});

function pageSize() {
  const st = useEditor.getState();
  const { width, height } = sizeOf(st.design!, st.design!.pages.find((p) => p.id === st.pageId));
  return { W: width, H: height };
}

export type TextPreset = "heading" | "subheading" | "body";

/** Add a text box; `at` places its centre there (Text tool), otherwise it is centred on the page. Returns its id. */
export async function insertText(preset: TextPreset, at?: { x: number; y: number }) {
  const { W, H } = pageSize();
  const size = { heading: 0.075, subheading: 0.045, body: 0.028 }[preset] * Math.min(W, H) * 1.4;
  const label = { heading: "Add a heading", subheading: "Add a subheading", body: "Add a little bit of body text" }[
    preset
  ];
  await ensureFont(DEFAULT_FONT);
  const width = Math.min(W * 0.8, size * label.length * 0.62);
  const el = normalize({
    ...base(),
    type: "text",
    x: (W - width) / 2,
    y: 0,
    width,
    height: size,
    text: label,
    fontFamily: DEFAULT_FONT,
    fontSize: Math.round(size),
    bold: preset !== "body",
    italic: false,
    underline: false,
    fill: "#111827",
    align: "center",
    lineHeight: 1.2,
    letterSpacing: 0,
  });
  el.y = (H - el.height) / 2;
  if (at) {
    el.x = at.x - el.width / 2;
    el.y = at.y - el.height / 2;
    place([el]);
  } else useEditor.getState().addElement(el);
  return el.id;
}

export function insertShape(shape: ShapeKind, rounded = false) {
  const { W, H } = pageSize();
  const s = Math.min(W, H) * 0.3;
  useEditor.getState().addElement({
    ...base(),
    type: "shape",
    shape,
    x: (W - s) / 2,
    y: (H - s) / 2,
    width: s,
    height: s,
    fill: "#94a3b8",
    stroke: "#0f172a",
    strokeWidth: 0,
    cornerRadius: rounded ? s * 0.15 : 0,
  });
}

type Box = { x: number; y: number; width: number; height: number };

/** Add elements exactly where a tool put them (addElement cascades repeats), optionally selecting them. */
function place(els: Element[], select = true) {
  const st = useEditor.getState();
  st.mutate((d) => d.pages.find((p) => p.id === st.pageId)?.elements.push(...els));
  if (select) useEditor.setState({ selected: els.filter((e) => e.type !== "group").map((e) => e.id) });
}

/** Shape tool: a dragged box, or a default-size shape centred on a click. */
export function placeShape(shape: ShapeKind, box: Box) {
  const { W, H } = pageSize();
  const s = Math.min(W, H) * 0.2;
  const b = box.width < 4 && box.height < 4 ? { x: box.x - s / 2, y: box.y - s / 2, width: s, height: s } : box;
  place([
    {
      ...base(),
      type: "shape",
      shape,
      ...b,
      width: Math.max(5, b.width),
      height: Math.max(5, b.height),
      fill: "#94a3b8",
      stroke: "#0f172a",
      strokeWidth: 0,
      cornerRadius: 0,
    },
  ]);
}

/** Line tool: a line from p0 to p1. Lines are stored horizontal and rotated about their top-left. */
export function placeLine(p0: { x: number; y: number }, p1: { x: number; y: number }) {
  const { W, H } = pageSize();
  const strokeWidth = Math.max(2, Math.round(Math.min(W, H) * 0.006));
  let [a, b] = [p0, p1];
  if (Math.hypot(b.x - a.x, b.y - a.y) < 4) {
    const w = W * 0.3;
    [a, b] = [
      { x: p0.x - w / 2, y: p0.y },
      { x: p0.x + w / 2, y: p0.y },
    ];
  }
  const el = normalize({
    ...base(),
    type: "line",
    x: 0,
    y: 0,
    width: 1,
    height: strokeWidth,
    stroke: "#111827",
    strokeWidth,
    dashed: false,
    arrowEnd: false,
  });
  place([{ ...el, ...lineBetween(a, b, el.height) }]);
}

/** Sticky note: a rounded square with a text box, in a group. Returns the text's id for editing. */
export async function placeSticky(at: { x: number; y: number }) {
  const { W, H } = pageSize();
  const s = Math.min(W, H) * 0.28;
  const pad = s * 0.1;
  const groupId = uid();
  await ensureFont(DEFAULT_FONT);
  const note: Element = {
    ...base(),
    groupId,
    type: "shape",
    shape: "rect",
    x: at.x - s / 2,
    y: at.y - s / 2,
    width: s,
    height: s,
    fill: "#fde68a",
    stroke: "#0f172a",
    strokeWidth: 0,
    cornerRadius: s * 0.04,
  };
  const text = normalize({
    ...base(),
    groupId,
    type: "text",
    x: note.x + pad,
    y: note.y + pad,
    width: s - pad * 2,
    height: 0,
    text: "Add a note",
    fontFamily: DEFAULT_FONT,
    fontSize: Math.round(s * 0.09),
    bold: false,
    italic: false,
    underline: false,
    fill: "#422006",
    align: "left",
    lineHeight: 1.3,
    letterSpacing: 0,
  });
  place([note, text, makeGroup(groupId, null, "Sticky note")]);
  return text.id;
}

/** Draw tool: turn a stroke in page coordinates into a path element. Strokes are not selected, so drawing can go on. */
export function placePath(points: number[], stroke: string, strokeWidth: number, opacity: number) {
  if (points.length === 2) points = [...points, points[0] + 0.1, points[1]];
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  place(
    [
      {
        ...base(),
        type: "path",
        x,
        y,
        width: Math.max(1, Math.max(...xs) - x),
        height: Math.max(1, Math.max(...ys) - y),
        points: points.map((v, i) => Math.round((v - (i % 2 ? y : x)) * 10) / 10),
        stroke,
        strokeWidth,
        opacity,
      },
    ],
    false,
  );
}

export function insertLine(kind: "solid" | "dashed" | "arrow") {
  const { W, H } = pageSize();
  const w = W * 0.4;
  const strokeWidth = Math.max(2, Math.round(Math.min(W, H) * 0.006));
  useEditor.getState().addElement(
    normalize({
      ...base(),
      type: "line",
      x: (W - w) / 2,
      y: H / 2,
      width: w,
      height: strokeWidth,
      stroke: "#111827",
      strokeWidth,
      dashed: kind === "dashed",
      arrowEnd: kind === "arrow",
    }),
  );
}

function imageElement(
  assetId: string,
  iw: number,
  ih: number,
  W: number,
  H: number,
  at?: { x: number; y: number },
): Element {
  const s = Math.min(1, (W * 0.6) / iw, (H * 0.6) / ih);
  const width = iw * s;
  const height = ih * s;
  return {
    ...base(),
    type: "image",
    assetId,
    cornerRadius: 0,
    x: at ? at.x - width / 2 : (W - width) / 2,
    y: at ? at.y - height / 2 : (H - height) / 2,
    width,
    height,
  };
}

/** Place an existing asset of this design on the page, fitted to 60% of the page. */
export function insertAsset(assetId: string, at?: { x: number; y: number }) {
  const st = useEditor.getState();
  const d = st.design;
  const meta = d?.assets[assetId];
  if (!d || !meta) return;
  const { W, H } = pageSize();
  st.addElement(imageElement(assetId, meta.width, meta.height, W, H, at));
}

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const SKIPPED = "Some files were skipped. Use PNG, JPG, GIF, WebP or AVIF under 25 MB.";

/** Store image files as design assets and place them on the current page. Returns a warning, if any. */
export async function addImageFiles(files: File[], at?: { x: number; y: number }) {
  const images = files.filter((f) => isAllowedImage(f.type) && f.size <= MAX_IMAGE_BYTES);
  const warning = images.length < files.length ? SKIPPED : null;
  const added: { id: string; file: File; img: HTMLImageElement }[] = [];
  for (const file of images) {
    const id = uid();
    try {
      const img = await primeAssetImage(id, file);
      await saveAsset(id, file);
      added.push({ id, file, img });
    } catch {
      // Unreadable image; skip it.
    }
  }
  if (!added.length) return warning;

  const st = useEditor.getState();
  const d = st.design!;
  const els = added.map(({ id, img }, i) =>
    imageElement(
      id,
      img.naturalWidth,
      img.naturalHeight,
      pageSize().W,
      pageSize().H,
      at && { x: at.x + i * 20, y: at.y + i * 20 },
    ),
  );
  st.mutate((dd) => {
    for (const { id, file, img } of added) {
      dd.assets[id] = {
        mime: file.type as (typeof IMAGE_MIMES)[number],
        name: file.name,
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    }
    dd.pages.find((p) => p.id === st.pageId)?.elements.push(...els);
  });
  useEditor.setState({ selected: els.map((e) => e.id) });
  return warning;
}

/**
 * Remove the background of an image element on this device and swap in the transparent PNG
 * as a new asset. The original asset stays in the design, so undo brings it back.
 */
export async function removeImageBackground(elId: string) {
  const view = useView.getState();
  if (view.bgJob && !view.bgJob.error) return;
  const d = useEditor.getState().design;
  const el = d?.pages.flatMap((p) => p.elements).find((e) => e.id === elId);
  if (!d || el?.type !== "image") return;
  const meta = d.assets[el.assetId];
  const blob = await loadAsset(el.assetId);
  if (!meta || !blob) return;

  const setJob = (job: Partial<NonNullable<typeof view.bgJob>>) =>
    useView.getState().set({ bgJob: { elId, progress: null, ...job } });
  setJob({});
  try {
    const out = await removeBackground(blob, (progress) => setJob({ progress }));
    const id = uid();
    const img = await primeAssetImage(id, out);
    await saveAsset(id, out);
    useEditor.getState().mutate((dd) => {
      dd.assets[id] = {
        mime: "image/png",
        name: `${meta.name.replace(/\.[^.]+$/, "")} (no background).png`,
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
      for (const p of dd.pages) for (const e of p.elements) if (e.id === elId && e.type === "image") e.assetId = id;
    });
    useView.getState().set({ bgJob: null });
  } catch (err) {
    setJob({ error: err instanceof Error ? err.message : "Background removal failed" });
  }
}

/**
 * Whether Rasterize would change anything: a plain, uncropped, unmasked picture is already a bitmap.
 * `locked` holds the page's effectively locked ids (locked themselves or inside a locked group).
 */
export function canRasterize(els: Element[], locked: ReadonlySet<string>) {
  const shown = els.filter((e) => !e.hidden);
  // An adjustment alone has no pixels of its own to keep.
  if (shown.every((e) => e.type === "adjustment")) return false;
  if (!shown.length || els.some((e) => e.locked || locked.has(e.id))) return false;
  const e = shown[0];
  return (
    shown.length > 1 ||
    e.type !== "image" ||
    !!e.mask ||
    !!e.vectorMask ||
    !!e.crop ||
    !!e.filters?.length ||
    e.cornerRadius > 0 ||
    hasActiveEffects(e.effects) ||
    (e.fillOpacity ?? 1) < 1
  );
}

/**
 * Turn elements into one bitmap image, drawn by the same code as export, in their place
 * in the layer order. One undo step brings the originals back.
 */
export async function rasterizeElements(ids: string[]) {
  const st = useEditor.getState();
  const page = st.design?.pages.find((p) => p.id === st.pageId);
  if (!page) return;
  // Hidden elements are left where they are; they would render as nothing.
  const els = page.elements.filter((e) => ids.includes(e.id) && !e.hidden);
  if (!canRasterize(els, lockedIds(page.elements))) return;
  // Effects and fill opacity are drawn into the bitmap. One element's blend mode is not (on a
  // transparent bitmap it would draw as normal): the image keeps it, so it still blends.
  const single = els.length === 1;
  // Several: a clipped one stays clipped in the bitmap only when its base is among them.
  const picked = new Set(els.map((e) => e.id));
  const toDraw = single
    ? [{ ...els[0], blendMode: undefined, clipped: undefined }]
    : els.map((e) => (e.clipped && !picked.has(clipBase(page.elements, e.id) ?? "") ? { ...e, clipped: undefined } : e));
  const { canvas, box } = await renderElementsCanvas(toDraw);
  const blob = await canvasToBlob(canvas);
  const assetId = uid();
  const img = await primeAssetImage(assetId, blob);
  await saveAsset(assetId, blob);

  // One element keeps its rotation and opacity (its box is in its own frame); several
  // become one upright image with their opacities drawn in.
  const one = els.length === 1 ? els[0] : null;
  const at = one ? rotate(box.x, box.y, one.rotation) : box;
  const el: Element = {
    ...base(),
    type: "image",
    assetId,
    cornerRadius: 0,
    rasterized: true,
    x: (one?.x ?? 0) + at.x,
    y: (one?.y ?? 0) + at.y,
    width: box.width,
    height: box.height,
    rotation: one?.rotation ?? 0,
    opacity: one?.opacity ?? 1,
    name: one?.name,
    ...(one?.blendMode && { blendMode: one.blendMode }),
    // One clipped element's bitmap stays in its clip stack.
    ...(one?.clipped && { clipped: true }),
    // Stays in the front-most original's group (if that group is left empty, the store drops it).
    groupId: els[els.length - 1].groupId ?? null,
  };
  const gone = new Set(els.map((e) => e.id));
  let placed = false;
  st.mutate((d) => {
    const pg = d.pages.find((p) => p.id === page.id);
    // Something changed while rendering (undo, delete): skip rather than lose edits.
    if (!pg || [...gone].some((id) => !pg.elements.some((e) => e.id === id))) return;
    d.assets[assetId] = {
      mime: "image/png",
      name: `${one?.name ?? "Rasterized"}.png`,
      width: img.naturalWidth,
      height: img.naturalHeight,
      generated: true,
    };
    // The bitmap takes the place of the front-most original.
    const top = pg.elements.findLastIndex((e) => gone.has(e.id));
    const below = pg.elements.slice(0, top + 1).filter((e) => gone.has(e.id)).length;
    pg.elements = pg.elements.filter((e) => !gone.has(e.id));
    pg.elements.splice(top + 1 - below, 0, el);
    placed = true;
  });
  if (placed) useEditor.setState({ selected: [el.id] });
}

/**
 * Alt/Option + Cmd/Ctrl + G: clip to the layer below, or release (Photoshop's shortcut). Matched
 * by the physical key, since Option+G types "©" on macOS.
 */
export const isClipShortcut = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === "KeyG";
