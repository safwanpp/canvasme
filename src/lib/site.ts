import { FONTS } from "./fonts";

/**
 * Facts about canvas.me shared by the marketing pages, their JSON-LD, the sitemap and llms.txt,
 * so every place that describes the product says the same thing. Keep it true to the code.
 */
export const SITE = {
  name: "canvas.me",
  url: "https://canvasme.setitup.in",
  tagline: "Free online design editor in your browser",
  description:
    "canvas.me is a free online design editor that runs in your browser. Make social posts, posters and slides with no sign-up. Your designs are saved on your own device, not on a server.",
  maker: { name: "SETITUP", url: "https://setitup.in" },
  source: "https://github.com/safwanpp/canvasme",
  /** Date the marketing copy was last reviewed; used for sitemap lastModified and article dates. */
  updated: "2026-10-25",
} as const;

export const LATIN_FONT_COUNT = FONTS.filter((f) => !f.script).length;
export const MALAYALAM_FONT_COUNT = FONTS.filter((f) => f.script === "malayalam").length;

/** Plain, quotable statements: what it is, who it's for, what it costs, where the data lives. */
export const FACTS: [string, string][] = [
  ["What it is", "A design editor for social posts, posters, slides and documents that runs in a web browser."],
  ["Who it's for", "Anyone who needs a poster, post or slide without making an account, including people designing in Malayalam."],
  ["What it costs", "Nothing. There is no paid plan, no trial and no watermark on exports."],
  ["Where designs live", "In the browser's IndexedDB storage on your device. Designs and images are never uploaded."],
  ["Works on", "A modern web browser on Windows, macOS, ChromeOS, Android, iPhone or iPad. It can be installed as an app and works offline after the first visit."],
  ["Made by", "SETITUP (setitup.in)."],
];

export type Faq = { q: string; a: string };

/** The landing page FAQ. The FAQPage JSON-LD is built from this list, so it always matches the page. */
export const FAQ: Faq[] = [
  {
    q: "What is canvas.me?",
    a: "canvas.me is a free design editor that runs in your web browser. You can make social media posts, posters, presentations and A4 documents with text, shapes, lines, drawings and your own images, then export them as PNG, JPG or PDF. It works like other drag-and-drop online design editors, without an account.",
  },
  {
    q: "Is canvas.me really free?",
    a: "Yes. There is no paid plan, no trial and no watermark on exports.",
  },
  {
    q: "Do I need an account?",
    a: "No. Open the editor and start designing. There is nothing to sign up for.",
  },
  {
    q: "Where are my designs saved?",
    a: "In your browser's own storage (IndexedDB) on this device. Nothing is uploaded to a server, so nobody else can see your work.",
  },
  {
    q: "What happens if I clear my browser data?",
    a: "Your designs are deleted with it. Download a .canvasme work file for anything you want to keep, and open it again whenever you like.",
  },
  {
    q: "Can I move a design to another computer or my phone?",
    a: "Yes. Download the work file, send it to the other device, and open it in canvas.me there. Images, pages and uploaded fonts come with it.",
  },
  {
    q: "Can I make Malayalam posters?",
    a: `Yes. The font picker has ${MALAYALAM_FONT_COUNT} free Malayalam fonts, including Noto Sans Malayalam, Manjari, Chilanka, Rachana, Meera, the Nupuram family and the RIT fonts. You can also upload your own TTF, OTF, WOFF or WOFF2 font.`,
  },
  {
    q: "How does the background remover work?",
    a: "Select an image and choose BG Remover. An AI model runs on your device, so the image never leaves your browser. The first use downloads the model once (about 44 to 90 MB, depending on your device) and keeps it for next time.",
  },
  {
    q: "Which file types can I export?",
    a: "PNG and JPG at twice the design size, a zip of every page as images, a multi-page PDF, or a Photoshop .psd of the current page with one layer per element (text is rasterized). You can also download a .canvasme work file to keep editing later.",
  },
  {
    q: "Can I open Photoshop (.psd) or Illustrator (.ai) files?",
    a: "Yes, in the browser, with nothing uploaded. A PSD opens with its pixel layers, groups, opacity and hidden layers, and its straight text layers become editable text. Adjustment layers, layer effects and blend modes aren't imported. An .ai file or a PDF opens with each artboard or page as a high-resolution image, optionally with its straight lines of text as editable text boxes; vector shapes don't become editable. The .ai file needs Illustrator's “Create PDF Compatible File” option, which is on by default. canvas.me doesn't save .ai files: download a PDF, which opens in Illustrator.",
  },
  {
    q: "Can I install it like an app?",
    a: "Yes. Use Install app (or Add to Home Screen on iPhone) and canvas.me opens in its own window. After the first visit it works offline too.",
  },
];

export type Guide = { href: string; title: string; blurb: string };

/** Content pages linked from the landing page, the footer and the sitemap. */
export const GUIDES: Guide[] = [
  {
    href: "/features",
    title: "Every feature, in one list",
    blurb: "Text, shapes, image tools, pages, export, work files and keyboard shortcuts.",
  },
  {
    href: "/malayalam-poster-maker",
    title: "Make a Malayalam poster",
    blurb: `Type in Malayalam, pick from ${MALAYALAM_FONT_COUNT} free fonts or upload your own, and export for WhatsApp or print.`,
  },
  {
    href: "/remove-background",
    title: "Remove an image background",
    blurb: "Cut out a photo with AI that runs on your device. Free, no upload, no account.",
  },
];

/** Escape a JSON-LD object for an inline <script>, so text can't close the tag. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

export const ORG_ID = `${SITE.url}/#organization`;
export const WEBSITE_ID = `${SITE.url}/#website`;
export const APP_ID = `${SITE.url}/#app`;

export function breadcrumbs(items: [string, string][]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: `${SITE.url}${path}`,
    })),
  };
}

/**
 * Metadata for one marketing page. Next replaces (doesn't merge) a parent's openGraph and twitter
 * objects, so each page repeats the shared fields here.
 */
const OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "canvas.me: a free design editor that runs in your browser",
};

export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }) {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    // A page-level openGraph object drops the inherited opengraph-image, so name it again.
    openGraph: { type: "website" as const, siteName: SITE.name, locale: "en", url: path, title, description, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image" as const, title, description, images: [OG_IMAGE] },
  };
}
