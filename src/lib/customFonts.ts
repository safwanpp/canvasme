"use client";

import { create } from "zustand";
import { FONTS } from "./fonts";
import { FONT_MIMES, uid } from "./model";
import { deleteFont, listFonts, saveFont, type StoredFont } from "./storage";

export const MAX_FONT_BYTES = 15 * 1024 * 1024;
export const FONT_ACCEPT = ".ttf,.otf,.woff,.woff2";

type FontMime = (typeof FONT_MIMES)[number];
type UploadedFont = Omit<StoredFont, "blob">;

/** Uploaded fonts in this browser, loaded once from IndexedDB. */
export const useUploadedFonts = create<{ fonts: UploadedFont[]; loaded: boolean }>(() => ({ fonts: [], loaded: false }));

let loading: Promise<StoredFont[]> | null = null;
const loadAll = () =>
  (loading ??= listFonts()
    .catch(() => [] as StoredFont[])
    .then((all) => {
      useUploadedFonts.setState({
        fonts: all.map(({ id, family, name, mime, addedAt }) => ({ id, family, name, mime, addedAt })),
        loaded: true,
      });
      return all;
    }));

export const refreshUploadedFonts = () => {
  loading = null;
  return loadAll();
};

// Font files start with one of these signatures: TrueType, Apple TrueType, OpenType (CFF), WOFF, WOFF2.
const SIGNATURES: [string, FontMime][] = [
  ["\x00\x01\x00\x00", "font/ttf"],
  ["true", "font/ttf"],
  ["OTTO", "font/otf"],
  ["wOFF", "font/woff"],
  ["wOF2", "font/woff2"],
];

async function sniff(file: File): Promise<FontMime | null> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const sig = String.fromCharCode(...head);
  return SIGNATURES.find(([s]) => s === sig)?.[1] ?? null;
}

/** "Brand-Font_Bold.otf" -> "Brand Font Bold", made unique against built-in and uploaded families. */
function familyFor(fileName: string, taken: Set<string>) {
  const base =
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Uploaded font";
  let family = base;
  for (let n = 2; taken.has(family.toLowerCase()); n++) family = `${base} ${n}`;
  return family;
}

const faces = new Map<string, Promise<void>>();

function register(family: string, blob: Blob) {
  let p = faces.get(family);
  if (!p) {
    p = blob
      .arrayBuffer()
      .then((buf) => new FontFace(family, buf, { display: "swap" }).load())
      .then((face) => {
        document.fonts.add(face);
      });
    faces.set(family, p);
    p.catch(() => faces.delete(family));
  }
  return p;
}

/** Load an uploaded font by family so canvas can draw with it. Unknown families resolve quietly. */
export async function loadUploadedFont(family: string) {
  const font = (await loadAll()).find((f) => f.family === family);
  if (font) await register(family, font.blob).catch(() => {});
}

export async function getUploadedFont(family: string) {
  return (await loadAll()).find((f) => f.family === family) ?? null;
}

/** Validate and store font files. Returns the new families and a warning if any file was skipped. */
export async function addFontFiles(files: File[]) {
  const existing = await loadAll();
  const taken = new Set([...FONTS.map((f) => f.family), ...existing.map((f) => f.family)].map((f) => f.toLowerCase()));
  const added: string[] = [];
  let skipped = 0;
  for (const file of files) {
    const mime = file.size <= MAX_FONT_BYTES ? await sniff(file) : null;
    if (!mime) {
      skipped++;
      continue;
    }
    const family = familyFor(file.name, taken);
    try {
      // The browser's font sanitiser rejects broken or hostile files here.
      await register(family, file);
    } catch {
      skipped++;
      continue;
    }
    await saveFont({ id: uid(), family, name: file.name, mime, blob: file, addedAt: Date.now() });
    taken.add(family.toLowerCase());
    added.push(family);
  }
  await refreshUploadedFonts();
  return {
    added,
    warning: skipped ? "Some files were skipped. Use TTF, OTF, WOFF or WOFF2 fonts under 15 MB." : null,
  };
}

/** Store fonts carried in a work file, unless a font with that family is already here. */
export async function importFonts(fonts: { family: string; name: string; mime: FontMime; blob: Blob }[]) {
  const existing = new Set([...FONTS.map((f) => f.family), ...(await loadAll()).map((f) => f.family)]);
  for (const f of fonts) {
    if (existing.has(f.family)) continue;
    await saveFont({ ...f, id: uid(), addedAt: Date.now() });
    existing.add(f.family);
  }
  await refreshUploadedFonts();
}

export async function removeUploadedFont(id: string) {
  await deleteFont(id);
  await refreshUploadedFonts();
}
