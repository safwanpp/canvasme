import type { Metadata } from "next";
import { Chilanka, Manjari, Noto_Serif_Malayalam } from "next/font/google";
import Link from "next/link";
import { ArticleHeader, Bezel, ClosingCta, JsonLd, prose, RelatedGuides, SiteShell } from "@/components/landing/Site";
import { MALAYALAM_STEPS } from "@/lib/content";
import { FONTS } from "@/lib/fonts";
import { breadcrumbs, MALAYALAM_FONT_COUNT, ORG_ID, pageMetadata, SITE } from "@/lib/site";

const manjari = Manjari({ subsets: ["malayalam"], weight: "700" });
const chilanka = Chilanka({ subsets: ["malayalam"], weight: "400" });
const notoSerif = Noto_Serif_Malayalam({ subsets: ["malayalam"], weight: "700" });

const PATH = "/malayalam-poster-maker";
const TITLE = "Malayalam poster maker: free, online, no sign-up";
const DESCRIPTION = `Make Malayalam posters in your browser for free. ${MALAYALAM_FONT_COUNT} Malayalam fonts, upload your own, then export JPG, PNG or PDF. No account needed.`;
const POSTER_LINK = "/app?size=1587x2245&name=Malayalam%20poster";

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

const malayalam = FONTS.filter((f) => f.script === "malayalam");
const FONT_SOURCES: [string, string[]][] = [
  ["From Google Fonts", malayalam.filter((f) => f.spec).map((f) => f.family)],
  [
    "Swathanthra Malayalam Computing (SMC)",
    malayalam.filter((f) => f.faces && !f.family.startsWith("RIT ") && !f.family.startsWith("Lohit")).map((f) => f.family),
  ],
  ["Rachana Institute of Typography (RIT)", malayalam.filter((f) => f.family.startsWith("RIT ")).map((f) => f.family)],
  ["Lohit (Red Hat)", malayalam.filter((f) => f.family.startsWith("Lohit")).map((f) => f.family)],
];

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "HowTo",
      "@id": `${SITE.url}${PATH}#howto`,
      name: "How to make a Malayalam poster in canvas.me",
      description: DESCRIPTION,
      inLanguage: "en",
      totalTime: "PT10M",
      estimatedCost: { "@type": "MonetaryAmount", currency: "USD", value: "0" },
      tool: [{ "@type": "HowToTool", name: "A web browser" }],
      step: MALAYALAM_STEPS.map(([name, text], i) => ({
        "@type": "HowToStep",
        position: i + 1,
        name,
        text,
        url: `${SITE.url}${PATH}#step-${i + 1}`,
      })),
      publisher: { "@id": ORG_ID },
      dateModified: SITE.updated,
    },
    breadcrumbs([
      ["Home", "/"],
      ["Malayalam poster maker", PATH],
    ]),
  ],
};

export default function MalayalamPosterPage() {
  return (
    <SiteShell current={PATH}>
      <JsonLd data={STRUCTURED_DATA} />
      <ArticleHeader
        crumb="Malayalam poster maker"
        title="Make a Malayalam poster in your browser, free"
        lede={
          <p>
            canvas.me is a free online design editor with {MALAYALAM_FONT_COUNT} Malayalam fonts built in. Type or paste
            Malayalam, pick a font, add photos and shapes, and download the poster as JPG, PNG or PDF. There is no
            sign-up and no watermark, and your poster is saved on your own device.
          </p>
        }
        cta={{ href: POSTER_LINK, label: "Start a Malayalam poster" }}
      />

      <div className="mx-auto max-w-3xl px-4 pb-6 sm:px-6">
        <Bezel>
          <figure className="grid gap-px overflow-hidden rounded-[var(--radius-core)] bg-ink-100 sm:grid-cols-3">
            {[
              ["മലയാളം", "Manjari", manjari.className],
              ["ഓണാശംസകൾ", "Chilanka", chilanka.className],
              ["മലയാളം", "Noto Serif Malayalam", notoSerif.className],
            ].map(([text, name, cls]) => (
              <div key={name} className="flex flex-col justify-between gap-6 bg-surface p-6">
                <span lang="ml" className={`text-[40px] leading-tight text-ink-900 ${cls}`}>
                  {text}
                </span>
                <span className="font-mono text-xs text-ink-500">{name}</span>
              </div>
            ))}
            <figcaption className="sr-only">Malayalam words set in three of the fonts in the canvas.me font picker</figcaption>
          </figure>
        </Bezel>
      </div>

      <div className={prose}>
        <h2 id="steps">How to make a Malayalam poster</h2>
        <ol>
          {MALAYALAM_STEPS.map(([title, body], i) => (
            <li key={title} id={`step-${i + 1}`} className="scroll-mt-24">
              <strong>{title}.</strong> {body}
            </li>
          ))}
        </ol>
        <p>
          The <Link href={POSTER_LINK}>poster link</Link> opens a blank 1587 × 2245 px design (A-series proportions,
          like A4 or A3) named &ldquo;Malayalam poster&rdquo;.
        </p>

        <h2 id="fonts">{MALAYALAM_FONT_COUNT} Malayalam fonts you can use</h2>
        <p>
          All of them are free fonts under open licences. Fonts that aren&apos;t on Google Fonts are hosted by canvas.me
          and download only when a design uses them, then stay cached for offline use.
        </p>
        {FONT_SOURCES.map(([source, names]) => (
          <section key={source}>
            <h3>{source}</h3>
            <p>{names.join(", ")}.</p>
          </section>
        ))}

        <h2 id="own-font">Use your own Malayalam font</h2>
        <p>
          If you have a font that isn&apos;t in the list, open the font picker and upload it. canvas.me accepts TTF,
          OTF, WOFF and WOFF2 files up to 15 MB. The font is stored in this browser only, works in all your designs, and
          is packed into the .canvasme work file, so the poster still looks right when you open it on another device.
          Make sure the font&apos;s licence lets you use it.
        </p>

        <h2 id="tips">Tips for Malayalam posters</h2>
        <ul>
          <li>
            Malayalam letters have tall marks above and below. Give text boxes a bit more line height than you would for
            English, using the spacing controls.
          </li>
          <li>For WhatsApp status and Instagram stories, start from the Story size (1080 × 1920 px).</li>
          <li>For a print shop, export a PDF. Image exports are twice the design size, so they stay sharp too.</li>
          <li>
            Cut a person or product out of a photo with the{" "}
            <Link href="/remove-background">in-browser background remover</Link>.
          </li>
          <li>Keep the .canvasme work file, so you can change the date or venue next time instead of starting again.</li>
        </ul>

        <h2 id="faq">Questions</h2>
        <h3>Is the Malayalam poster maker free?</h3>
        <p>Yes. canvas.me has no paid plan and adds no watermark.</p>
        <h3>Can I type in Manglish?</h3>
        <p>
          No. canvas.me shows the text you type. Use a Malayalam keyboard on your phone or computer, or paste Malayalam
          text from somewhere else.
        </p>
        <h3>Does it work on a phone?</h3>
        <p>
          Yes. The editor works in the phone&apos;s browser and can be installed to the home screen. See{" "}
          <Link href="/features">all features</Link>.
        </p>
      </div>

      <RelatedGuides exclude={PATH} />
      <ClosingCta
        title="Make your Malayalam poster now"
        body="Free, no sign-up, and saved on your device."
        href={POSTER_LINK}
        label="Start a poster"
      />
    </SiteShell>
  );
}
