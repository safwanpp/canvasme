import { DEFAULT_FONT, FONTS } from "../fonts";
import { listFonts } from "../storage";

export type FontMatch = { family: string; bold: boolean; italic: boolean; missing?: string };

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Suffixes foundries add to PostScript names that aren't part of the family ("ArialMT", "MinionPro").
const SUFFIXES = ["mt", "ps", "std", "pro", "lt", "com", "variable", "vf"];

/** Families a design can use here: the built-in ones and any the user uploaded to this browser. */
export async function availableFamilies() {
  const uploaded = await listFonts().catch(() => []);
  return [...FONTS.map((f) => f.family), ...uploaded.map((f) => f.family)];
}

/**
 * Match a font name from a PSD or PDF ("ABCDEF+Montserrat-BoldItalic", "PlayfairDisplay-Regular",
 * "Inter Bold") to a family canvas.me has. Unknown fonts fall back to the default font, and
 * `missing` carries a readable name to tell the user.
 */
export function matchFont(raw: string, families: string[], fauxBold = false, fauxItalic = false): FontMatch {
  const name = raw.replace(/^[A-Z]{6}\+/, "").trim();
  const bold = fauxBold || /bold|black|heavy|semibold|demi|extrabold/i.test(name);
  const italic = fauxItalic || /italic|oblique/i.test(name);
  const base = name.split(/[-,]/)[0];
  const byKey = new Map(families.map((f) => [squash(f), f]));
  const candidates = [squash(base), squash(name)];
  for (const c of [...candidates]) {
    for (const suf of SUFFIXES) if (c.endsWith(suf) && c.length > suf.length + 2) candidates.push(c.slice(0, -suf.length));
  }
  for (const c of candidates) {
    const hit = byKey.get(c);
    if (hit) return { family: hit, bold, italic };
  }
  // "Inter Bold" or "InterBold": a known family followed by a weight word.
  for (const [key, family] of [...byKey].sort((a, b) => b[0].length - a[0].length)) {
    if (key.length >= 4 && candidates[0].startsWith(key)) return { family, bold, italic };
  }
  const readable = base.replace(/([a-z])([A-Z])/g, "$1 $2").trim() || name || "Unknown font";
  return { family: DEFAULT_FONT, bold, italic, missing: readable };
}
