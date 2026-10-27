import { describe, expect, it } from "vitest";
import { Design, TextElement } from "@/lib/model";
import {
  applyToWholeBox,
  bumpFontSize,
  hasRichStyle,
  layoutRichText,
  maxFontSize,
  remapRuns,
  remapTextRuns,
  scaleTextStyle,
  textFamilies,
  type Measure,
} from "@/lib/richText";
import { makeDesign, textEl } from "../fixtures/design";

/** Every character is half the font size wide (the size is the number before "px"). */
const measure: Measure = (text, font) => text.length * 0.5 * Number(/([\d.]+)px/.exec(font)![1]);

describe("remapRuns", () => {
  const runs = [{ length: 5, bold: true }, { length: 6 }];

  it("insert inside run extends it", () => {
    expect(remapRuns("Hello world", "HelXXlo world", runs)).toEqual([{ length: 7, bold: true }, { length: 6 }]);
  });

  it("insert at a run boundary takes the style of the character before it", () => {
    expect(remapRuns("Hello world", "HelloX world", runs)).toEqual([{ length: 6, bold: true }, { length: 6 }]);
  });

  it("insert at the very start takes the first run's style", () => {
    expect(remapRuns("Hello world", "XHello world", runs)).toEqual([{ length: 6, bold: true }, { length: 6 }]);
  });

  it("delete across runs shrinks both", () => {
    expect(remapRuns("Hello world", "Helrld", runs)).toEqual([{ length: 3, bold: true }, { length: 3 }]);
  });

  it("deleting a whole run removes it and merges equal neighbours", () => {
    const three = [{ length: 2 }, { length: 2, italic: true }, { length: 2 }];
    expect(remapRuns("aabbcc", "aacc", three)).toBeUndefined();
  });

  it("replace all collapses to defaults", () => {
    expect(remapRuns("Hello world", "Bye", runs)).toEqual([{ length: 3, bold: true }]);
    expect(remapRuns("Hello world", "Bye", [{ length: 5 }, { length: 6, bold: true }])).toBeUndefined();
  });

  it("empty text has no runs", () => {
    expect(remapRuns("Hello world", "", runs)).toBeUndefined();
  });

  it("runs that don't add up to the old text are fitted first", () => {
    expect(remapRuns("Hello world", "Hello world!", [{ length: 5, bold: true }, { length: 2 }])).toEqual([
      { length: 5, bold: true },
      { length: 7 },
    ]);
  });

  it("no runs stay no runs", () => {
    expect(remapRuns("a", "ab", undefined)).toBeUndefined();
  });
});

describe("remapTextRuns", () => {
  it("remaps character and paragraph runs together", () => {
    const el = textEl({
      text: "Title\nBody",
      runs: [{ length: 6, fontSize: 40 }, { length: 4 }],
      paragraphs: [{ length: 6, align: "center" }, { length: 4 }],
    });
    expect(remapTextRuns(el, "Title\nBody text")).toEqual({
      runs: [{ length: 6, fontSize: 40 }, { length: 9 }],
      paragraphs: [{ length: 6, align: "center" }, { length: 9 }],
    });
  });

  it("drops run fields equal to the element's own", () => {
    const el = textEl({ text: "ab", fontSize: 24, runs: [{ length: 1, fontSize: 24 }, { length: 1, fontSize: 30 }] });
    expect(remapTextRuns(el, "abc")).toEqual({ runs: [{ length: 1 }, { length: 2, fontSize: 30 }], paragraphs: undefined });
  });
});

describe("whole-box edits", () => {
  const el = textEl({
    text: "Hello world",
    fontSize: 20,
    fill: "#000000",
    runs: [{ length: 5, fontSize: 40, fill: "#ff0000" }, { length: 6 }],
    paragraphs: [{ length: 11, align: "center" }],
  });

  it("a colour change applies to the whole box and leaves sizes alone", () => {
    expect(applyToWholeBox(el, { fill: "#00ff00" })).toEqual({
      fill: "#00ff00",
      runs: [{ length: 5, fontSize: 40 }, { length: 6 }],
    });
  });

  it("alignment removes paragraph overrides", () => {
    expect(applyToWholeBox(el, { align: "right" })).toEqual({ align: "right", paragraphs: undefined });
  });

  it("an exact font size makes every run that size", () => {
    expect(applyToWholeBox(el, { fontSize: 30 })).toEqual({ fontSize: 30, runs: [{ length: 5, fill: "#ff0000" }, { length: 6 }] });
  });

  it("bumping the size moves every run by the same step", () => {
    expect(bumpFontSize(el, 2)).toEqual({ fontSize: 22, runs: [{ length: 5, fontSize: 42, fill: "#ff0000" }, { length: 6 }] });
  });

  it("scaling (corner resize) scales run sizes, spacing and shifts", () => {
    const r = textEl({ fontSize: 10, letterSpacing: 1, text: "ab", runs: [{ length: 1, fontSize: 20, baselineShift: 4, letterSpacing: 2 }, { length: 1 }] });
    expect(scaleTextStyle(r, 2)).toEqual({
      fontSize: 20,
      letterSpacing: 2,
      runs: [{ length: 1, fontSize: 40, baselineShift: 8, letterSpacing: 4 }, { length: 1 }],
    });
  });
});

describe("rich text helpers", () => {
  it("knows when an element has more than one style", () => {
    expect(hasRichStyle(textEl())).toBe(false);
    expect(hasRichStyle(textEl({ runs: [{ length: 4 }] }))).toBe(false);
    expect(hasRichStyle(textEl({ runs: [{ length: 4, bold: true }] }))).toBe(true);
    expect(hasRichStyle(textEl({ paragraphs: [{ length: 4, spaceAfter: 3 }] }))).toBe(true);
  });

  it("lists every family a text element uses", () => {
    const el = textEl({ fontFamily: "Inter", text: "abc", runs: [{ length: 1, fontFamily: "Lora" }, { length: 2, fontFamily: "Inter" }] });
    expect(textFamilies(el)).toEqual(["Inter", "Lora"]);
    expect(maxFontSize(textEl({ fontSize: 10, text: "ab", runs: [{ length: 1, fontSize: 30 }, { length: 1 }] }))).toBe(30);
  });

  it("schema keeps runs and paragraphs through a parse", () => {
    const el = textEl({
      text: "ab",
      runs: [{ length: 1, strike: true, caps: "small", scaleX: 1.2, baselineShift: 2 }, { length: 1 }],
      paragraphs: [{ length: 2, align: "right", indent: 4, startIndent: 2, endIndent: 1, spaceBefore: 3, spaceAfter: 5 }],
    });
    const parsed = Design.parse(makeDesign([el])).pages[0].elements[0];
    expect(parsed).toMatchObject({ runs: el.runs, paragraphs: el.paragraphs });
    // Old text elements have neither and still parse.
    const old = TextElement.parse({ ...textEl(), runs: undefined, paragraphs: undefined });
    expect(old.runs).toBeUndefined();
  });
});

describe("layoutRichText", () => {
  it("single-style text matches the plain layout height", () => {
    const el = textEl({ text: "one\ntwo", fontSize: 20, lineHeight: 1.5, width: 500 });
    const l = layoutRichText(el, measure);
    expect(l.lines).toHaveLength(2);
    expect(l.height).toBeCloseTo(60, 6);
  });

  it("a line is as tall as its largest run", () => {
    const el = textEl({ text: "Big small", fontSize: 10, lineHeight: 1.2, width: 500, runs: [{ length: 3, fontSize: 30 }, { length: 6 }] });
    const l = layoutRichText(el, measure);
    expect(l.height).toBeCloseTo(36, 6);
    const spans = l.lines[0].spans;
    expect(spans.map((s) => s.text)).toEqual(["Big", " small"]);
    // Widths add up across sizes: "Big" at 30 px is 45 wide.
    expect(spans[1].x).toBeCloseTo(45, 6);
    expect(l.lines[0].width).toBeCloseTo(45 + 6 * 5, 6);
  });

  it("wraps across a run boundary", () => {
    // "aaaa " and "bbbb": 4 chars at 10 px = 20 each; width 30 fits one word per line.
    const el = textEl({ text: "aaaa bbbb", fontSize: 10, width: 30, runs: [{ length: 6, bold: true }, { length: 3 }] });
    const l = layoutRichText(el, measure);
    expect(l.lines.map((ln) => ln.spans.map((s) => s.text).join(""))).toEqual(["aaaa", "bbbb"]);
    expect(l.lines[1].spans.map((s) => s.style.bold)).toEqual([true, false]);
  });

  it("breaks a word longer than the box by characters", () => {
    const el = textEl({ text: "abcdefgh", fontSize: 10, width: 20, runs: [{ length: 2, italic: true }, { length: 6 }] });
    expect(layoutRichText(el, measure).lines.map((ln) => ln.spans.map((s) => s.text).join(""))).toEqual(["abcd", "efgh"]);
  });

  it("aligns each paragraph on its own and indents", () => {
    const el = textEl({
      text: "ab\ncd\nef",
      fontSize: 10,
      width: 100,
      align: "left",
      paragraphs: [{ length: 3, align: "right" }, { length: 3, align: "center", spaceBefore: 4, spaceAfter: 6 }, { length: 2, indent: 7, startIndent: 3 }],
    });
    const l = layoutRichText(el, measure);
    expect(l.lines[0].x).toBeCloseTo(90, 6);
    expect(l.lines[1].x).toBeCloseTo(45, 6);
    expect(l.lines[2].x).toBeCloseTo(10, 6);
    expect(l.lines[1].y).toBeCloseTo(12 + 4, 6);
    expect(l.lines[2].y).toBeCloseTo(12 + 4 + 12 + 6, 6);
    expect(l.height).toBeCloseTo(12 * 3 + 10, 6);
  });

  it("all caps and small caps change the drawn text", () => {
    const el = textEl({ text: "ab cd", fontSize: 10, width: 500, runs: [{ length: 3, caps: "all" }, { length: 2, caps: "small" }] });
    const spans = layoutRichText(el, measure).lines[0].spans;
    expect(spans.map((s) => s.text)).toEqual(["AB ", "CD"]);
    expect(spans[1].size).toBeCloseTo(7, 6);
  });

  it("horizontal scale widens a run", () => {
    const el = textEl({ text: "ab", fontSize: 10, width: 500, runs: [{ length: 1, scaleX: 2 }, { length: 1 }] });
    const spans = layoutRichText(el, measure).lines[0].spans;
    expect(spans[1].x).toBeCloseTo(10, 6);
  });

  it("letter spacing and baseline shift are per run", () => {
    const el = textEl({ text: "ab", fontSize: 10, width: 500, runs: [{ length: 1, letterSpacing: 3, baselineShift: 2 }, { length: 1 }] });
    const [a, b] = layoutRichText(el, measure).lines[0].spans;
    expect(b.x).toBeCloseTo(5 + 3, 6);
    expect(a.y).toBeCloseTo(b.y - 2, 6);
  });

  it("an empty line keeps its run's height", () => {
    const el = textEl({ text: "a\n\nb", fontSize: 10, width: 500, runs: [{ length: 2 }, { length: 1, fontSize: 30 }, { length: 1 }] });
    const l = layoutRichText(el, measure);
    expect(l.lines.map((ln) => ln.height)).toEqual([12, 36, 12]);
  });
});
