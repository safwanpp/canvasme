import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";

const PRESETS = [
  { label: "Instagram post", size: "1080x1080", w: 1, h: 1 },
  { label: "Story", size: "1080x1920", w: 9, h: 16 },
  { label: "Presentation", size: "1920x1080", w: 16, h: 9 },
  { label: "A4 document", size: "794x1123", w: 1, h: 1.414 },
  { label: "YouTube thumbnail", size: "1280x720", w: 16, h: 9 },
];

const FACTS = [
  {
    term: "No account",
    body: "Open the editor and start. There is no sign-up, no email and no trial that runs out.",
  },
  {
    term: "Saved as you go",
    body: "Every change is stored in your browser a moment after you make it. Close the tab and come back later. It is still there.",
  },
  {
    term: "Stays on your device",
    body: "Your designs and uploaded images are never sent to a server. The editor works entirely inside your browser.",
  },
  {
    term: "The tools you reach for",
    body: "Text with 16 typefaces, shapes, lines and arrows, image uploads, layers, grouping, snapping guides, multiple pages and undo.",
  },
];

const FLOW = [
  { step: "Make", body: "Pick a size, then add text, shapes and your own images." },
  { step: "It saves itself", body: "Changes are kept in this browser automatically." },
  { step: "Export", body: "Download PNG or JPG for posting, or a PDF for print." },
  { step: "Back up", body: "Download a .canvasme work file with everything inside it." },
  { step: "Reopen anywhere", body: "Open the work file on any computer and keep editing." },
];

const spring = "transition-[background-color,box-shadow,transform] duration-500 ease-[var(--ease-spring)]";

function PrimaryButton({ href, children, small }: { href: string; children: React.ReactNode; small?: boolean }) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center rounded-full bg-accent-500 font-semibold text-white shadow-[var(--shadow-cta)] hover:bg-accent-600 ${spring} ${
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

function SelectedHeadline() {
  const handle = "absolute h-3 w-3 rounded-full border-[1.5px] border-accent-500 bg-white sm:h-3.5 sm:w-3.5";
  return (
    <div className="relative">
      {/* Snap guide */}
      <span
        aria-hidden
        className="hero-guide pointer-events-none absolute -inset-x-6 top-1/2 h-px bg-lavender sm:-inset-x-12"
      />
      <h1 className="relative px-3 py-2 text-[clamp(2.5rem,8vw,6rem)] font-semibold leading-[1] tracking-[-0.045em] text-ink-900 text-balance sm:px-5 sm:py-3">
        Design it here.
        <br />
        Keep it yours.
      </h1>
      {/* Selection box, drawn like the editor's transformer */}
      <span aria-hidden className="hero-select pointer-events-none absolute inset-0">
        <span className="absolute inset-0 border-[1.5px] border-accent-500" />
        <span className={`${handle} -left-1.5 -top-1.5`} />
        <span className={`${handle} -right-1.5 -top-1.5`} />
        <span className={`${handle} -bottom-1.5 -left-1.5`} />
        <span className={`${handle} -bottom-1.5 -right-1.5`} />
        <span className={`${handle} -left-1.5 top-1/2 -translate-y-1/2`} />
        <span className={`${handle} -right-1.5 top-1/2 -translate-y-1/2`} />
        <span className={`${handle} -top-1.5 left-1/2 -translate-x-1/2`} />
        <span className={`${handle} -bottom-1.5 left-1/2 -translate-x-1/2`} />
        <span className="absolute -top-9 left-1/2 h-7 w-px -translate-x-1/2 bg-accent-500" />
        <span className={`${handle} -top-11 left-1/2 -translate-x-1/2`} />
        <span className="absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink-900 px-2.5 py-0.5 font-mono text-[11px] text-white">
          w 864 h 236
        </span>
      </span>
    </div>
  );
}

export default function Home() {
  return (
    <div className="grain relative min-h-dvh overflow-x-hidden bg-ink-50 text-ink-600">
      {/* Soft indigo glow, as on setitup.in */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-80 -top-96 -z-0 h-[960px] w-[960px] bg-[radial-gradient(closest-side,rgba(62,58,168,0.12),rgba(62,58,168,0)_72%)]"
      />

      <header className="sticky top-0 z-40 px-4 pt-4 sm:px-6">
        <nav className="mx-auto flex max-w-6xl items-center gap-3 rounded-full bg-surface/80 py-1.5 pl-5 pr-1.5 shadow-[inset_0_0_0_1px_rgba(14,21,48,0.06),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-xl backdrop-saturate-150">
          <Link href="/" className="mr-auto text-[15px] font-bold tracking-[-0.01em] text-ink-900">
            canvas<span className="text-accent-500">.me</span>
          </Link>
          <PrimaryButton href="/app" small>
            Open the editor
          </PrimaryButton>
        </nav>
      </header>

      <main className="relative">
        {/* Hero: the headline selected on a page, framed like a SETITUP bezel */}
        <section className="px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-16">
          <div className="mx-auto max-w-4xl rounded-[var(--radius-shell)] bg-[rgba(14,21,48,0.035)] p-1.5 shadow-[inset_0_0_0_1px_rgba(14,21,48,0.05)]">
            <div className="rounded-[var(--radius-core)] bg-ink-100 p-3 sm:p-6">
              <div className="bg-surface px-6 pb-16 pt-24 shadow-[var(--shadow-soft)] sm:px-14 sm:pb-20 sm:pt-28">
                <div className="flex justify-center">
                  <SelectedHeadline />
                </div>
                <p className="mx-auto mt-20 max-w-xl text-center text-[17px] leading-relaxed text-ink-600">
                  A free design editor that runs in your browser. Make posts, slides and posters{" "}
                  <strong className="font-semibold text-ink-900">without an account</strong>. Your work is saved on
                  your own device.
                </p>
                <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-7">
                  <PrimaryButton href="/app">Start designing</PrimaryButton>
                  <Link
                    href="/app"
                    className="border-b border-ink-300 py-1 text-[15px] font-medium text-ink-900 transition-colors duration-300 hover:border-accent-500 hover:text-accent-500"
                  >
                    Open a .canvasme file
                  </Link>
                </div>
              </div>
              <p className="mt-3 text-center font-mono text-xs text-ink-500">Page 1 of 1 &nbsp; 1080 × 1080 px</p>
            </div>
          </div>
        </section>

        {/* What you get */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <h2 className="max-w-xl text-3xl font-semibold tracking-[-0.03em] text-ink-900 text-balance sm:text-[40px] sm:leading-[1.1]">
            Everything happens in your browser
          </h2>
          <dl className="mt-12 grid gap-3 sm:grid-cols-2">
            {FACTS.map((f) => (
              <div
                key={f.term}
                className="rounded-[var(--radius-core)] bg-surface px-6 pb-8 pt-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_1px_2px_rgba(14,21,48,0.04),var(--shadow-hairline)]"
              >
                <dt className="text-lg font-semibold tracking-[-0.015em] text-ink-900">{f.term}</dt>
                <dd className="mt-2 max-w-md leading-relaxed">{f.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* How your work moves: a real sequence */}
        <section className="bg-ink-900 py-20 text-white sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="max-w-xl text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-[40px] sm:leading-[1.1]">
              From blank page to finished file
            </h2>
            <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
              {FLOW.map((f, i) => (
                <li key={f.step}>
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

        {/* Start from a size */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <h2 className="text-3xl font-semibold tracking-[-0.03em] text-ink-900 sm:text-[40px] sm:leading-[1.1]">
            Start from a size
          </h2>
          <p className="mt-3 max-w-lg">Each one opens a blank design in the editor.</p>
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

        {/* Honest limits */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
          <div className="rounded-[var(--radius-shell)] bg-[rgba(14,21,48,0.035)] p-1.5 shadow-[inset_0_0_0_1px_rgba(14,21,48,0.05)]">
            <div className="grid gap-6 rounded-[var(--radius-core)] bg-surface px-6 py-8 shadow-[var(--shadow-soft)] sm:grid-cols-[1fr_2fr] sm:px-10 sm:py-10">
              <h2 className="text-2xl font-semibold tracking-[-0.025em] text-ink-900">Good to know</h2>
              <div className="max-w-2xl space-y-3 leading-relaxed">
                <p>
                  Designs live in the browser you made them in. Clearing your browser&apos;s site data deletes them, and
                  they won&apos;t appear on your other devices by themselves.
                </p>
                <p>
                  To keep a design safe or move it to another computer, choose Download, then Work file. Open that file
                  in canvas.me anywhere to carry on editing.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative border-t border-ink-200">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-10 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="font-bold text-ink-900">
            canvas<span className="text-accent-500">.me</span>
            <span className="ml-3 font-normal text-ink-500">Free to use. No account needed.</span>
          </span>
          <a
            href="https://setitup.in"
            className="inline-flex items-center gap-1 font-medium text-ink-900 transition-colors duration-300 hover:text-accent-500"
          >
            Built by SETITUP <ArrowUpRight size={15} />
          </a>
        </div>
      </footer>
    </div>
  );
}
