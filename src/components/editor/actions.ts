"use client";

import { DEFAULT_FONT, ensureFont } from "@/lib/fonts";
import { primeAssetImage } from "@/lib/images";
import { type Element, type IMAGE_MIMES, isAllowedImage, type ShapeKind, uid } from "@/lib/model";
import { removeBackground } from "@/lib/bgRemove";
import { loadAsset, saveAsset } from "@/lib/storage";
import { lineBetween } from "@/lib/render";
import { normalize, useEditor } from "@/store/editor";
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
  const d = useEditor.getState().design!;
  return { W: d.width, H: d.height };
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
  if (select) useEditor.setState({ selected: els.map((e) => e.id) });
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

/** Sticky note: a rounded square with a text box, grouped. Returns the text's id for editing. */
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
  place([note, text]);
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
  st.addElement(imageElement(assetId, meta.width, meta.height, d.width, d.height, at));
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
      d.width,
      d.height,
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
