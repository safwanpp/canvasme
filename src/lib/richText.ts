// Rich text: character style runs and paragraph runs on a text element, how they follow edits
// (remapRuns), whole-box toolbar edits, and a layout + drawing that mirror Konva.Text (word wrap
// at the box width, line height x the line's largest size, alignment), so a box with runs looks
// like the same box without them. Pure apart from the canvas context handed to drawRichText.
import type { ParagraphRun, TextElement, TextRun } from "./model";

type Run = { length: number };
type RunStyle = Omit<TextRun, "length">;
type ParaStyle = Omit<ParagraphRun, "length">;

/** Width of `text` drawn with the CSS `font` (no letter spacing). */
export type Measure = (text: string, font: string) => number;

/** A run's style with the element's values filled in. */
export type ResolvedStyle = {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  fill: string;
  letterSpacing: number;
  baselineShift: number;
  caps: "none" | "all" | "small";
  scaleX: number;
  scaleY: number;
};

export type Span = {
  /** Left edge, in the element's local units. */
  x: number;
  /** The span's middle line (Konva draws text with textBaseline "middle"). */
  y: number;
  /** The text as drawn (caps applied). */
  text: string;
  /** Font size drawn (small caps make it smaller than the style's). */
  size: number;
  width: number;
  font: string;
  style: ResolvedStyle;
};

export type RichLine = { x: number; y: number; width: number; height: number; spans: Span[] };
export type RichLayout = { lines: RichLine[]; height: number };

/** Where the alphabetic baseline sits below the middle line, as a fraction of the size (see shared.ts). */
const BASELINE_BELOW_MIDDLE = 0.36;
/** Photoshop's default small-caps size. */
export const SMALL_CAPS = 0.7;

const RUN_KEYS = [
  "fontFamily",
  "fontSize",
  "bold",
  "italic",
  "underline",
  "strike",
  "fill",
  "letterSpacing",
  "baselineShift",
  "caps",
  "scaleX",
  "scaleY",
] as const satisfies readonly (keyof RunStyle)[];

/** The value a run field has when the run doesn't set it. */
function elementValue(el: TextElement, k: (typeof RUN_KEYS)[number]): unknown {
  switch (k) {
    case "strike":
      return false;
    case "baselineShift":
      return 0;
    case "caps":
      return undefined;
    case "scaleX":
    case "scaleY":
      return 1;
    default:
      return el[k];
  }
}

const PARA_DEFAULTS: Required<ParaStyle> = { align: "left", indent: 0, startIndent: 0, endIndent: 0, spaceBefore: 0, spaceAfter: 0 };

const styleKeys = (r: object) => Object.keys(r).filter((k) => k !== "length" && (r as Record<string, unknown>)[k] !== undefined);

function sameStyle(a: object, b: object) {
  const ka = styleKeys(a);
  const kb = styleKeys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

/** Merge equal neighbours and drop empty runs; one run with no overrides is no runs at all. */
function tidyRuns<T extends Run>(runs: T[]): T[] | undefined {
  const out: T[] = [];
  for (const r of runs) {
    if (!(r.length > 0)) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) out[out.length - 1] = { ...last, length: last.length + r.length };
    else out.push({ ...r });
  }
  if (!out.length || (out.length === 1 && !styleKeys(out[0]).length)) return undefined;
  return out;
}

/** Runs trimmed or extended (the last one) to cover exactly `len` characters. */
function fitRuns<T extends Run>(runs: T[], len: number): T[] {
  const out: T[] = [];
  let left = len;
  for (const r of runs) {
    if (left <= 0) break;
    const n = Math.min(Math.max(0, Math.floor(r.length) || 0), left);
    if (n > 0) out.push({ ...r, length: n });
    left -= n;
  }
  if (left > 0) {
    if (out.length) out[out.length - 1] = { ...out[out.length - 1], length: out[out.length - 1].length + left };
    else if (runs.length) out.push({ ...runs[runs.length - 1], length: left });
  }
  return out;
}

/**
 * Runs for `newText` after an edit of `oldText`: the common prefix and suffix keep their runs,
 * deleted characters shrink theirs, and inserted ones take the style of the character before
 * them (the first run's at the very start).
 */
export function remapRuns<T extends Run>(oldText: string, newText: string, runs: T[] | undefined): T[] | undefined {
  if (!runs?.length || !newText.length) return undefined;
  const fitted = fitRuns(runs, oldText.length);
  if (!fitted.length) return undefined;
  const max = Math.min(oldText.length, newText.length);
  let p = 0;
  while (p < max && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && oldText.charCodeAt(oldText.length - 1 - s) === newText.charCodeAt(newText.length - 1 - s)) s++;
  const delEnd = oldText.length - s;
  const inserted = newText.length - p - s;
  // The run that takes the inserted characters.
  const at = p > 0 ? p - 1 : 0;
  let start = 0;
  let host = -1;
  for (let i = 0; i < fitted.length; i++) {
    if (at >= start && at < start + fitted[i].length) host = i;
    start += fitted[i].length;
  }
  if (host < 0) host = fitted.length - 1;
  const out: T[] = [];
  start = 0;
  for (let i = 0; i < fitted.length; i++) {
    const a = start;
    const b = start + fitted[i].length;
    start = b;
    // Kept: overlap with [0, p) and with [delEnd, old length).
    let n = Math.max(0, Math.min(b, p) - a) + Math.max(0, b - Math.max(a, delEnd));
    if (i === host) n += inserted;
    out.push({ ...fitted[i], length: n });
  }
  return tidyRuns(out);
}

/** Runs without the fields that equal the element's own values. */
function cleanRuns(el: TextElement, runs: TextRun[] | undefined) {
  if (!runs) return undefined;
  return tidyRuns(
    runs.map((r) => {
      const out: TextRun = { length: r.length };
      for (const k of RUN_KEYS) {
        const v = r[k];
        if (v !== undefined && v !== elementValue(el, k)) (out as Record<string, unknown>)[k] = v;
      }
      return out;
    }),
  );
}

function cleanParagraphs(el: TextElement, runs: ParagraphRun[] | undefined) {
  if (!runs) return undefined;
  return tidyRuns(
    runs.map((r) => {
      const out: ParagraphRun = { length: r.length };
      for (const k of Object.keys(PARA_DEFAULTS) as (keyof ParaStyle)[]) {
        const v = r[k];
        const own = k === "align" ? el.align : PARA_DEFAULTS[k];
        if (v !== undefined && v !== own) (out as Record<string, unknown>)[k] = v;
      }
      return out;
    }),
  );
}

/** The runs of a text element after its text becomes `newText`. */
export function remapTextRuns(el: TextElement, newText: string): Pick<TextElement, "runs" | "paragraphs"> {
  return {
    runs: cleanRuns(el, remapRuns(el.text, newText, el.runs)),
    paragraphs: cleanParagraphs(el, remapRuns(el.text, newText, el.paragraphs)),
  };
}

/** The element's runs fitted to its text, without fields equal to its own style, merged and tidied. */
export function normalizeRuns(el: TextElement): Pick<TextElement, "runs" | "paragraphs"> {
  const n = el.text.length;
  return {
    runs: n && el.runs?.length ? cleanRuns(el, fitRuns(el.runs, n)) : undefined,
    paragraphs: n && el.paragraphs?.length ? cleanParagraphs(el, fitRuns(el.paragraphs, n)) : undefined,
  };
}

/** Whether the element draws with more than one style (so it needs the rich layout). */
export function hasRichStyle(el: TextElement) {
  return !!(el.runs?.some((r) => styleKeys(r).length) || el.paragraphs?.some((r) => styleKeys(r).length));
}

/**
 * A toolbar edit for the whole box: the element takes the new values and every run forgets its
 * own, so the box ends up with that one value everywhere.
 */
export function applyToWholeBox(el: TextElement, patch: Partial<TextElement>): Partial<TextElement> {
  const out: Partial<TextElement> = { ...patch };
  const next = { ...el, ...patch } as TextElement;
  const runKeys = Object.keys(patch).filter((k) => (RUN_KEYS as readonly string[]).includes(k));
  if (el.runs && runKeys.length) {
    out.runs = cleanRuns(
      next,
      el.runs.map((r) => {
        const c = { ...r } as Record<string, unknown>;
        for (const k of runKeys) delete c[k];
        return c as TextRun;
      }),
    );
  }
  if (el.paragraphs && "align" in patch) {
    out.paragraphs = cleanParagraphs(
      next,
      el.paragraphs.map(({ align: _a, ...r }) => (void _a, r)),
    );
  }
  return out;
}

/** Every size in the box (element and runs) moved by `delta`, never under 1. */
export function bumpFontSize(el: TextElement, delta: number): Partial<TextElement> {
  const fontSize = Math.max(1, el.fontSize + delta);
  if (!el.runs) return { fontSize };
  const runs = el.runs.map((r) => (r.fontSize === undefined ? r : { ...r, fontSize: Math.max(1, r.fontSize + delta) }));
  return { fontSize, runs: cleanRuns({ ...el, fontSize }, runs) };
}

/** Sizes, letter spacing and baseline shifts scaled by `k` (a corner resize). */
export function scaleTextStyle(el: TextElement, k: number): Partial<TextElement> {
  const out: Partial<TextElement> = { fontSize: Math.max(1, el.fontSize * k), letterSpacing: el.letterSpacing * k };
  if (el.runs) {
    out.runs = el.runs.map((r) => {
      const c: TextRun = { ...r };
      if (c.fontSize !== undefined) c.fontSize = Math.max(1, c.fontSize * k);
      if (c.letterSpacing !== undefined) c.letterSpacing *= k;
      if (c.baselineShift !== undefined) c.baselineShift *= k;
      return c;
    });
  }
  if (el.paragraphs?.some((p) => p.indent || p.startIndent || p.endIndent || p.spaceBefore || p.spaceAfter)) {
    out.paragraphs = el.paragraphs.map((p) => {
      const c: ParagraphRun = { ...p };
      for (const key of ["indent", "startIndent", "endIndent", "spaceBefore", "spaceAfter"] as const) if (c[key] !== undefined) c[key] = c[key]! * k;
      return c;
    });
  }
  return out;
}

/** Families the element draws with, its own first. */
export function textFamilies(el: TextElement) {
  const out = [el.fontFamily];
  for (const r of el.runs ?? []) if (r.fontFamily && !out.includes(r.fontFamily)) out.push(r.fontFamily);
  return out;
}

/** The largest font size anywhere in the box. */
export function maxFontSize(el: TextElement) {
  let m = el.fontSize;
  for (const r of el.runs ?? []) if (r.fontSize !== undefined && r.fontSize > m) m = r.fontSize;
  return m;
}

/** A field the runs disagree on (or disagree with the element on): the toolbar shows "Mixed". */
export function mixedField(el: TextElement, k: (typeof RUN_KEYS)[number]) {
  return !!el.runs?.some((r) => r[k] !== undefined && r[k] !== elementValue(el, k));
}

function resolve(el: TextElement, r: TextRun | undefined): ResolvedStyle {
  return {
    fontFamily: r?.fontFamily ?? el.fontFamily,
    fontSize: r?.fontSize ?? el.fontSize,
    bold: r?.bold ?? el.bold,
    italic: r?.italic ?? el.italic,
    underline: r?.underline ?? el.underline,
    strike: r?.strike ?? false,
    fill: r?.fill ?? el.fill,
    letterSpacing: r?.letterSpacing ?? el.letterSpacing,
    baselineShift: r?.baselineShift ?? 0,
    caps: r?.caps ?? "none",
    scaleX: r?.scaleX ?? 1,
    scaleY: r?.scaleY ?? 1,
  };
}

/** The element's character runs with every field resolved (one run for the whole text when it has none). */
export function resolvedRuns(el: TextElement): { length: number; style: ResolvedStyle }[] {
  const n = el.text.length;
  if (!n) return [];
  const runs = el.runs?.length ? fitRuns(el.runs, n) : [{ length: n }];
  return runs.map((r) => ({ length: r.length, style: resolve(el, r) }));
}

/** The element's paragraph runs with every field resolved. */
export function resolvedParagraphs(el: TextElement): (Required<ParaStyle> & { length: number })[] {
  const n = el.text.length;
  if (!n) return [];
  const runs = el.paragraphs?.length ? fitRuns(el.paragraphs, n) : [{ length: n }];
  return runs.map((r) => ({ ...PARA_DEFAULTS, align: el.align, ...definedOnly(r), length: r.length }));
}

export const fontCss = (s: ResolvedStyle, size = s.fontSize) =>
  `${s.italic ? "italic " : ""}${s.bold ? "bold " : ""}${size}px "${s.fontFamily}"`;

/** Index of the run covering each character, and the runs' resolved styles. */
function styleMap(el: TextElement) {
  const n = el.text.length;
  const runs = el.runs?.length ? fitRuns(el.runs, n) : [];
  const styles = runs.length ? runs.map((r) => resolve(el, r)) : [resolve(el, undefined)];
  const at = new Uint16Array(n);
  let i = 0;
  runs.forEach((r, k) => {
    at.fill(k, i, i + r.length);
    i += r.length;
  });
  return { styles, at };
}

/** The paragraph run covering character `i`, resolved. */
function paragraphAt(el: TextElement, runs: ParagraphRun[], i: number): Required<ParaStyle> {
  let start = 0;
  for (const r of runs) {
    if (i < start + r.length) return { ...PARA_DEFAULTS, align: el.align, ...definedOnly(r) };
    start += r.length;
  }
  const last = runs[runs.length - 1];
  return { ...PARA_DEFAULTS, align: el.align, ...(last ? definedOnly(last) : {}) };
}

function definedOnly(r: ParagraphRun): ParaStyle {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(PARA_DEFAULTS)) if ((r as Record<string, unknown>)[k] !== undefined) out[k] = (r as Record<string, unknown>)[k];
  return out as ParaStyle;
}

/** A piece of a paragraph in one style: its drawn text, size and width. */
type Piece = { text: string; size: number; width: number; style: ResolvedStyle; font: string };

/** The drawn pieces of characters [a, b) in one style (small caps split lower and upper case). */
function pieces(src: string, style: ResolvedStyle, measure: Measure): Piece[] {
  const make = (text: string, size: number): Piece => {
    const font = fontCss(style, size);
    const width = (measure(text, font) + style.letterSpacing * text.length) * style.scaleX;
    return { text, size, width, style, font };
  };
  if (style.caps === "all") return [make(src.toUpperCase(), style.fontSize)];
  if (style.caps !== "small") return [make(src, style.fontSize)];
  const out: Piece[] = [];
  let cur = "";
  let lower = false;
  for (const ch of src) {
    const isLower = ch !== ch.toUpperCase();
    if (cur && isLower !== lower) {
      out.push(make(lower ? cur.toUpperCase() : cur, lower ? style.fontSize * SMALL_CAPS : style.fontSize));
      cur = "";
    }
    lower = isLower;
    cur += ch;
  }
  if (cur) out.push(make(lower ? cur.toUpperCase() : cur, lower ? style.fontSize * SMALL_CAPS : style.fontSize));
  return out;
}

type Unit = { a: number; b: number };

/** Break opportunities: after each space or dash (Konva.Text's rule). */
function words(text: string, a: number, b: number): Unit[] {
  const out: Unit[] = [];
  let s = a;
  for (let i = a; i < b; i++) {
    const c = text[i];
    const next = text[i + 1];
    if ((c === " " || c === "-") && !(c === " " && next === " " && i + 1 < b)) {
      out.push({ a: s, b: i + 1 });
      s = i + 1;
    }
  }
  if (s < b) out.push({ a: s, b });
  return out;
}

/**
 * Lay out the element's text with its runs: paragraphs split at line breaks, word wrap at the box
 * width less the paragraph's indents, each line as tall as lineHeight x its largest size.
 */
export function layoutRichText(el: TextElement, measure: Measure): RichLayout {
  const text = el.text;
  const { styles, at } = styleMap(el);
  const paras = el.paragraphs?.length ? fitRuns(el.paragraphs, text.length) : [];
  const styleOf = (i: number) => styles[text.length ? at[Math.min(Math.max(i, 0), text.length - 1)] : 0];

  // Width of characters [a, b) and its pieces, split at style changes.
  const cache = new Map<string, Piece[]>();
  const piecesOf = (a: number, b: number) => {
    const key = `${a}:${b}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = [];
      for (let i = a; i < b; ) {
        let j = i + 1;
        while (j < b && at[j] === at[i]) j++;
        hit.push(...pieces(text.slice(i, j), styleOf(i), measure));
        i = j;
      }
      cache.set(key, hit);
    }
    return hit;
  };
  const widthOf = (a: number, b: number) => piecesOf(a, b).reduce((w, p) => w + p.width, 0);
  const trimEnd = (a: number, b: number) => {
    while (b > a && text[b - 1] === " ") b--;
    return b;
  };

  const lines: RichLine[] = [];
  let y = 0;
  let start = 0;
  const breaks = text.split("\n");
  breaks.forEach((para, pi) => {
    const a = start;
    const b = start + para.length;
    start = b + 1;
    const ps = paragraphAt(el, paras, a);
    if (pi > 0) y += ps.spaceBefore;
    // Lines of this paragraph as character ranges.
    const ranges: Unit[] = [];
    const avail = (first: boolean) => el.width - ps.startIndent - ps.endIndent - (first ? ps.indent : 0);
    let lineA = a;
    let lineB = a;
    for (const w of words(text, a, b)) {
      const max = avail(ranges.length === 0);
      if (lineB > lineA && widthOf(lineA, trimEnd(lineA, w.b)) > max) {
        ranges.push({ a: lineA, b: trimEnd(lineA, lineB) });
        lineA = w.a;
        // Konva trims the start of a wrapped line.
        while (lineA < w.b && text[lineA] === " ") lineA++;
      }
      lineB = w.b;
      // A word too long for a line of its own breaks by characters.
      while (lineB > lineA && widthOf(lineA, trimEnd(lineA, lineB)) > avail(ranges.length === 0)) {
        let cut = lineA + (Array.from(text.slice(lineA, lineA + 2))[0]?.length ?? 1);
        for (const ch of Array.from(text.slice(cut, lineB))) {
          if (widthOf(lineA, cut + ch.length) > avail(ranges.length === 0)) break;
          cut += ch.length;
        }
        if (cut >= lineB) break;
        ranges.push({ a: lineA, b: cut });
        lineA = cut;
      }
    }
    ranges.push({ a: lineA, b: lineB });

    ranges.forEach((r, li) => {
      const ps2 = pieceSpans(r);
      // An empty line takes the size of the character at its place (the line break).
      const maxSize = ps2.length ? Math.max(...ps2.map((p) => p.style.fontSize)) : styleOf(r.a).fontSize;
      const height = el.lineHeight * maxSize;
      const width = ps2.reduce((w, p) => w + p.width, 0);
      const room = avail(li === 0);
      const free = room - width;
      const x = ps.startIndent + (li === 0 ? ps.indent : 0) + (ps.align === "right" ? free : ps.align === "center" ? free / 2 : 0);
      let cx = x;
      const mid = y + height / 2;
      const spans: Span[] = ps2.map((p) => {
        const s: Span = {
          x: cx,
          y: mid + BASELINE_BELOW_MIDDLE * (maxSize - p.size) - p.style.baselineShift,
          text: p.text,
          size: p.size,
          width: p.width,
          font: p.font,
          style: p.style,
        };
        cx += p.width;
        return s;
      });
      lines.push({ x, y, width, height, spans });
      y += height;
    });
    y += ps.spaceAfter;
    // No space after the last paragraph.
    if (pi === breaks.length - 1) y -= ps.spaceAfter;
  });
  return { lines, height: y };

  function pieceSpans(r: Unit) {
    return r.b > r.a ? piecesOf(r.a, r.b) : [];
  }
}

type Ctx = Pick<
  CanvasRenderingContext2D,
  "save" | "restore" | "translate" | "scale" | "fillText" | "measureText" | "beginPath" | "moveTo" | "lineTo" | "stroke"
> & { font: string; fillStyle: unknown; strokeStyle: unknown; lineWidth: number; textBaseline: CanvasTextBaseline; textAlign: CanvasTextAlign };

/** Draw a layout the way Konva.Text draws a line: middle baseline, decorations at Konva's offsets. */
export function drawRichText(ctx: Ctx, layout: RichLayout) {
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (const line of layout.lines) {
    for (const s of line.spans) {
      const st = s.style;
      ctx.save();
      ctx.translate(s.x, s.y);
      if (st.scaleX !== 1 || st.scaleY !== 1) ctx.scale(st.scaleX, st.scaleY);
      ctx.font = s.font;
      ctx.fillStyle = st.fill;
      const w = s.width / st.scaleX;
      if (st.letterSpacing) {
        let x = 0;
        for (const ch of Array.from(s.text)) {
          ctx.fillText(ch, x, 0);
          x += ctx.measureText(ch).width + st.letterSpacing;
        }
      } else {
        ctx.fillText(s.text, 0, 0);
      }
      ctx.strokeStyle = st.fill;
      ctx.lineWidth = s.size / 15;
      if (st.underline) {
        ctx.beginPath();
        ctx.moveTo(0, Math.round(s.size / 2));
        ctx.lineTo(Math.round(w), Math.round(s.size / 2));
        ctx.stroke();
      }
      if (st.strike) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.round(w), 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

/** A Measure backed by a 2D context (its font is restored afterwards). */
export function contextMeasure(ctx: Pick<CanvasRenderingContext2D, "measureText"> & { font: string }): Measure {
  return (text, font) => {
    const prev = ctx.font;
    ctx.font = font;
    const w = ctx.measureText(text).width;
    ctx.font = prev;
    return w;
  };
}
