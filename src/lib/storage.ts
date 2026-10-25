import { createStore, del, get, keys, set, values } from "idb-keyval";
import type { Design, FontMeta } from "./model";

// Separate IndexedDB databases: idb-keyval supports one object store per DB.
type Store = ReturnType<typeof createStore>;
let stores: { designs: Store; assets: Store; thumbs: Store; fonts: Store } | null = null;
function db() {
  if (!stores) {
    stores = {
      designs: createStore("canvasme-designs", "kv"),
      assets: createStore("canvasme-assets", "kv"),
      thumbs: createStore("canvasme-thumbs", "kv"),
      fonts: createStore("canvasme-fonts", "kv"),
    };
  }
  return stores;
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Best effort only.
  }
}

export const saveDesign = (d: Design) => set(d.id, d, db().designs);
export const loadDesign = (id: string) => get<Design>(id, db().designs);
export const listDesigns = async () =>
  (await values<Design>(db().designs)).sort((a, b) => b.updatedAt - a.updatedAt);

export async function deleteDesign(id: string) {
  await del(id, db().designs);
  await del(id, db().thumbs);
  await collectOrphanAssets();
}

export const saveAsset = (id: string, blob: Blob) => set(id, blob, db().assets);
export const loadAsset = (id: string) => get<Blob>(id, db().assets);

/** A font the user uploaded; shared by every design in this browser. */
export type StoredFont = FontMeta & { id: string; blob: Blob; addedAt: number };
export const saveFont = (f: StoredFont) => set(f.id, f, db().fonts);
export const listFonts = async () => (await values<StoredFont>(db().fonts)).sort((a, b) => a.addedAt - b.addedAt);
export const deleteFont = (id: string) => del(id, db().fonts);

export const saveThumb = (id: string, blob: Blob) => set(id, blob, db().thumbs);
export const loadThumb = (id: string) => get<Blob>(id, db().thumbs);

// Assets can be shared between designs (duplicate / re-import), so only drop
// blobs that no remaining design references.
async function collectOrphanAssets() {
  const used = new Set<string>();
  for (const d of await values<Design>(db().designs)) {
    for (const id of Object.keys(d.assets)) used.add(id);
  }
  for (const k of await keys(db().assets)) {
    if (!used.has(String(k))) await del(k, db().assets);
  }
}

const PREFS_KEY = "canvasme:prefs";
export type Prefs = { recentColors: string[]; backupReminderDismissed?: boolean };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { recentColors: [], ...JSON.parse(raw) };
  } catch {}
  return { recentColors: [] };
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
}
