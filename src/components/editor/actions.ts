"use client";

import { DEFAULT_FONT, ensureFont } from "@/lib/fonts";
import { primeAssetImage } from "@/lib/images";
import { type Element, type ShapeKind, uid } from "@/lib/model";
import { saveAsset } from "@/lib/storage";
import { normalize, useEditor } from "@/store/editor";

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

export async function insertText(preset: TextPreset) {
  const { W, H } = pageSize();
  const size = { heading: 0.075, subheading: 0.045, body: 0.028 }[preset] * Math.min(W, H) * 1.4;
  const label = { heading: "Add a heading", subheading: "Add a subheading", body: "Add a little bit of body text" }[preset];
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
  useEditor.getState().addElement(el);
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

function imageElement(assetId: string, iw: number, ih: number, W: number, H: number, at?: { x: number; y: number }): Element {
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
const SKIPPED = "Some files were skipped (not images or over 25 MB).";

/** Store image files as design assets and place them on the current page. Returns a warning, if any. */
export async function addImageFiles(files: File[], at?: { x: number; y: number }) {
  const images = files.filter((f) => f.type.startsWith("image/") && f.size <= MAX_IMAGE_BYTES);
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
    imageElement(id, img.naturalWidth, img.naturalHeight, d.width, d.height, at && { x: at.x + i * 20, y: at.y + i * 20 }),
  );
  st.mutate((dd) => {
    for (const { id, file, img } of added) {
      dd.assets[id] = { mime: file.type, name: file.name, width: img.naturalWidth, height: img.naturalHeight };
    }
    dd.pages.find((p) => p.id === st.pageId)?.elements.push(...els);
  });
  useEditor.setState({ selected: els.map((e) => e.id) });
  return warning;
}
