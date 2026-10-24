import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileArchive,
  Files,
  FileText,
  Folder,
  ImageIcon,
  Layers,
  Shapes,
  Smartphone,
  Type,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/Logo";

const TOOLS = [
  {
    icon: Type,
    title: "Text that looks right",
    body: "17 typefaces including Geist, Bebas Neue and Playfair. Size, colour, bold, italic, alignment, letter and line spacing.",
  },
  {
    icon: Shapes,
    title: "Shapes and lines",
    body: "Squares, circles, triangles, stars and hexagons with fills, borders and rounded corners. Lines, dashes and arrows.",
  },
  {
    icon: ImageIcon,
    title: "Your own images",
    body: "Upload, drag in or paste PNG, JPG, GIF, WebP or AVIF. Round the corners and place them anywhere.",
  },
  {
    icon: Layers,
    title: "Layers and groups",
    body: "Reorder, lock, hide and group elements. Snapping guides line things up as you drag.",
  },
  {
    icon: Files,
    title: "Multiple pages",
    body: "Build a carousel or a slide deck in one design. Duplicate, reorder and export every page at once.",
  },
  {
    icon: Smartphone,
    title: "Works on your phone",
    body: "Pinch to zoom, tap to select, and a bottom panel built for thumbs. Same designs, same tools.",
  },
];

const FLOW = [
  { step: "Make", body: "Pick a size, then add text, shapes and your own images." },
  { step: "It saves itself", body: "Changes are kept in this browser automatically." },
  { step: "Export", body: "Download PNG or JPG for posting, or a PDF for print." },
  { step: "Back up", body: "Download a .canvasme work file with everything inside it." },
  { step: "Reopen anywhere", body: "Open the work file on any computer and keep editing." },
];

const PRESETS = [
  { label: "Instagram post", size: "1080x1080", w: 1, h: 1 },
  { label: "Story", size: "1080x1920", w: 9, h: 16 },
  { label: "Presentation", size: "1920x1080", w: 16, h: 9 },
  { label: "A4 document", size: "794x1123", w: 1, h: 1.414 },
  { label: "YouTube thumbnail", size: "1280x720", w: 16, h: 9 },
];

const FAQ = [
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
    a: "In your browser's own storage on this device. Nothing is uploaded to a server, so nobody else can see your work.",
  },
  {
    q: "What happens if I clear my browser data?",
    a: "Your designs are deleted with it. Download a .canvasme work file for anything you want to keep, and open it again whenever you like.",
  },
  {
    q: "Can I move a design to another computer or my phone?",
    a: "Yes. Download the work file, send it to the other device, and open it in canvas.me there. Images and pages come with it.",
  },
  {
    q: "Which file types can I export?",
    a: "PNG and JPG at twice the design size, a zip of every page as images, or a multi-page PDF.",
  },
];

const spring = "transition-[background-color,box-shadow,transform,color] duration-500 ease-[var(--ease-spring)]";
const card =
  "rounded-[var(--radius-core)] bg-surface shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_1px_2px_rgba(14,21,48,0.04),var(--shadow-hairline)]";

function PrimaryButton({ href, children, small }: { href: string; children: React.ReactNode; small?: boolean }) {
  return (
    <Link
      href={href}
      className={`group inline-flex shrink-0 items-center rounded-full bg-accent-500 font-semibold text-white shadow-[var(--shadow-cta)] hover:bg-accent-600 ${spring} ${
        small ? "gap-2.5 py-[5px] pl-[18px] pr-[5px] text-sm" : "gap-3.5 py-[7px] pl-6 pr-[7px] text-[15px]"
      }`}
    >
      {children}
      <span
        className={`grid place-items-center rounded-full bg-white/15 group-hover:translate-x-0.5 group-hover:bg-white/25 ${spring} ${
          small ? "h-8 w-8" : "h-10 w-10"
        }`}
      >
        <ArrowRight size={small ? 15 : 17} />
      </span>
    </Link>
  );
}

function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="border-b border-ink-300 py-1 text-[15px] font-medium text-ink-900 transition-colors duration-300 hover:border-accent-500 hover:text-accent-500"
    >
      {children}
    </Link>
  );
}

function Bezel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[var(--radius-shell)] bg-[rgba(14,21,48,0.035)] p-1.5 shadow-[inset_0_0_0_1px_rgba(14,21,48,0.05)] ${className}`}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children, sub, dark }: { children: React.ReactNode; sub?: string; dark?: boolean }) {
  return (
    <div className="max-w-2xl">
      <h2
        className={`text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-balance sm:text-[44px] ${dark ? "text-white" : "text-ink-900"}`}
      >
        {children}
      </h2>
      {sub && <p className={`mt-4 text-[17px] leading-relaxed ${dark ? "text-white/65" : ""}`}>{sub}</p>}
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
        <FileArchive size={16} className="shrink-0 text-accent-500" />
        <span className="truncate">Sunday market poster.canvasme</span>
      </div>
      <div className="ml-[7px] border-l border-ink-200 pl-5">
        <div className={row}>
          <FileText size={15} className="text-ink-400" /> manifest.json
        </div>
        <div className={row}>
          <FileText size={15} className="text-ink-400" /> design.json
          <span className="ml-auto hidden text-ink-400 sm:inline">pages, text, shapes</span>
        </div>
        <div className={row}>
          <Folder size={15} className="text-ink-400" /> assets/
          <span className="ml-auto hidden text-ink-400 sm:inline">your images</span>
        </div>
        <div className={row}>
          <ImageIcon size={15} className="text-ink-400" /> thumbnail.png
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="grain relative min-h-dvh overflow-x-clip bg-ink-50 text-ink-600">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-80 -top-96 h-[960px] w-[960px] bg-[radial-gradient(closest-side,rgba(62,58,168,0.12),rgba(62,58,168,0)_72%)]"
      />

      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6 sm:pt-4">
        <nav className="mx-auto flex max-w-6xl items-center gap-2 rounded-full bg-surface/80 py-1.5 pl-4 pr-1.5 shadow-[inset_0_0_0_1px_rgba(14,21,48,0.06),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-xl backdrop-saturate-150 sm:pl-5">
          <Link href="/" aria-label="canvas.me home" className="mr-auto text-[15px]">
            <Logo id="nav" />
          </Link>
          <div className="hidden items-center md:flex">
            {[
              ["Features", "#features"],
              ["How it works", "#how"],
              ["FAQ", "#faq"],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-600 transition-colors duration-300 hover:bg-ink-100 hover:text-ink-900"
              >
                {label}
              </a>
            ))}
          </div>
          <PrimaryButton href="/app" small>
            Open editor
          </PrimaryButton>
        </nav>
      </header>

      <main className="relative">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.15fr_1fr] lg:gap-10 lg:pb-28">
          <div className="text-center lg:text-left">
            <SelectedHeadline />
            <p className="mx-auto mt-10 max-w-md text-[17px] leading-relaxed lg:mx-0">
              A free design editor that runs in your browser. Make posts, slides and posters{" "}
              <strong className="font-semibold text-ink-900">without an account</strong>, on your laptop or your phone.
            </p>
            <div className="mt-9 flex flex-col items-center gap-5 sm:flex-row sm:justify-center lg:justify-start">
              <PrimaryButton href="/app">Start designing</PrimaryButton>
              <TextLink href="/app">Open a .canvasme file</TextLink>
            </div>
            <ul className="mt-9 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm lg:justify-start">
              {["No sign-up", "Saved on your device", "Free exports"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check size={15} className="text-accent-500" /> {t}
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
                className="h-auto w-full"
              />
            </div>
          </Bezel>
        </section>

        {/* Tools */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-20 sm:px-6 sm:pb-28">
          <SectionTitle>The tools you reach for</SectionTitle>
          <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map(({ icon: Icon, title, body }) => (
              <li key={title} className={`${card} px-6 pb-7 pt-6`}>
                <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-100 text-accent-500">
                  <Icon size={19} />
                </span>
                <h3 className="mt-5 text-lg font-semibold tracking-[-0.015em] text-ink-900">{title}</h3>
                <p className="mt-2 leading-relaxed">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Privacy and work files */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
          <Bezel>
            <div className="grid gap-10 rounded-[var(--radius-core)] bg-surface px-6 py-10 shadow-[var(--shadow-soft)] sm:px-10 lg:grid-cols-2 lg:gap-14 lg:py-14">
              <div>
                <SectionTitle>Your work stays yours</SectionTitle>
                <ul className="mt-8 space-y-5">
                  {[
                    ["Saved as you go", "Every change is stored in this browser a moment after you make it."],
                    ["Never uploaded", "Designs and images stay on your device. There is no server copy."],
                    ["Yours to carry", "Download a work file to back up a design or move it to another device."],
                  ].map(([t, b]) => (
                    <li key={t} className="flex gap-4">
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-100 text-accent-500">
                        <Check size={15} />
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
                  with your pages and images inside. Open it in canvas.me on any device to keep editing.
                </p>
              </div>
            </div>
          </Bezel>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-24 bg-ink-900 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionTitle dark>From blank page to finished file</SectionTitle>
            <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
              {FLOW.map((f, i) => (
                <li key={f.step} className="text-white">
                  <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-white/10 font-mono text-[13px] font-medium text-accent-200">
                    {i + 1}
                  </span>
                  <p className="mt-4 text-lg font-semibold tracking-[-0.015em]">{f.step}</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">{f.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Sizes */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <SectionTitle sub="Each one opens a blank design in the editor.">Start from a size</SectionTitle>
          <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {PRESETS.map((p) => {
              const box = 64;
              const w = p.w >= p.h ? box : (box * p.w) / p.h;
              const h = p.h >= p.w ? box : (box * p.h) / p.w;
              return (
                <li key={p.label}>
                  <Link
                    href={`/app?size=${p.size}&name=${encodeURIComponent(p.label)}`}
                    className={`group flex h-full flex-col gap-4 rounded-[var(--radius-core)] bg-surface p-5 shadow-[var(--shadow-hairline)] hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1px_rgba(62,58,168,0.3),var(--shadow-soft)] ${spring}`}
                  >
                    <span className="flex h-16 items-end">
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

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-20 sm:px-6 sm:pb-28">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
            <SectionTitle sub="Short answers about how canvas.me works.">Questions</SectionTitle>
            <div className="space-y-2">
              {FAQ.map((f) => (
                <details key={f.q} className={`${card} group px-5 py-5 sm:px-6 [&_summary::-webkit-details-marker]:hidden`}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold tracking-[-0.01em] text-ink-900">
                    {f.q}
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-600 transition-transform duration-300 group-open:rotate-45">
                      <span className="text-lg leading-none">+</span>
                    </span>
                  </summary>
                  <p className="mt-3 max-w-xl leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
          <Bezel>
            <div className="relative overflow-hidden rounded-[var(--radius-core)] bg-accent-500 px-6 py-14 text-center text-white sm:px-10 sm:py-20">
              <div
                aria-hidden
                className="pointer-events-none absolute -bottom-40 left-1/2 h-80 w-[640px] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(157,127,244,0.55),rgba(157,127,244,0))]"
              />
              <h2 className="relative mx-auto max-w-xl text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-balance sm:text-[44px]">
                Your next post is one tab away
              </h2>
              <p className="relative mx-auto mt-4 max-w-md text-[17px] text-white/75">
                Free, private and ready on any device. No account needed.
              </p>
              <Link
                href="/app"
                className={`group relative mt-9 inline-flex items-center gap-3.5 rounded-full bg-white py-[7px] pl-6 pr-[7px] text-[15px] font-semibold text-accent-600 shadow-[0_16px_32px_-16px_rgba(8,12,30,0.6)] hover:bg-accent-50 ${spring}`}
              >
                Start designing
                <span
                  className={`grid h-10 w-10 place-items-center rounded-full bg-accent-100 group-hover:translate-x-0.5 ${spring}`}
                >
                  <ArrowRight size={17} />
                </span>
              </Link>
            </div>
          </Bezel>
        </section>
      </main>

      <footer className="relative border-t border-ink-200">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Logo id="foot" size={18} />
            <span className="text-ink-500">Free to use. No account needed.</span>
          </span>
          <span className="flex items-center gap-5">
            <a
              href="https://github.com/safwanpp/canvasme"
              className="font-medium text-ink-600 transition-colors duration-300 hover:text-accent-500"
            >
              Source on GitHub
            </a>
            <a
              href="https://setitup.in"
              className="inline-flex items-center gap-1 font-medium text-ink-900 transition-colors duration-300 hover:text-accent-500"
            >
              Built by SETITUP <ArrowUpRight size={15} />
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
