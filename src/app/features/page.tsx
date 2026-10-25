import type { Metadata } from "next";
import Link from "next/link";
import { ArticleHeader, card, ClosingCta, JsonLd, prose, RelatedGuides, SiteShell } from "@/components/landing/Site";
import { FEATURE_GROUPS, SHORTCUTS, SIZES } from "@/lib/content";
import { APP_ID, breadcrumbs, pageMetadata, SITE, WEBSITE_ID } from "@/lib/site";

const TITLE = "Features of canvas.me, the free browser design editor";
const DESCRIPTION =
  "Every feature of canvas.me: Malayalam and custom fonts, shapes, drawing, background remover, crop, clipping masks, PSD, AI and PDF import, PNG/JPG/PDF/PSD export and offline use.";

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/features" });

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${SITE.url}/features`,
      url: `${SITE.url}/features`,
      name: TITLE,
      description: DESCRIPTION,
      isPartOf: { "@id": WEBSITE_ID },
      about: { "@id": APP_ID },
      dateModified: SITE.updated,
    },
    breadcrumbs([
      ["Home", "/"],
      ["Features", "/features"],
    ]),
  ],
};

export default function FeaturesPage() {
  return (
    <SiteShell current="/features">
      <JsonLd data={STRUCTURED_DATA} />
      <ArticleHeader
        crumb="Features"
        title="Everything in the canvas.me editor"
        lede={
          <p>
            canvas.me is a free design editor that runs in your browser, with no account. This page lists what it can
            do today. Everything here works on a laptop and on a phone, and every design is saved on your own device.
          </p>
        }
        cta={{ href: "/app", label: "Open the editor" }}
      />

      <div className={prose}>
        <nav aria-label="On this page" className={`${card} p-6`}>
          <p className="!mt-0 font-mono text-xs uppercase tracking-[0.08em] text-ink-500">On this page</p>
          <ul className="!mt-3 !list-none !space-y-1.5 !pl-0">
            {[...FEATURE_GROUPS.map((g) => [g.id, g.title]), ["sizes", "Design sizes"], ["shortcuts", "Keyboard shortcuts"], ["limits", "Limits worth knowing"]].map(
              ([id, title]) => (
                <li key={id} className="!pl-0">
                  <a href={`#${id}`}>{title}</a>
                </li>
              ),
            )}
          </ul>
        </nav>

        {FEATURE_GROUPS.map((g) => (
          <section key={g.id} aria-labelledby={g.id}>
            <h2 id={g.id}>{g.title}</h2>
            <dl className="mt-5 divide-y divide-ink-200 border-y border-ink-200">
              {g.items.map(([term, detail]) => (
                <div key={term} className="grid gap-1 py-4 sm:grid-cols-[13rem_1fr] sm:gap-6">
                  <dt className="font-semibold text-ink-900">{term}</dt>
                  <dd>
                    {detail}
                    {term === "Background remover" && (
                      <>
                        {" "}
                        <Link href="/remove-background">How the background remover works</Link>.
                      </>
                    )}
                    {term === "Built-in fonts" && (
                      <>
                        {" "}
                        <Link href="/malayalam-poster-maker">See all Malayalam fonts</Link>.
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <section aria-labelledby="sizes">
          <h2 id="sizes">Design sizes</h2>
          <p>Start from a preset, or type any width and height.</p>
          <table className="mt-5 w-full border-y border-ink-200 text-left">
            <thead className="sr-only">
              <tr>
                <th scope="col">Preset</th>
                <th scope="col">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {SIZES.map(([name, size]) => (
                <tr key={name}>
                  <th scope="row" className="py-3 pr-4 font-semibold text-ink-900">
                    {name}
                  </th>
                  <td className="py-3 font-mono text-[14px]">{size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="shortcuts">
          <h2 id="shortcuts">Keyboard shortcuts</h2>
          <table className="mt-5 w-full border-y border-ink-200 text-left">
            <thead className="sr-only">
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Keys</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {SHORTCUTS.map(([action, keys]) => (
                <tr key={action}>
                  <th scope="row" className="py-3 pr-4 font-semibold text-ink-900">
                    {action}
                  </th>
                  <td className="py-3 font-mono text-[14px]">{keys}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="limits">
          <h2 id="limits">Limits worth knowing</h2>
          <ul>
            <li>
              Designs live only in the browser where you made them. Clearing site data deletes them, and they don&apos;t
              sync between devices. Download a <strong>.canvasme</strong> work file for anything you want to keep.
            </li>
            <li>PNG and JPG exports include the page background colour. There is no transparent-background export yet.</li>
            <li>The background remover downloads its AI model once, the first time you use it.</li>
            <li>
              Photoshop files lose adjustment layers, layer effects and blend modes, and exported PSDs have text as pixels.
              Illustrator and PDF files come in as images (with optional editable text), not editable vector shapes, and
              an .ai file must have been saved with PDF compatibility.
            </li>
            <li>There are no templates, stock photos or team sharing. canvas.me is a blank-canvas editor.</li>
          </ul>
        </section>
      </div>

      <RelatedGuides exclude="/features" />
      <ClosingCta title="Try it on your next design" />
    </SiteShell>
  );
}
