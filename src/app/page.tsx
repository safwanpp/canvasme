import { ArrowRight, Check, FileArchive, FileText, Folder, ImageIcon } from "lucide-react";
import type { Metadata } from "next";
import { Bebas_Neue, Manjari, Playfair_Display } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { InstallButton } from "@/components/Pwa";
import { LayerSort } from "@/components/landing/LayerSort";
import { RevealGroup } from "@/components/landing/RevealGroup";
import {
  Bezel,
  card,
  ClosingCta,
  JsonLd,
  PrimaryButton,
  SectionTitle,
  SiteShell,
  spring,
} from "@/components/landing/Site";
import {
  APP_ID,
  FACTS,
  FAQ,
  GUIDES,
  LATIN_FONT_COUNT,
  MALAYALAM_FONT_COUNT,
  ORG_ID,
  pageMetadata,
  SITE,
  WEBSITE_ID,
} from "@/lib/site";

const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400" });
const playfair = Playfair_Display({ subsets: ["latin"], style: "italic", weight: "600" });
// Only the Malayalam glyphs of the specimen tile use it, so don't preload it for every visitor.
const manjari = Manjari({ subsets: ["malayalam"], weight: "700", preload: false });

const TITLE = "canvas.me: Free online design editor, no sign-up";
const DESCRIPTION =
  "Free online design editor that runs in your browser. Make posts, posters and slides with no sign-up, Malayalam fonts and an on-device background remover.";

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/" });

const FLOW = [
  { step: "Make", body: "Pick a size, then add text, shapes, drawings and your own images." },
  { step: "It saves itself", body: "Changes are kept in this browser automatically." },
  { step: "Export", body: "Download PNG or JPG for posting, or a PDF for print." },
  { step: "Back up", body: "Download a .canvasme work file with everything inside it." },
  { step: "Reopen anywhere", body: "Open the work file on any computer and keep editing." },
];

const PRESETS = [
  { label: "Instagram post", size: "1080x1080", w: 1, h: 1 },
  { label: "Story", size: "1080x1920", w: 9, h: 16 },
  { label: "Poster", size: "1587x2245", w: 1, h: 1.414 },
  { label: "Presentation", size: "1920x1080", w: 16, h: 9 },
  { label: "YouTube thumbnail", size: "1280x720", w: 16, h: 9 },
];

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: SITE.maker.name,
      url: SITE.maker.url,
    },
    {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      url: `${SITE.url}/`,
      name: SITE.name,
      description: SITE.description,
      inLanguage: "en",
      publisher: { "@id": ORG_ID },
    },
    {
      "@type": "WebApplication",
      "@id": APP_ID,
      name: SITE.name,
      url: `${SITE.url}/app`,
      description: SITE.description,
      applicationCategory: "DesignApplication",
      operatingSystem: "Web browser",
      browserRequirements: "Requires JavaScript and a modern web browser.",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: [
        "No sign-up or account",
        "Designs saved on your device (IndexedDB)",
        `${LATIN_FONT_COUNT} Latin and ${MALAYALAM_FONT_COUNT} Malayalam fonts`,
        "Upload your own TTF, OTF, WOFF or WOFF2 fonts",
        "On-device AI background remover",
        "Crop, clipping masks, eraser and rasterize for images",
        "Shapes, lines, arrows, freehand drawing and sticky notes",
        "Multiple pages per design",
        "Export PNG, JPG and multi-page PDF",
        ".canvasme work files to back up and move designs",
        "Installable app that works offline",
      ],
      screenshot: [`${SITE.url}/screens/editor-desktop.webp`, `${SITE.url}/screens/editor-mobile.webp`],
      inLanguage: "en",
      publisher: { "@id": ORG_ID },
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE.url}/#faq`,
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

function Tile({
  i,
  span,
  title,
  body,
  children,
}: {
  i: number;
  span: string;
  title: string;
  body: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`reveal min-w-0 ${span}`} style={{ "--i": i } as React.CSSProperties}>
      <div
        aria-hidden
        className="flex h-56 items-center justify-center overflow-hidden rounded-[var(--radius-core)] bg-surface px-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_1px_2px_rgba(14,21,48,0.04),var(--shadow-hairline)]"
      >
        {children}
      </div>
      <h3 className="mt-5 text-lg font-semibold tracking-[-0.015em] text-ink-900">{title}</h3>
      <p className="mt-1.5 max-w-[46ch] leading-relaxed">{body}</p>
    </div>
  );
}

function SelectedHeadline() {
  const handle = "absolute h-3 w-3 rounded-full border-[1.5px] border-accent-500 bg-white";
  return (
    <div className="relative inline-block">
      <span
        aria-hidden
        className="hero-guide pointer-events-none absolute -left-4 -right-4 top-1/2 h-px bg-lavender sm:-left-8 sm:-right-8"
      />
      <h1 className="relative px-3 py-2 text-[clamp(2.75rem,7.5vw,5.25rem)] font-semibold leading-[1] tracking-[-0.045em] text-ink-900 sm:px-4">
        Design it here.
        <br />
        Keep it yours.
      </h1>
      <span aria-hidden className="hero-select pointer-events-none absolute inset-0">
        <span className="absolute inset-0 border-[1.5px] border-accent-500" />
        <span className={`${handle} -left-1.5 -top-1.5`} />
        <span className={`${handle} -right-1.5 -top-1.5`} />
        <span className={`${handle} -bottom-1.5 -left-1.5`} />
        <span className={`${handle} -bottom-1.5 -right-1.5`} />
        <span className={`${handle} -left-1.5 top-1/2 -translate-y-1/2`} />
        <span className={`${handle} -right-1.5 top-1/2 -translate-y-1/2`} />
        <span className="absolute -top-8 left-1/2 h-6 w-px -translate-x-1/2 bg-accent-500" />
        <span className={`${handle} -top-10 left-1/2 -translate-x-1/2`} />
      </span>
    </div>
  );
}

function FileTree() {
  const row = "flex items-center gap-2.5 py-1.5";
  return (
    <div className="font-mono text-[13px] text-ink-600">
      <div className={`${row} text-ink-900`}>
        <FileArchive size={16} aria-hidden className="shrink-0 text-accent-500" />
        <span className="truncate">Sunday market poster.canvasme</span>
      </div>
      <div className="ml-[7px] border-l border-ink-200 pl-5">
        <div className={row}>
          <FileText size={15} aria-hidden className="text-ink-400" /> manifest.json
        </div>
        <div className={row}>
          <FileText size={15} aria-hidden className="text-ink-400" /> design.json
          <span className="ml-auto hidden text-ink-400 sm:inline">pages, text, shapes</span>
        </div>
        <div className={row}>
          <Folder size={15} aria-hidden className="text-ink-400" /> assets/
          <span className="ml-auto hidden text-ink-400 sm:inline">your images and fonts</span>
        </div>
        <div className={row}>
          <ImageIcon size={15} aria-hidden className="text-ink-400" /> thumbnail.png
        </div>
      </div>
    </div>
  );
}

/** A photo on a checkerboard: the scene behind the subject wipes away, like the BG Remover. */
function BgRemoveDemo() {
  return (
    <div className="relative h-32 w-44 overflow-hidden rounded-[10px] bg-[repeating-conic-gradient(var(--color-ink-100)_0_25%,var(--color-surface)_0_50%)] bg-[length:16px_16px] shadow-[var(--shadow-hairline)]">
      <span className="anim-bg-wipe absolute inset-0 bg-gradient-to-b from-accent-200 to-lavender">
        <svg viewBox="0 0 176 128" className="absolute inset-x-0 bottom-0 h-14 w-full">
          <path d="M0 128 L40 80 L72 104 L112 66 L176 128 Z" fill="rgba(14,21,48,0.25)" />
        </svg>
      </span>
      <span className="absolute bottom-0 left-1/2 h-14 w-20 -translate-x-1/2 rounded-t-[40px] bg-ink-900" />
      <span className="absolute bottom-[50px] left-1/2 h-11 w-11 -translate-x-1/2 rounded-full bg-ink-800" />
    </div>
  );
}

/** Three small pictures: clipped to a circle, cropped, and partly erased. */
function ImageToolsDemo() {
  const pic = "bg-gradient-to-b from-lavender to-accent-500";
  const handle = "absolute h-2.5 w-2.5 border-accent-500";
  return (
    <div className="flex items-center gap-6 sm:gap-8">
      <span className={`block h-20 w-20 rounded-full ${pic}`} />
      <span className="relative block h-20 w-24">
        <span className={`absolute inset-0 opacity-30 ${pic}`} />
        <span className={`absolute inset-3 ${pic}`} />
        <span className={`${handle} left-2 top-2 border-l-2 border-t-2`} />
        <span className={`${handle} right-2 top-2 border-r-2 border-t-2`} />
        <span className={`${handle} bottom-2 left-2 border-b-2 border-l-2`} />
        <span className={`${handle} bottom-2 right-2 border-b-2 border-r-2`} />
      </span>
      <span
        className={`block h-20 w-20 rounded-[8px] ${pic} [mask-image:radial-gradient(circle_at_70%_30%,transparent_22px,black_24px)]`}
      />
    </div>
  );
}

function DrawDemo() {
  return (
    <div className="relative h-32 w-52">
      <span className="absolute right-0 top-2 h-20 w-20 rotate-3 rounded-[4px] bg-[#FFE08A] p-2 font-mono text-[10px] leading-tight text-ink-800 shadow-[0_8px_16px_-10px_rgba(14,21,48,0.4)]">
        Sale on Sunday
      </span>
      <svg viewBox="0 0 208 128" className="absolute inset-0 h-full w-full" fill="none">
        <path
          className="anim-draw"
          d="M10 96 C 30 40, 60 40, 70 80 S 110 120, 130 70"
          stroke="var(--color-accent-500)"
          strokeWidth="6"
          strokeLinecap="round"
          pathLength={1}
        />
        <path d="M14 116 L 150 116" stroke="var(--color-ink-900)" strokeWidth="3" strokeLinecap="round" />
        <path d="M140 108 L 152 116 L 140 124" stroke="var(--color-ink-900)" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export default function Home() {
  return (
    <SiteShell>
      <JsonLd data={STRUCTURED_DATA} />

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.15fr_1fr] lg:gap-10 lg:pb-28">
        <div>
          <p className="mb-14 inline-flex items-center gap-2 rounded-full bg-surface px-3.5 py-1.5 font-mono text-xs text-ink-600 shadow-[var(--shadow-hairline)]">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent-500" />
            Free online design editor · no sign-up
          </p>
          <SelectedHeadline />
          <p className="mt-10 max-w-md text-[17px] leading-relaxed text-pretty">
            canvas.me is a free design editor that runs in your browser. Make posts, posters and slides{" "}
            <strong className="font-semibold text-ink-900">without an account</strong>, on your laptop or your phone.
            Your designs are saved on your device, never on a server.
          </p>
          <div className="mt-9 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <PrimaryButton href="/app">Start designing</PrimaryButton>
            <InstallButton align="left" className="px-5 py-3 text-[15px]" />
          </div>
          <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {["No sign-up", "Saved on your device", "No watermark", "Malayalam fonts"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check size={15} aria-hidden className="text-accent-500" /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-[300px] lg:max-w-[320px]">
          <Bezel className="rounded-[44px] p-2">
            <div className="overflow-hidden rounded-[36px] bg-surface shadow-[var(--shadow-soft)]">
              <Image
                src="/screens/editor-mobile.webp"
                alt="The canvas.me editor on a phone, editing a Sunday market poster with the word MARKET selected"
                width={1170}
                height={2532}
                priority
                sizes="(min-width: 1024px) 320px, 300px"
                className="h-auto w-full"
              />
            </div>
          </Bezel>
        </div>
      </section>

      {/* Product */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
        <SectionTitle sub="Everything opens in a browser tab. No download, no plug-ins, no waiting.">
          The whole editor, nothing to install
        </SectionTitle>
        <Bezel className="mt-10">
          <div className="overflow-hidden rounded-[var(--radius-core)] bg-surface shadow-[var(--shadow-soft)]">
            <Image
              src="/screens/editor-desktop.webp"
              alt="The canvas.me editor on a laptop: text panel on the left, text toolbar on top and the poster in the middle"
              width={2880}
              height={1800}
              sizes="(min-width: 1152px) 1140px, 100vw"
              className="h-auto w-full"
            />
          </div>
        </Bezel>
      </section>

      {/* At a glance: short, factual statements people and answer engines can quote */}
      <section aria-labelledby="glance" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
          <SectionTitle id="glance" sub="The short version, if you only read one part of this page.">
            canvas.me at a glance
          </SectionTitle>
          <dl className={`${card} divide-y divide-ink-100 px-6 sm:px-8`}>
            {FACTS.map(([term, detail]) => (
              <div key={term} className="grid gap-1 py-5 sm:grid-cols-[10rem_1fr] sm:gap-6">
                <dt className="font-mono text-xs uppercase tracking-[0.08em] text-ink-500 sm:pt-1">{term}</dt>
                <dd className="leading-relaxed text-ink-900">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Tools: asymmetric bento, each tile a small live demo of the feature */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-20 sm:px-6 sm:pb-28">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionTitle sub="Everything you need for posts, slides and posters. Nothing you have to learn first.">
            The tools you reach for
          </SectionTitle>
          <Link
            href="/features"
            className="group inline-flex shrink-0 items-center gap-1.5 font-semibold text-accent-500 hover:text-accent-600"
          >
            See every feature
            <ArrowRight size={16} aria-hidden className="transition-transform duration-300 group-hover:translate-x-0.5" />
          </Link>
        </div>
        <RevealGroup className="mt-10 grid gap-x-4 gap-y-10 md:grid-cols-2 lg:grid-cols-6">
          <Tile
            i={0}
            span="md:col-span-2 lg:col-span-4"
            title="Text in English and Malayalam"
            body={
              <>
                {LATIN_FONT_COUNT} Latin and {MALAYALAM_FONT_COUNT} Malayalam fonts, or{" "}
                <Link href="/malayalam-poster-maker" className="font-medium text-accent-500 hover:text-accent-600">
                  upload your own
                </Link>
                . Size, colour, weight, alignment, letter and line spacing.
              </>
            }
          >
            <div className="h-[120px] overflow-hidden">
              <div className="anim-specimen">
                {[
                  ["Aa", "Geist", ""],
                  ["Aa", "Bebas Neue", bebas.className],
                  ["മല", "Manjari", manjari.className],
                  ["Aa", "Playfair Display", playfair.className],
                ].map(([glyph, name, cls]) => (
                  <div key={name} className="flex h-[120px] items-center gap-6">
                    <span className={`text-[92px] leading-none text-ink-900 ${cls}`}>{glyph}</span>
                    <span className="font-mono text-xs text-ink-500">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          </Tile>

          <Tile
            i={1}
            span="lg:col-span-2"
            title="Shapes, lines and arrows"
            body="Squares, circles, triangles, stars and hexagons with fills, borders and rounded corners."
          >
            <div className="relative h-32 w-48">
              <span className="anim-float-a absolute left-2 top-6 h-16 w-16 rounded-full bg-accent-500" />
              <span className="anim-float-b absolute left-[72px] top-0 h-14 w-14 rounded-[10px] bg-lavender" />
              <span
                className="anim-float-c absolute right-2 top-12 h-16 w-16 bg-ink-900"
                style={{ clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }}
              />
            </div>
          </Tile>

          <Tile
            i={2}
            span="lg:col-span-2"
            title="Background remover"
            body={
              <>
                Cut a photo out with AI that{" "}
                <Link href="/remove-background" className="font-medium text-accent-500 hover:text-accent-600">
                  runs on your device
                </Link>
                . The image is never uploaded.
              </>
            }
          >
            <BgRemoveDemo />
          </Tile>

          <Tile
            i={3}
            span="md:col-span-2 lg:col-span-4"
            title="Crop, clip, erase"
            body="Crop a picture, clip it to any shape, rub out parts with a soft eraser, or flatten a selection into one image."
          >
            <ImageToolsDemo />
          </Tile>

          <Tile
            i={4}
            span="md:col-span-2 lg:col-span-4"
            title="Layers and groups"
            body="Reorder, lock, hide and group elements. Snapping guides line things up while you drag."
          >
            <LayerSort />
          </Tile>

          <Tile
            i={5}
            span="lg:col-span-2"
            title="Draw and jot"
            body="Pen, marker and highlighter, an eraser for strokes, and sticky notes."
          >
            <DrawDemo />
          </Tile>

          <Tile
            i={6}
            span="lg:col-span-2"
            title="Works on your phone"
            body="Pinch to zoom, tap to select, and a bottom panel built for thumbs."
          >
            <div className="relative grid h-40 w-24 place-items-center overflow-hidden rounded-[22px] bg-ink-50 shadow-[inset_0_0_0_3px_var(--color-ink-900)]">
              <span className="anim-pinch-zoom block h-10 w-10 rounded-[8px] bg-accent-500" />
              <span className="anim-pinch-l absolute left-[30%] top-[52%] h-5 w-5 rounded-full bg-ink-900/25 shadow-[inset_0_0_0_2px_rgba(14,21,48,0.4)]" />
              <span className="anim-pinch-r absolute right-[30%] top-[38%] h-5 w-5 rounded-full bg-ink-900/25 shadow-[inset_0_0_0_2px_rgba(14,21,48,0.4)]" />
            </div>
          </Tile>

          <Tile
            i={7}
            span="md:col-span-2 lg:col-span-4"
            title="Multiple pages"
            body="Build a carousel or a slide deck in one design, then export every page at once."
          >
            <div className="w-full overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
              <div className="anim-marquee flex w-max gap-3">
                {[0, 1].flatMap((copy) =>
                  ["bg-ink-900", "bg-accent-500", "bg-lavender", "bg-surface", "bg-ink-900", "bg-accent-200"].map(
                    (bg, i) => (
                      <span
                        key={`${copy}-${i}`}
                        className={`relative block h-28 w-[90px] shrink-0 rounded-[8px] shadow-[var(--shadow-hairline)] ${bg}`}
                      >
                        <span className="absolute bottom-1.5 left-1.5 rounded bg-white/85 px-1 font-mono text-[10px] text-ink-600">
                          {i + 1}
                        </span>
                      </span>
                    ),
                  ),
                )}
              </div>
            </div>
          </Tile>
        </RevealGroup>
      </section>

      {/* Privacy and work files */}
      <section aria-labelledby="privacy" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
        <Bezel>
          <div className="grid gap-10 rounded-[var(--radius-core)] bg-surface px-6 py-10 shadow-[var(--shadow-soft)] sm:px-10 lg:grid-cols-2 lg:gap-14 lg:py-14">
            <div>
              <SectionTitle id="privacy">Your work stays yours</SectionTitle>
              <ul className="mt-8 space-y-5">
                {[
                  ["Nothing to sign up for", "No account, no email, no password. Open the editor and start."],
                  ["Saved as you go", "Every change is stored in this browser a moment after you make it."],
                  ["Never uploaded", "Designs, images and fonts stay on your device. There is no server copy."],
                  ["Yours to carry", "Download a work file to back up a design or move it to another device."],
                ].map(([t, b]) => (
                  <li key={t} className="flex gap-4">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-100 text-accent-500">
                      <Check size={15} aria-hidden />
                    </span>
                    <span>
                      <span className="block font-semibold text-ink-900">{t}</span>
                      <span className="leading-relaxed">{b}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex min-w-0 flex-col justify-center">
              <div className="rounded-[var(--radius-input)] bg-ink-50 p-5 shadow-[var(--shadow-hairline)] sm:p-6">
                <FileTree />
              </div>
              <p className="mt-4 text-sm leading-relaxed">
                A <span className="font-mono text-[13px] text-ink-900">.canvasme</span> work file is a single download
                with your pages, images and uploaded fonts inside. Open it in canvas.me on any device to keep editing.
              </p>
            </div>
          </div>
        </Bezel>
      </section>

      {/* How it works */}
      <section id="how" aria-labelledby="how-title" className="scroll-mt-24 bg-ink-900 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionTitle id="how-title" dark>
            From blank page to finished file
          </SectionTitle>
          <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
            {FLOW.map((f, i) => (
              <li key={f.step} className="text-white">
                <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-white/10 font-mono text-[13px] font-medium text-accent-200">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-lg font-semibold tracking-[-0.015em]">{f.step}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/70">{f.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Sizes */}
      <section aria-labelledby="sizes" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <SectionTitle id="sizes" sub="Each one opens a blank design in the editor. Custom sizes work too.">
          Start from a size
        </SectionTitle>
        <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {PRESETS.map((p) => {
            const box = 64;
            const w = p.w >= p.h ? box : (box * p.w) / p.h;
            const h = p.h >= p.w ? box : (box * p.h) / p.w;
            return (
              <li key={p.label}>
                <Link
                  href={`/app?size=${p.size}&name=${encodeURIComponent(p.label)}`}
                  className={`group flex h-full flex-col gap-4 rounded-[var(--radius-core)] bg-surface p-5 shadow-[var(--shadow-hairline)] hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1px_rgba(62,58,168,0.3),var(--shadow-soft)] active:scale-[0.98] ${spring}`}
                >
                  <span aria-hidden className="flex h-16 items-end">
                    <span
                      className="block rounded-[4px] border-[1.5px] border-ink-300 bg-ink-50 transition-colors duration-300 group-hover:border-accent-500 group-hover:bg-accent-50"
                      style={{ width: w, height: h }}
                    />
                  </span>
                  <span>
                    <span className="block text-[15px] font-semibold text-ink-900">{p.label}</span>
                    <span className="block font-mono text-xs text-ink-500">{p.size.replace("x", " × ")} px</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Guides */}
      <section aria-labelledby="guides" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
        <SectionTitle id="guides" sub="Step-by-step pages for the things people ask about most.">
          Guides
        </SectionTitle>
        <ul className="mt-10 grid gap-3 md:grid-cols-3">
          {GUIDES.map((g) => (
            <li key={g.href}>
              <Link
                href={g.href}
                className={`group flex h-full flex-col rounded-[var(--radius-core)] bg-surface p-6 shadow-[var(--shadow-hairline)] hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1px_rgba(62,58,168,0.3),var(--shadow-soft)] ${spring}`}
              >
                <span className="text-[17px] font-semibold text-ink-900">{g.title}</span>
                <span className="mt-2 flex-1 leading-relaxed">{g.blurb}</span>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-500">
                  Read the guide
                  <ArrowRight size={15} aria-hidden className="transition-transform duration-300 group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Install */}
      <section id="install" aria-labelledby="install-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-20 sm:px-6 sm:pb-28">
        <Bezel>
          <div className="grid items-center gap-10 rounded-[var(--radius-core)] bg-surface px-6 py-10 shadow-[var(--shadow-soft)] sm:px-10 lg:grid-cols-[1.3fr_1fr] lg:py-14">
            <div>
              <SectionTitle
                id="install-title"
                sub="Download canvas.me as an app on your computer, tablet or phone. It's the same free editor, with its own icon and window."
              >
                Take it with you
              </SectionTitle>
              <ul className="mt-7 space-y-3">
                {[
                  "Opens in its own window, without browser tabs",
                  "Works offline after the first visit",
                  "Double-click a .canvasme file to open it (Chrome and Edge)",
                ].map((t) => (
                  <li key={t} className="flex gap-3">
                    <Check size={18} aria-hidden className="mt-0.5 shrink-0 text-accent-500" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <InstallButton align="left" className="px-5 py-3 text-[15px]" />
              </div>
            </div>
            <div className="flex flex-col items-center gap-5 lg:items-end">
              <div className="flex flex-col items-center gap-2.5">
                <span className="grid h-28 w-28 place-items-center rounded-[28px] bg-surface shadow-[var(--shadow-hairline),var(--shadow-soft)]">
                  <LogoMark size={64} id="install" />
                </span>
                <span className="text-sm font-medium text-ink-900">canvas.me</span>
              </div>
              <p className="max-w-[240px] text-center font-mono text-xs leading-relaxed text-ink-500 lg:text-right">
                Windows, macOS, ChromeOS, Android, iPhone and iPad
              </p>
            </div>
          </div>
        </Bezel>
      </section>

      {/* FAQ: native <details>, so answers are in the HTML and work without JavaScript */}
      <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-20 sm:px-6 sm:pb-28">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
          <SectionTitle id="faq-title" sub="Short answers about how canvas.me works.">
            Questions
          </SectionTitle>
          <div className="space-y-2">
            {FAQ.map((f, i) => (
              <details
                key={f.q}
                open={i === 0}
                className={`${card} group px-5 py-5 sm:px-6 [&_summary::-webkit-details-marker]:hidden`}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold tracking-[-0.01em] text-ink-900">
                  <h3>{f.q}</h3>
                  <span
                    aria-hidden
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-600 transition-transform duration-300 group-open:rotate-45"
                  >
                    <span className="text-lg leading-none">+</span>
                  </span>
                </summary>
                <p className="mt-3 max-w-xl leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <ClosingCta />
    </SiteShell>
  );
}
