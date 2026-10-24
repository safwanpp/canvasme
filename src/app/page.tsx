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

function SelectedHeadline() {
  const handle = "absolute h-3 w-3 rounded-full border-2 border-accent-500 bg-white sm:h-3.5 sm:w-3.5";
  return (
    <div className="relative">
      {/* Snap guide */}
      <span
        aria-hidden
        className="hero-guide pointer-events-none absolute -inset-x-6 top-1/2 h-px bg-[#d946ef] sm:-inset-x-12"
      />
      <h1 className="relative px-3 py-2 font-display text-[clamp(2.6rem,8.5vw,6.5rem)] font-extrabold leading-[0.95] tracking-[-0.035em] text-ink-900 sm:px-5 sm:py-3">
        Design it here.
        <br />
        Keep it yours.
      </h1>
      {/* Selection box, drawn like the editor's transformer */}
      <span aria-hidden className="hero-select pointer-events-none absolute inset-0">
        <span className="absolute inset-0 border-2 border-accent-500" />
        <span className={`${handle} -left-1.5 -top-1.5`} />
        <span className={`${handle} -right-1.5 -top-1.5`} />
        <span className={`${handle} -bottom-1.5 -left-1.5`} />
        <span className={`${handle} -bottom-1.5 -right-1.5`} />
        <span className={`${handle} -left-1.5 top-1/2 -translate-y-1/2`} />
        <span className={`${handle} -right-1.5 top-1/2 -translate-y-1/2`} />
        <span className={`${handle} -top-1.5 left-1/2 -translate-x-1/2`} />
        <span className={`${handle} -bottom-1.5 left-1/2 -translate-x-1/2`} />
        <span className="absolute -top-9 left-1/2 h-7 w-0.5 -translate-x-1/2 bg-accent-500" />
        <span className={`${handle} -top-11 left-1/2 -translate-x-1/2`} />
        <span className="absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink-900 px-2 py-0.5 text-xs tabular-nums text-white">
          w 864 &nbsp;h 236
        </span>
      </span>
    </div>
  );
}

export default function Home() {
  return (
    <div className="bg-white text-ink-900">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="font-display text-xl font-bold tracking-tight">
          canvas<span className="text-accent-500">.me</span>
        </Link>
        <Link
          href="/app"
          className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-100 focus-visible:outline-2 focus-visible:outline-accent-500"
        >
          Open the editor
        </Link>
      </header>

      <main>
        {/* Hero: the workspace, with the headline selected on the page */}
        <section className="bg-[#ebecf0] px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-4xl bg-white px-6 pb-20 pt-24 shadow-[0_4px_24px_rgba(15,23,42,0.12)] sm:px-14 sm:pb-24 sm:pt-28">
              <div className="flex justify-center">
                <SelectedHeadline />
              </div>
              <p className="mx-auto mt-20 max-w-xl text-center text-lg leading-relaxed text-ink-600">
                A free design editor that runs in your browser. Make posts, slides and posters without an account. Your
                work is saved on your own device.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/app"
                  className="rounded-xl bg-accent-500 px-6 py-3.5 text-base font-semibold text-white hover:bg-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900"
                >
                  Start designing
                </Link>
                <Link
                  href="/app"
                  className="rounded-xl px-5 py-3.5 text-base font-medium text-ink-700 hover:bg-ink-100 focus-visible:outline-2 focus-visible:outline-accent-500"
                >
                  Open a .canvasme file
                </Link>
              </div>
            </div>
            <p className="mt-4 text-center text-xs tabular-nums text-ink-500">Page 1 of 1 &nbsp; 1080 × 1080 px</p>
          </div>
        </section>

        {/* What you get */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <h2 className="max-w-xl font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Everything happens in your browser
          </h2>
          <dl className="mt-12 grid gap-x-16 gap-y-10 sm:grid-cols-2">
            {FACTS.map((f) => (
              <div key={f.term} className="border-t border-ink-200 pt-5">
                <dt className="font-display text-xl font-semibold">{f.term}</dt>
                <dd className="mt-2 max-w-md leading-relaxed text-ink-600">{f.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* How your work moves: a real sequence */}
        <section className="bg-ink-900 py-20 text-white sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="max-w-xl font-display text-3xl font-bold tracking-tight sm:text-4xl">
              From blank page to finished file
            </h2>
            <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
              {FLOW.map((f, i) => (
                <li key={f.step} className="relative">
                  <span className="font-display text-sm font-semibold tabular-nums text-accent-400">{i + 1}</span>
                  <p className="mt-1 font-display text-lg font-semibold">{f.step}</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">{f.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Start from a size */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Start from a size</h2>
          <p className="mt-3 max-w-lg text-ink-600">Each one opens a blank design in the editor.</p>
          <ul className="mt-10 flex flex-wrap items-end gap-x-8 gap-y-8">
            {PRESETS.map((p) => {
              const box = 72;
              const w = p.w >= p.h ? box : (box * p.w) / p.h;
              const h = p.h >= p.w ? box : (box * p.h) / p.w;
              return (
                <li key={p.label}>
                  <Link
                    href={`/app?size=${p.size}&name=${encodeURIComponent(p.label)}`}
                    className="group flex flex-col items-start gap-3 rounded-lg p-1 focus-visible:outline-2 focus-visible:outline-accent-500"
                  >
                    <span
                      className="block border-2 border-ink-300 bg-ink-50 transition-colors group-hover:border-accent-500"
                      style={{ width: w, height: h }}
                    />
                    <span>
                      <span className="block text-sm font-semibold group-hover:text-accent-600">{p.label}</span>
                      <span className="block text-xs tabular-nums text-ink-500">{p.size.replace("x", " × ")} px</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Honest limits */}
        <section className="border-t border-ink-200 bg-ink-50 py-16">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:grid-cols-[1fr_2fr] sm:px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight">Good to know</h2>
            <div className="max-w-2xl space-y-3 leading-relaxed text-ink-600">
              <p>
                Designs live in the browser you made them in. Clearing your browser&apos;s site data deletes them, and
                they won&apos;t appear on your other devices by themselves.
              </p>
              <p>
                To keep a design safe or move it to another computer, choose Download, then Work file. Open that file in
                canvas.me anywhere to carry on editing.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-10 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span className="font-display font-bold text-ink-900">
          canvas<span className="text-accent-500">.me</span>
        </span>
        <span>Free to use. No account needed.</span>
      </footer>
    </div>
  );
}
