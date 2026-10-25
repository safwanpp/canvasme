import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import { importFonts, getUploadedFont } from "./customFonts";
import { FONTS } from "./fonts";
import { Design, FORMAT_VERSION, type FontMeta, pruneAssets, uid } from "./model";
import { loadAsset, saveAsset, saveDesign, saveThumb } from "./storage";
import { renderThumbnail } from "./render";

export const WORKFILE_EXT = ".canvasme";
const MAX_WORKFILE_BYTES = 200 * 1024 * 1024;

const Manifest = z.object({
  format: z.literal("canvasme"),
  version: z.number().int().positive(),
  app: z.string(),
  createdAt: z.string(),
});

const extFor = (mime: string) => mime.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") ?? "bin";

export async function exportWorkfile(full: Design): Promise<Blob> {
  // Leave out earlier erase versions and other generated bitmaps nothing uses.
  const design = pruneAssets(full);
  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(
      JSON.stringify({ format: "canvasme", version: FORMAT_VERSION, app: "canvas.me", createdAt: new Date().toISOString() }),
    ),
  };
  // Carry uploaded fonts the design uses, so it looks the same when opened in another browser.
  const fonts: Record<string, FontMeta> = {};
  const used = new Set(design.pages.flatMap((p) => p.elements.flatMap((e) => (e.type === "text" ? [e.fontFamily] : []))));
  for (const family of used) {
    if (FONTS.some((f) => f.family === family)) continue;
    const font = await getUploadedFont(family);
    if (!font) continue;
    fonts[font.id] = { family: font.family, name: font.name, mime: font.mime };
    files[`fonts/${font.id}.${extFor(font.mime)}`] = new Uint8Array(await font.blob.arrayBuffer());
  }
  files["design.json"] = strToU8(JSON.stringify({ ...design, fonts }));
  for (const [id, meta] of Object.entries(design.assets)) {
    const blob = await loadAsset(id);
    if (blob) files[`assets/${id}.${extFor(meta.mime)}`] = new Uint8Array(await blob.arrayBuffer());
  }
  try {
    const thumb = await renderThumbnail(design, 512);
    files["thumbnail.png"] = new Uint8Array(await thumb.arrayBuffer());
  } catch {
    // Thumbnail is optional.
  }
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped as BlobPart], { type: "application/zip" });
}

/** Parse a .canvasme file and store it as a brand-new design. Returns the new design. */
export async function importWorkfile(file: File): Promise<Design> {
  if (file.size > MAX_WORKFILE_BYTES) throw new Error("File is too large (max 200 MB).");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error("This is not a valid .canvasme file.");
  }
  if (!files["manifest.json"] || !files["design.json"]) throw new Error("This is not a valid .canvasme file.");

  let manifestJson: unknown;
  let designJson: unknown;
  try {
    manifestJson = JSON.parse(strFromU8(files["manifest.json"]));
    designJson = JSON.parse(strFromU8(files["design.json"]));
  } catch {
    throw new Error("This is not a valid .canvasme file.");
  }
  const manifest = Manifest.safeParse(manifestJson);
  if (!manifest.success) throw new Error("This is not a valid .canvasme file.");
  if (manifest.data.version > FORMAT_VERSION) {
    throw new Error("This file was made with a newer version of canvas.me.");
  }

  const parsed = Design.safeParse(designJson);
  if (!parsed.success) throw new Error("The design inside this file is damaged.");

  // Give every imported asset a fresh id so a file can never overwrite
  // blobs that belong to designs already in this browser.
  const now = Date.now();
  const idMap = new Map(Object.keys(parsed.data.assets).map((old) => [old, uid()]));
  const design: Design = {
    ...parsed.data,
    id: uid(),
    createdAt: now,
    updatedAt: now,
    assets: Object.fromEntries(Object.entries(parsed.data.assets).map(([old, meta]) => [idMap.get(old)!, meta])),
    pages: parsed.data.pages.map((p) => ({
      ...p,
      elements: p.elements.map((e) =>
        e.type === "image"
          ? {
              ...e,
              assetId: idMap.get(e.assetId) ?? e.assetId,
              ...(e.eraseSource && { eraseSource: idMap.get(e.eraseSource) ?? e.eraseSource }),
            }
          : e,
      ),
    })),
  };

  await importFonts(
    Object.entries(parsed.data.fonts ?? {}).flatMap(([id, meta]) => {
      const data = files[`fonts/${id}.${extFor(meta.mime)}`];
      return data ? [{ ...meta, blob: new Blob([data as BlobPart], { type: meta.mime }) }] : [];
    }),
  );
  for (const [oldId, meta] of Object.entries(parsed.data.assets)) {
    const data = files[`assets/${oldId}.${extFor(meta.mime)}`];
    if (data) await saveAsset(idMap.get(oldId)!, new Blob([data as BlobPart], { type: meta.mime }));
  }
  await saveDesign(design);
  if (files["thumbnail.png"]) {
    await saveThumb(design.id, new Blob([files["thumbnail.png"] as BlobPart], { type: "image/png" }));
  }
  return design;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFilename = (name: string) => name.replace(/[^\w\- ]+/g, "").trim() || "design";
