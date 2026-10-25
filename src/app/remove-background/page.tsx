import type { Metadata } from "next";
import Link from "next/link";
import { ArticleHeader, ClosingCta, JsonLd, prose, RelatedGuides, SiteShell } from "@/components/landing/Site";
import { BG_STEPS } from "@/lib/content";
import { breadcrumbs, ORG_ID, pageMetadata, SITE } from "@/lib/site";

const PATH = "/remove-background";
const TITLE = "Remove image background free, in your browser";
const DESCRIPTION =
  "Remove the background from a photo for free with AI that runs on your device. No upload, no sign-up, no watermark. Then use the cut-out in a design.";

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "HowTo",
      "@id": `${SITE.url}${PATH}#howto`,
      name: "How to remove an image background for free in the browser with canvas.me",
      description: DESCRIPTION,
      inLanguage: "en",
      estimatedCost: { "@type": "MonetaryAmount", currency: "USD", value: "0" },
      tool: [{ "@type": "HowToTool", name: "A web browser" }],
      step: BG_STEPS.map(([name, text], i) => ({
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
      ["Remove background", PATH],
    ]),
  ],
};

export default function RemoveBackgroundPage() {
  return (
    <SiteShell current={PATH}>
      <JsonLd data={STRUCTURED_DATA} />
      <ArticleHeader
        crumb="Remove background"
        title="Remove an image background for free, in your browser"
        lede={
          <p>
            canvas.me has a free background remover built into its design editor. The AI model runs on your own device,
            so your photo is never uploaded to a server. There is no sign-up, no watermark and no limit on how many
            images you cut out.
          </p>
        }
        cta={{ href: "/app", label: "Remove a background" }}
      />

      <div className={prose}>
        <h2 id="steps">How to remove a background</h2>
        <ol>
          {BG_STEPS.map(([title, body], i) => (
            <li key={title} id={`step-${i + 1}`} className="scroll-mt-24">
              <strong>{title}.</strong> {body}
            </li>
          ))}
        </ol>

        <h2 id="how">How it works, and why your photo stays private</h2>
        <p>
          Most online background removers send your photo to their server. canvas.me does the work in your browser
          instead. It uses <strong>ormbg</strong>, an open background-removal model under the Apache-2.0 licence, run by
          transformers.js and ONNX Runtime Web inside a background worker.
        </p>
        <ul>
          <li>
            <strong>One-time download.</strong> The first time you use it, the browser downloads the model: about 88 MB
            on devices with WebGPU, or a 44 MB version that runs on the CPU. It comes from Hugging Face and jsDelivr and
            then stays in the browser cache, so the next image starts straight away.
          </li>
          <li>
            <strong>On your device.</strong> Your photo goes from the page to the model in the same browser tab. It is not
            sent anywhere.
          </li>
          <li>
            <strong>Pinned and checked.</strong> canvas.me loads one fixed version of the model and checks the runtime
            files against known hashes before running them.
          </li>
          <li>
            <strong>Works on most devices.</strong> If the graphics chip can&apos;t run the model, canvas.me falls back to
            the CPU. That is slower, but the result is the same.
          </li>
        </ul>

        <h2 id="results">Getting a clean cut-out</h2>
        <ul>
          <li>It works best on photos with one clear subject, such as a person, a pet or a product.</li>
          <li>
            If a few bits of background are left, select the image and use <strong>Erase parts of the image</strong>. The
            brush has adjustable size and softness.
          </li>
          <li>
            Changed your mind? Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>Z</kbd> to bring back the original photo.
          </li>
          <li>
            Put the cut-out on a coloured page, clip another photo into a shape behind it, or add text around it for a
            poster or a thumbnail.
          </li>
        </ul>

        <h2 id="limits">Good to know</h2>
        <ul>
          <li>
            The cut-out is a transparent PNG inside your design. PNG and JPG exports include the page background colour,
            so canvas.me can&apos;t export a transparent-background PNG yet.
          </li>
          <li>The first run needs an internet connection to download the model.</li>
          <li>Large photos take longer, especially on the CPU path.</li>
        </ul>

        <h2 id="faq">Questions</h2>
        <h3>Is this background remover really free?</h3>
        <p>Yes. It is part of canvas.me, which has no paid plan, no credits and no watermark.</p>
        <h3>Is my photo uploaded?</h3>
        <p>
          No. The model runs in your browser, and designs and images are stored only on your device. See{" "}
          <Link href="/#faq">where designs are saved</Link>.
        </p>
        <h3>Does it work on a phone?</h3>
        <p>
          It runs in current mobile browsers too. It is slower there, and older phones with little memory may struggle;
          a computer with WebGPU support is quickest.
        </p>
      </div>

      <RelatedGuides exclude={PATH} />
      <ClosingCta
        title="Cut out your first photo"
        body="Free, private and on your device. No account needed."
        label="Open the editor"
      />
    </SiteShell>
  );
}
