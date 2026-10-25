import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { InstallButton } from "@/components/Pwa";
import { GUIDES, jsonLd } from "@/lib/site";

export const spring = "transition-[background-color,box-shadow,transform,color] duration-500 ease-[var(--ease-spring)]";
export const card =
  "rounded-[var(--radius-core)] bg-surface shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_1px_2px_rgba(14,21,48,0.04),var(--shadow-hairline)]";

export function PrimaryButton({ href, children, small }: { href: string; children: React.ReactNode; small?: boolean }) {
  return (
    <Link
      href={href}
      className={`group inline-flex shrink-0 items-center rounded-full bg-accent-500 font-semibold text-white shadow-[var(--shadow-cta)] hover:bg-accent-600 active:scale-[0.98] ${spring} ${
        small ? "gap-2.5 py-[5px] pl-[18px] pr-[5px] text-sm" : "gap-3.5 py-[7px] pl-6 pr-[7px] text-[15px]"
      }`}
    >
      {children}
      <span
        className={`grid place-items-center rounded-full bg-white/15 group-hover:translate-x-0.5 group-hover:bg-white/25 ${spring} ${
          small ? "h-8 w-8" : "h-10 w-10"
        }`}
      >
        <ArrowRight size={small ? 15 : 17} aria-hidden />
      </span>
    </Link>
  );
}

export function Bezel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[var(--radius-shell)] bg-[rgba(14,21,48,0.035)] p-1.5 shadow-[inset_0_0_0_1px_rgba(14,21,48,0.05)] ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  sub,
  dark,
  id,
}: {
  children: React.ReactNode;
  sub?: React.ReactNode;
  dark?: boolean;
  id?: string;
}) {
  return (
    <div className="max-w-2xl">
      <h2
        id={id}
        className={`text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-balance sm:text-[44px] ${dark ? "text-white" : "text-ink-900"}`}
      >
        {children}
      </h2>
      {sub && <p className={`mt-4 text-[17px] leading-relaxed text-pretty ${dark ? "text-white/65" : ""}`}>{sub}</p>}
    </div>
  );
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}

const NAV: [string, string][] = [
  ["Features", "/features"],
  ["Malayalam posters", "/malayalam-poster-maker"],
  ["Remove background", "/remove-background"],
  ["FAQ", "/#faq"],
];

/** Page frame for the marketing pages: skip link, sticky pill nav, footer. */
export function SiteShell({ children, current }: { children: React.ReactNode; current?: string }) {
  return (
    <div className="grain relative min-h-dvh overflow-x-clip bg-ink-50 text-ink-600">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-accent-500 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <div
        aria-hidden
        className="pointer-events-none absolute -right-80 -top-96 h-[960px] w-[960px] bg-[radial-gradient(closest-side,rgba(62,58,168,0.12),rgba(62,58,168,0)_72%)]"
      />

      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6 sm:pt-4">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-6xl items-center gap-2 rounded-full bg-surface/80 py-1.5 pl-4 pr-1.5 shadow-[inset_0_0_0_1px_rgba(14,21,48,0.06),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-xl backdrop-saturate-150 sm:pl-5"
        >
          <Link href="/" aria-label="canvas.me home" className="mr-auto text-[15px]">
            <Logo id="nav" />
          </Link>
          <div className="hidden items-center lg:flex">
            {NAV.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                aria-current={current === href ? "page" : undefined}
                className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-600 transition-colors duration-300 hover:bg-ink-100 hover:text-ink-900 aria-[current=page]:bg-ink-100 aria-[current=page]:text-ink-900"
              >
                {label}
              </Link>
            ))}
          </div>
          <InstallButton variant="icon" className="sm:hidden" />
          <InstallButton className="hidden py-[9px] sm:flex" />
          <PrimaryButton href="/app" small>
            Open editor
          </PrimaryButton>
        </nav>
      </header>

      <main id="main" className="relative">
        {children}
      </main>

      <footer className="relative border-t border-ink-200">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 text-sm sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo id="foot" size={18} />
            <p className="mt-3 max-w-xs leading-relaxed text-ink-500">
              A free design editor that runs in your browser. No account, and your designs stay on your device.
            </p>
          </div>
          <nav aria-label="Guides">
            <p className="font-semibold text-ink-900">Learn</p>
            <ul className="mt-3 space-y-2">
              {GUIDES.map((g) => (
                <li key={g.href}>
                  <Link href={g.href} className="text-ink-600 transition-colors duration-300 hover:text-accent-500">
                    {g.title}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/#faq" className="text-ink-600 transition-colors duration-300 hover:text-accent-500">
                  Questions and answers
                </Link>
              </li>
            </ul>
          </nav>
          <div>
            <p className="font-semibold text-ink-900">canvas.me</p>
            <ul className="mt-3 space-y-2">
              <li>
                <Link href="/app" className="text-ink-600 transition-colors duration-300 hover:text-accent-500">
                  Open the editor
                </Link>
              </li>
              <li>
                <InstallButton variant="link" />
              </li>
              <li>
                <a
                  href="https://github.com/safwanpp/canvasme"
                  className="text-ink-600 transition-colors duration-300 hover:text-accent-500"
                >
                  Source on GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://setitup.in"
                  className="inline-flex items-center gap-1 font-medium text-ink-900 transition-colors duration-300 hover:text-accent-500"
                >
                  Built by SETITUP <ArrowUpRight size={15} aria-hidden />
                </a>
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Closing call to action shared by the landing and content pages. */
export function ClosingCta({
  title = "Your next post is one tab away",
  body = "Free, private and ready on any device. No account needed.",
  href = "/app",
  label = "Start designing",
}: {
  title?: string;
  body?: string;
  href?: string;
  label?: string;
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
      <Bezel>
        <div className="relative overflow-hidden rounded-[var(--radius-core)] bg-accent-500 px-6 py-14 text-center text-white sm:px-10 sm:py-20">
          <h2 className="relative mx-auto max-w-xl text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-balance sm:text-[44px]">
            {title}
          </h2>
          <p className="relative mx-auto mt-4 max-w-md text-[17px] text-white/80">{body}</p>
          <div className="relative mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={href}
              className={`group relative inline-flex items-center gap-3.5 rounded-full bg-white py-[7px] pl-6 pr-[7px] text-[15px] font-semibold text-accent-600 shadow-[0_16px_32px_-16px_rgba(8,12,30,0.6)] hover:bg-accent-50 active:scale-[0.98] ${spring}`}
            >
              {label}
              <span
                className={`grid h-10 w-10 place-items-center rounded-full bg-accent-100 group-hover:translate-x-0.5 ${spring}`}
              >
                <ArrowRight size={17} aria-hidden />
              </span>
            </Link>
            <InstallButton variant="onAccent" align="left" />
          </div>
        </div>
      </Bezel>
    </section>
  );
}

/** Long-form layout for the guide and feature pages: breadcrumb, H1, lede, then prose. */
export function ArticleHeader({
  crumb,
  title,
  lede,
  cta,
}: {
  crumb: string;
  title: string;
  lede: React.ReactNode;
  cta?: { href: string; label: string };
}) {
  return (
    <header className="mx-auto max-w-3xl px-4 pb-12 pt-14 sm:px-6 sm:pt-20">
      <nav aria-label="Breadcrumb" className="font-mono text-xs text-ink-500">
        <ol className="flex items-center gap-2">
          <li>
            <Link href="/" className="hover:text-accent-500">
              Home
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-ink-900">
            {crumb}
          </li>
        </ol>
      </nav>
      <h1 className="mt-6 text-[clamp(2.25rem,6vw,3.75rem)] font-semibold leading-[1.04] tracking-[-0.04em] text-ink-900 text-balance">
        {title}
      </h1>
      <div className="mt-6 max-w-[62ch] text-lg leading-relaxed text-pretty">{lede}</div>
      {cta && (
        <div className="mt-8">
          <PrimaryButton href={cta.href}>{cta.label}</PrimaryButton>
        </div>
      )}
    </header>
  );
}

/** Typography for long-form content; plain elements inside get spacing and colour from here. */
export const prose =
  "mx-auto max-w-3xl px-4 pb-20 sm:px-6 sm:pb-24 text-[17px] leading-relaxed [&_h2]:mt-14 [&_h2]:scroll-mt-24 [&_h2]:text-[28px] [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:tracking-[-0.025em] [&_h2]:text-ink-900 [&_h2]:text-balance [&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink-900 [&_p]:mt-4 [&_p]:max-w-[68ch] [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-3 [&_ol]:pl-5 [&_li]:max-w-[66ch] [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-ink-900 [&_kbd]:rounded-md [&_kbd]:bg-surface [&_kbd]:px-1.5 [&_kbd]:py-0.5 [&_kbd]:font-mono [&_kbd]:text-[13px] [&_kbd]:text-ink-900 [&_kbd]:shadow-[var(--shadow-hairline)] [&_a]:font-medium [&_a]:text-accent-500 [&_a]:underline [&_a]:decoration-accent-200 [&_a]:underline-offset-4 hover:[&_a]:decoration-accent-500";

/** "Read next" cards linking the other content pages. */
export function RelatedGuides({ exclude }: { exclude: string }) {
  const items = GUIDES.filter((g) => g.href !== exclude);
  return (
    <section aria-labelledby="related" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
      <h2 id="related" className="text-xl font-semibold tracking-[-0.02em] text-ink-900">
        Read next
      </h2>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {items.map((g) => (
          <li key={g.href}>
            <Link
              href={g.href}
              className={`group flex h-full flex-col rounded-[var(--radius-core)] bg-surface p-6 shadow-[var(--shadow-hairline)] hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1px_rgba(62,58,168,0.3),var(--shadow-soft)] ${spring}`}
            >
              <span className="flex items-center justify-between gap-3 text-[17px] font-semibold text-ink-900">
                {g.title}
                <ArrowRight
                  size={17}
                  aria-hidden
                  className="shrink-0 text-ink-400 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-accent-500"
                />
              </span>
              <span className="mt-2 leading-relaxed">{g.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
